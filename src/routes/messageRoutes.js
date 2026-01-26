import express from "express";
import fs from "fs/promises";
import cloudinary from "../db/cloudinary.js";
import { protectRoutes } from "../middleware/auth.middleware.js";
import { uploadVoiceMessage } from "../middleware/upload.middleware.js";
import messageModel from "../models/messageModel.js";
import userModel from "../models/userModel.js";
import { sendExpoPush } from "../lib/pushNotifications.js";

const router = express.Router();
const LIMIT = 50;

/** GET /messages/conversations – list unique users you've chatted with + last message + unread count */
router.get("/conversations", protectRoutes, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const agg = await messageModel.aggregate([
      {
        $match: {
          $or: [{ sender: req.user._id }, { receiver: req.user._id }],
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: {
            $cond: [
              { $eq: ["$sender", req.user._id] },
              "$receiver",
              "$sender",
            ],
          },
          lastMessage: { $first: "$$ROOT" },
          unreadCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$receiver", req.user._id] },
                    { $eq: ["$read", false] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: "$user" },
      {
        $project: {
          _id: 1,
          lastMessage: 1,
          unreadCount: 1,
          username: "$user.username",
          profileImg: "$user.profileImg",
          email: "$user.email",
        },
      },
      { $sort: { "lastMessage.createdAt": -1 } },
    ]);

    const conversations = agg.map((c) => ({
      _id: c._id,
      username: c.username,
      profileImg: c.profileImg,
      email: c.email,
      lastMessage: c.lastMessage
        ? {
            text: c.lastMessage.text || (c.lastMessage.voiceMessage ? "🎤 Voice message" : ""),
            voiceMessage: c.lastMessage.voiceMessage || null,
            createdAt: c.lastMessage.createdAt,
            sender: c.lastMessage.sender,
            read: c.lastMessage.read,
          }
        : null,
      unreadCount: c.unreadCount || 0,
    }));

    return res.json({ conversations });
  } catch (err) {
    console.error("GET /conversations", err);
    return res.status(500).json({ message: "Failed to fetch conversations" });
  }
});

/** GET /messages/:otherUserId?limit=50&before= – messages with other user (paginated) */
router.get("/:otherUserId", protectRoutes, async (req, res) => {
  try {
    const { otherUserId } = req.params;
    const before = req.query.before; // ISO date or messageId
    const limit = Math.min(parseInt(req.query.limit, 10) || LIMIT, 100);
    const userId = req.user._id.toString();

    if (!otherUserId || otherUserId === userId) {
      return res.status(400).json({ message: "Invalid other user" });
    }

    let query = {
      $or: [
        { sender: userId, receiver: otherUserId },
        { sender: otherUserId, receiver: userId },
      ],
    };

    if (before) {
      const beforeDate = new Date(before);
      if (!isNaN(beforeDate.getTime())) {
        query.createdAt = { $lt: beforeDate };
      }
    }

    const messages = await messageModel
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("sender", "username profileImg")
      .populate("receiver", "username profileImg")
      .lean();

    const reversed = messages.reverse();

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
      const io = req.app.get("io");
      if (io) {
        io.to(`user:${otherUserId}`).emit("messages_read", {
          messageIds: markedIds.map((id) => String(id)),
          readBy: userId,
        });
      }
    }

    return res.json({ messages: reversed, hasMore: messages.length === limit });
  } catch (err) {
    console.error("GET /:otherUserId", err);
    return res.status(500).json({ message: "Failed to fetch messages" });
  }
});

/** POST /messages – send message (persist). Used when socket unavailable or fallback. */
router.post("/", protectRoutes, async (req, res) => {
  try {
    const { receiverId, text, voiceMessage } = req.body;
    const senderId = req.user._id;

    if (!receiverId) {
      return res.status(400).json({ message: "receiverId is required" });
    }

    // Either text or voiceMessage must be provided
    if (!text && !voiceMessage) {
      return res.status(400).json({ message: "Either text or voiceMessage is required" });
    }

    const trimmed = text ? text.trim() : "";
    if (text && !trimmed) {
      return res.status(400).json({ message: "Message cannot be empty" });
    }

    const receiver = await userModel.findById(receiverId).select("_id blockedUsers");
    if (!receiver) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if receiver has blocked the sender
    if (receiver.blockedUsers && receiver.blockedUsers.includes(senderId)) {
      return res.status(403).json({ message: "You cannot send messages to this user" });
    }

    // Check if sender has blocked the receiver
    const sender = await userModel.findById(senderId).select("blockedUsers");
    if (sender.blockedUsers && sender.blockedUsers.includes(receiverId)) {
      return res.status(403).json({ message: "You have blocked this user" });
    }

    const msgData = {
      sender: senderId,
      receiver: receiverId,
    };

    if (voiceMessage) {
      msgData.voiceMessage = voiceMessage;
    } else {
      msgData.text = trimmed;
    }

    const msg = await messageModel.create(msgData);

    const populated = await messageModel
      .findById(msg._id)
      .populate("sender", "username profileImg")
      .populate("receiver", "username profileImg")
      .lean();

    const io = req.app.get("io");
    if (io) {
      io.to(`user:${receiverId}`).emit("new_message", populated);
    }

    const receiverUser = await userModel.findById(receiverId).select("expoPushToken").lean();
    if (receiverUser?.expoPushToken) {
      const notificationBody = voiceMessage 
        ? "🎤 Voice message" 
        : (trimmed.length > 80 ? trimmed.slice(0, 77) + "…" : trimmed);
      sendExpoPush(receiverUser.expoPushToken, {
        title: req.user?.username || "New message",
        body: notificationBody,
        data: { type: "message", senderId: String(senderId), messageId: populated._id },
      });
    }

    return res.status(201).json({ message: populated });
  } catch (err) {
    console.error("POST /messages", err);
    return res.status(500).json({ message: "Failed to send message" });
  }
});

/** POST /messages/voice – upload and send voice message */
router.post("/voice", protectRoutes, (req, res, next) => {
  uploadVoiceMessage(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ message: "Voice message too large. Maximum 10MB." });
      }
      return res.status(400).json({ message: err.message || "Upload failed" });
    }
    next();
  });
}, async (req, res) => {
  let tempPath = null;
  try {
    const { receiverId, duration } = req.body;
    const senderId = req.user._id;
    const file = req.file;

    if (!receiverId) {
      return res.status(400).json({ message: "receiverId is required" });
    }

    if (!file) {
      return res.status(400).json({ message: "Voice file is required" });
    }

    const receiver = await userModel.findById(receiverId).select("_id blockedUsers");
    if (!receiver) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if receiver has blocked the sender
    if (receiver.blockedUsers && receiver.blockedUsers.includes(senderId)) {
      return res.status(403).json({ message: "You cannot send messages to this user" });
    }

    // Check if sender has blocked the receiver
    const sender = await userModel.findById(senderId).select("blockedUsers");
    if (sender.blockedUsers && sender.blockedUsers.includes(receiverId)) {
      return res.status(403).json({ message: "You have blocked this user" });
    }

    tempPath = file.path;
    const uploadOptions = { resource_type: "video" }; // Cloudinary treats audio as video
    const result = await cloudinary.uploader.upload(tempPath, uploadOptions);
    const voiceUrl = result.secure_url;
    const publicId = result.public_id || null;
    await fs.unlink(tempPath).catch(() => {});
    tempPath = null;

    const msg = await messageModel.create({
      sender: senderId,
      receiver: receiverId,
      voiceMessage: {
        url: voiceUrl,
        duration: duration ? parseInt(duration, 10) : 0,
        cloudinaryPublicId: publicId,
      },
    });

    const populated = await messageModel
      .findById(msg._id)
      .populate("sender", "username profileImg")
      .populate("receiver", "username profileImg")
      .lean();

    const io = req.app.get("io");
    if (io) {
      io.to(`user:${receiverId}`).emit("new_message", populated);
    }

    const receiverUser = await userModel.findById(receiverId).select("expoPushToken").lean();
    if (receiverUser?.expoPushToken) {
      sendExpoPush(receiverUser.expoPushToken, {
        title: req.user?.username || "New message",
        body: "🎤 Voice message",
        data: { type: "message", senderId: String(senderId), messageId: populated._id },
      });
    }

    return res.status(201).json({ message: populated });
  } catch (err) {
    if (tempPath) {
      await fs.unlink(tempPath).catch(() => {});
    }
    console.error("POST /messages/voice", err);
    return res.status(500).json({ message: "Failed to send voice message" });
  }
});

/** DELETE /messages/:messageId – delete a message */
router.delete("/:messageId", protectRoutes, async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user._id.toString();

    const msg = await messageModel.findById(messageId);
    if (!msg) {
      return res.status(404).json({ message: "Message not found" });
    }

    // Only sender can delete their own messages
    if (String(msg.sender) !== userId) {
      return res.status(403).json({
        message: "Unauthorized - You can only delete your own messages",
      });
    }

    // If this message has a voice attachment, delete it from Cloudinary
    const publicId = msg.voiceMessage?.cloudinaryPublicId;
    if (publicId) {
      try {
        await cloudinary.uploader.destroy(publicId, { resource_type: "video" });
      } catch (err) {
        console.error("Failed to delete voice file from Cloudinary:", err);
      }
    }

    await messageModel.findByIdAndDelete(messageId);

    // Notify both users via socket
    const io = req.app.get("io");
    if (io) {
      const receiverId = String(msg.receiver);
      const receiverRoom = `user:${receiverId}`;
      const senderRoom = `user:${userId}`;
      
      io.to(receiverRoom).emit("message_deleted", { messageId: String(messageId) });
      io.to(senderRoom).emit("message_deleted", { messageId: String(messageId) });
    }

    return res.status(200).json({ message: "Message deleted successfully" });
  } catch (err) {
    console.error("DELETE /messages/:messageId", err);
    return res.status(500).json({ message: "Failed to delete message" });
  }
});

/** DELETE /messages/conversation/:otherUserId – clear all messages with a user */
router.delete("/conversation/:otherUserId", protectRoutes, async (req, res) => {
  try {
    const { otherUserId } = req.params;
    const userId = req.user._id.toString();

    if (!otherUserId || otherUserId === userId) {
      return res.status(400).json({ message: "Invalid other user ID" });
    }

    // Find all messages in this conversation to collect any voice attachments
    const messages = await messageModel
      .find({
        $or: [
          { sender: userId, receiver: otherUserId },
          { sender: otherUserId, receiver: userId },
        ],
      })
      .select("voiceMessage.cloudinaryPublicId")
      .lean();

    const publicIds = messages
      .map((m) => m.voiceMessage?.cloudinaryPublicId)
      .filter(Boolean);

    if (publicIds.length) {
      try {
        await cloudinary.api.delete_resources(publicIds, {
          resource_type: "video",
        });
      } catch (err) {
        console.error("Failed to delete conversation voice files from Cloudinary:", err);
      }
    }

    // Delete all messages between current user and other user
    const result = await messageModel.deleteMany({
      $or: [
        { sender: userId, receiver: otherUserId },
        { sender: otherUserId, receiver: userId },
      ],
    });

    // Notify both users via socket
    const io = req.app.get("io");
    if (io) {
      const receiverRoom = `user:${otherUserId}`;
      const senderRoom = `user:${userId}`;
      
      io.to(receiverRoom).emit("conversation_cleared", { clearedBy: userId });
      io.to(senderRoom).emit("conversation_cleared", { clearedBy: userId });
    }

    return res.status(200).json({
      message: "Conversation cleared successfully",
      deletedCount: result.deletedCount,
    });
  } catch (err) {
    console.error("DELETE /messages/conversation/:otherUserId", err);
    return res.status(500).json({ message: "Failed to clear conversation" });
  }
});

export default router;
