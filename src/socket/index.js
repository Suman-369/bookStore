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
        io.to(receiverRoom).emit("new_message", populated);
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

    socket.on("disconnect", () => {
      onlineStore.remove(userId);
    });
  });
}
