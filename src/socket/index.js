import jwt from "jsonwebtoken";
import messageModel from "../models/messageModel.js";
import userModel from "../models/userModel.js";
import * as onlineStore from "../lib/onlineStore.js";
import { sendExpoPush } from "../lib/pushNotifications.js";

const USER_ROOM_PREFIX = "user:";

function authMiddleware(socket, next) {
  const token =
    socket.handshake?.auth?.token ||
    socket.handshake?.query?.token;
  if (!token) {
    return next(new Error("Unauthorized: no token"));
  }
  if (!process.env.JWT_SECRET) {
    return next(new Error("Server misconfigured"));
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded?.id;
    if (!userId) return next(new Error("Unauthorized"));
    socket.data.userId = userId;
    return next();
  } catch (e) {
    return next(new Error("Unauthorized: invalid token"));
  }
}

export function setupSocket(io) {
  io.use(authMiddleware);

  io.on("connection", async (socket) => {
    const userId = String(socket.data.userId);
    const room = `${USER_ROOM_PREFIX}${userId}`;
    await socket.join(room);
    onlineStore.add(userId);
    // Update last seen when user connects
    await userModel.findByIdAndUpdate(userId, { lastSeen: new Date() });
    
    // Update last seen periodically while user is online (every 5 minutes)
    const lastSeenInterval = setInterval(async () => {
      if (onlineStore.has(userId)) {
        await userModel.findByIdAndUpdate(userId, { lastSeen: new Date() });
      }
    }, 5 * 60 * 1000); // 5 minutes
    
    // Store interval ID in socket data for cleanup
    socket.data.lastSeenInterval = lastSeenInterval;

    socket.on("send_message", async (payload, cb) => {
      const { receiverId, text } = payload || {};
      if (!receiverId || !text || typeof text !== "string") {
        const err = { message: "receiverId and text required" };
        return typeof cb === "function" ? cb(err) : null;
      }
      const trimmed = text.trim();
      if (!trimmed) {
        const err = { message: "Message cannot be empty" };
        return typeof cb === "function" ? cb(err) : null;
      }
      if (receiverId === userId) {
        const err = { message: "Cannot message yourself" };
        return typeof cb === "function" ? cb(err) : null;
      }

      try {
        // Check if receiver has blocked the sender
        const receiver = await userModel.findById(receiverId).select("blockedUsers").lean();
        if (!receiver) {
          const err = { message: "User not found" };
          return typeof cb === "function" ? cb(err) : null;
        }
        if (receiver.blockedUsers && receiver.blockedUsers.includes(userId)) {
          const err = { message: "You cannot send messages to this user" };
          return typeof cb === "function" ? cb(err) : null;
        }

        // Check if sender has blocked the receiver
        const sender = await userModel.findById(userId).select("blockedUsers").lean();
        if (sender.blockedUsers && sender.blockedUsers.includes(receiverId)) {
          const err = { message: "You have blocked this user" };
          return typeof cb === "function" ? cb(err) : null;
        }
        const msg = await messageModel.create({
          sender: userId,
          receiver: receiverId,
          text: trimmed,
        });
        const populated = await messageModel
          .findById(msg._id)
          .populate("sender", "username profileImg")
          .populate("receiver", "username profileImg")
          .lean();

        const receiverRoom = `${USER_ROOM_PREFIX}${receiverId}`;
        const senderRoom = `${USER_ROOM_PREFIX}${userId}`;
        // Emit to both receiver and sender so both can see the message
        io.to(receiverRoom).emit("new_message", populated);
        io.to(senderRoom).emit("new_message", populated);
        const receiverUser = await userModel.findById(receiverId).select("expoPushToken").lean();
        if (receiverUser?.expoPushToken) {
          const senderName = populated.sender?.username || "Someone";
          sendExpoPush(receiverUser.expoPushToken, {
            title: senderName,
            body: trimmed.length > 80 ? trimmed.slice(0, 77) + "…" : trimmed,
            data: { type: "message", senderId: String(userId), messageId: String(msg._id) },
          });
        }
        if (typeof cb === "function") cb(null, populated);
      } catch (e) {
        console.error("send_message error:", e);
        if (typeof cb === "function") cb({ message: "Failed to send message" });
      }
    });

    // Typing indicators
    socket.on("typing_start", (payload) => {
      const { receiverId } = payload || {};
      if (!receiverId || receiverId === userId) return;
      const receiverRoom = `${USER_ROOM_PREFIX}${receiverId}`;
      io.to(receiverRoom).emit("typing_start", { userId });
    });

    socket.on("typing_stop", (payload) => {
      const { receiverId } = payload || {};
      if (!receiverId || receiverId === userId) return;
      const receiverRoom = `${USER_ROOM_PREFIX}${receiverId}`;
      io.to(receiverRoom).emit("typing_stop", { userId });
    });

    // Mark messages as read in real-time
    socket.on("mark_messages_read", async (payload) => {
      const { otherUserId } = payload || {};
      if (!otherUserId || otherUserId === userId) return;

      try {
        const toMark = await messageModel
          .find({
            sender: otherUserId,
            receiver: userId,
            read: false,
          })
          .select("_id")
          .lean();
        
        const markedIds = toMark.map((m) => m._id);
        if (markedIds.length) {
          await messageModel.updateMany(
            { _id: { $in: markedIds } },
            { $set: { read: true } }
          );
          // Notify the sender that their messages were read
          const senderRoom = `${USER_ROOM_PREFIX}${otherUserId}`;
          io.to(senderRoom).emit("messages_read", {
            messageIds: markedIds.map((id) => String(id)),
            readBy: userId,
          });
        }
      } catch (e) {
        console.error("mark_messages_read error:", e);
      }
    });

    // Delete message
    socket.on("delete_message", async (payload, cb) => {
      const { messageId } = payload || {};
      if (!messageId) {
        const err = { message: "messageId required" };
        return typeof cb === "function" ? cb(err) : null;
      }

      try {
        const msg = await messageModel.findById(messageId).lean();
        if (!msg) {
          const err = { message: "Message not found" };
          return typeof cb === "function" ? cb(err) : null;
        }

        // Only sender can delete their own messages
        if (String(msg.sender) !== userId) {
          const err = { message: "Unauthorized - You can only delete your own messages" };
          return typeof cb === "function" ? cb(err) : null;
        }

        await messageModel.findByIdAndDelete(messageId);

        // Notify both users about the deletion
        const receiverId = String(msg.receiver);
        const receiverRoom = `${USER_ROOM_PREFIX}${receiverId}`;
        const senderRoom = `${USER_ROOM_PREFIX}${userId}`;
        
        io.to(receiverRoom).emit("message_deleted", { messageId: String(messageId) });
        io.to(senderRoom).emit("message_deleted", { messageId: String(messageId) });

        if (typeof cb === "function") cb(null, { success: true });
      } catch (e) {
        console.error("delete_message error:", e);
        if (typeof cb === "function") cb({ message: "Failed to delete message" });
      }
    });

    socket.on("disconnect", async () => {
      // Clear the interval
      if (socket.data.lastSeenInterval) {
        clearInterval(socket.data.lastSeenInterval);
      }
      onlineStore.remove(userId);
      // Update last seen when user disconnects
      await userModel.findByIdAndUpdate(userId, { lastSeen: new Date() });
    });
  });
}
