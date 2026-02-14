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
            $cond: [{ $eq: ["$sender", req.user._id] }, "$receiver", "$sender"],
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

    const conversations = agg.map((c) => {
      let lastMessage = null;

      if (c.lastMessage) {
        // Prefer a clear label for encrypted / voice messages instead of empty text
        let text = "";
        if (c.lastMessage.isEncrypted && c.lastMessage.encryptedVoiceMessage) {
          text = "🔒🎤 Encrypted voice message";
        } else if (c.lastMessage.isEncrypted) {
          text = "🔒 Encrypted message";
        } else if (c.lastMessage.voiceMessage) {
          text = "🎤 Voice message";
        } else {
          text = c.lastMessage.text || "";
        }

        lastMessage = {
          text,
          voiceMessage: c.lastMessage.voiceMessage || null,
          encryptedVoiceMessage: c.lastMessage.encryptedVoiceMessage || null,
          createdAt: c.lastMessage.createdAt,
          sender: c.lastMessage.sender,
          read: c.lastMessage.read,
          isEncrypted: !!c.lastMessage.isEncrypted,
          // CRITICAL: Pass through encryption fields so client can decrypt preview
          encryptedMessage: c.lastMessage.encryptedMessage,
          nonce: c.lastMessage.nonce,
          senderPublicKey: c.lastMessage.senderPublicKey,
        };
      }

      return {
        _id: c._id,
        username: c.username,
        profileImg: c.profileImg,
        email: c.email,
        lastMessage,
        unreadCount: c.unreadCount || 0,
      };
    });

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
      .populate("sender", "username profileImg publicKey")
      .populate("receiver", "username profileImg")
      .lean();

    // Old messages may not have senderPublicKey stored at top-level.
    // Normalize payload so the client can always decrypt using senderPublicKey
    const reversed = messages.reverse();
    const normalizedMessages = reversed.map((m) => {
      if (
        m.isEncrypted &&
        !m.senderPublicKey &&
        m.sender &&
        m.sender.publicKey
      ) {
        return {
          ...m,
          senderPublicKey: m.sender.publicKey,
        };
      }
      return m;
    });

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
        { $set: { read: true } },
      );
      const io = req.app.get("io");
      if (io) {
        io.to(`user:${otherUserId}`).emit("messages_read", {
          messageIds: markedIds.map((id) => String(id)),
          readBy: userId,
        });
      }
    }

    return res.json({
      messages: normalizedMessages,
      hasMore: messages.length === limit,
    });
  } catch (err) {
    console.error("GET /:otherUserId", err);
    return res.status(500).json({ message: "Failed to fetch messages" });
  }
});

/** POST /messages – send message (persist). Used when socket unavailable or fallback. */
router.post("/", protectRoutes, async (req, res) => {
  try {
    const { receiverId, voiceMessage, cipherText, nonce, isEncrypted } =
      req.body;
    const senderId = req.user._id;
    const receiverIdStr = receiverId ? String(receiverId) : "";
    const senderIdStr = String(senderId);

    if (!receiverId) {
      return res.status(400).json({ message: "receiverId is required" });
    }

    // CRITICAL: Check for encrypted message (simple nacl.box only)
    const isE2EEMessage = cipherText && nonce;

    // BLOCK: Do NOT accept non-encrypted messages
    if (!isE2EEMessage && !voiceMessage) {
      console.error(
        `🚫 Blocked non-encrypted message from ${senderIdStr} to ${receiverIdStr}`,
      );
      return res.status(403).json({
        message:
          "❌ Encrypted message (cipherText + nonce) or voiceMessage is required",
        code: "E2EE_REQUIRED",
      });
    }

    // Either encrypted message or voiceMessage must be provided
    if (!isE2EEMessage && !voiceMessage) {
      return res.status(400).json({
        message:
          "Encrypted message (cipherText + nonce) or voiceMessage is required",
        code: "INVALID_MESSAGE_FORMAT",
      });
    }

    const receiver = await userModel
      .findById(receiverId)
      .select("_id blockedUsers e2eeEnabled");
    if (!receiver) {
      return res.status(404).json({ message: "User not found" });
    }

    // CRITICAL: Verify recipient has E2EE enabled for encrypted messages
    if (isE2EEMessage && !receiver.e2eeEnabled) {
      console.warn(`⚠️  Recipient ${receiverIdStr} doesn't have E2EE enabled`);
      return res.status(403).json({
        message:
          "Recipient has not enabled E2EE yet. Cannot send encrypted message.",
        e2eeEnabled: false,
        code: "E2EE_NOT_ENABLED",
      });
    }

    // Check if receiver has blocked the sender
    const receiverBlocked = (receiver.blockedUsers || []).some(
      (id) => String(id) === senderIdStr,
    );
    if (receiverBlocked) {
      return res.status(403).json({
        message:
          "You are blocked from this user. You cannot send messages to this user.",
      });
    }

    // Check if sender has blocked the receiver
    const sender = await userModel.findById(senderId).select("blockedUsers");
    const senderBlocked = (sender.blockedUsers || []).some(
      (id) => String(id) === receiverIdStr,
    );
    if (senderBlocked) {
      return res.status(403).json({ message: "You have blocked this user" });
    }

    const msgData = {
      sender: senderId,
      receiver: receiverId,
    };

    // Handle E2EE encrypted messages (simple nacl.box only)
    if (isE2EEMessage) {
      msgData.encryptedMessage = cipherText;
      msgData.nonce = nonce;
      msgData.isEncrypted = true;

      // CRITICAL: Get sender's public key if not provided
      // so that future fetches (GET /messages) can decrypt reliably
      let finalSenderPublicKey = req.body.senderPublicKey;
      if (!finalSenderPublicKey) {
        const senderUser = await userModel
          .findById(senderId)
          .select("publicKey")
          .lean();
        finalSenderPublicKey = senderUser?.publicKey;
      }

      if (finalSenderPublicKey) {
        msgData.senderPublicKey = finalSenderPublicKey;
      } else {
        return res.status(400).json({
          message: "Sender public key not available",
          code: "MISSING_SENDER_KEY",
        });
      }

      console.log(
        `✅ Encrypted message from ${senderIdStr} to ${receiverIdStr}`,
      );
    } else if (voiceMessage) {
      // Voice messages are stored as-is
      msgData.voiceMessage = voiceMessage;
      msgData.isEncrypted = false;
    }

    const msg = await messageModel.create(msgData);

    const populated = await messageModel
      .findById(msg._id)
      .populate("sender", "username profileImg publicKey")
      .populate("receiver", "username profileImg")
      .lean();

    // CRITICAL: Attach senderPublicKey to the message object for client-side decryption
    if (populated.sender?.publicKey && isE2EEMessage) {
      populated.senderPublicKey = populated.sender.publicKey;
    }

    const io = req.app.get("io");
    if (io) {
      io.to(`user:${receiverId}`).emit("new_message", populated);
    }

    const receiverUser = await userModel
      .findById(receiverId)
      .select("expoPushToken")
      .lean();
    if (receiverUser?.expoPushToken) {
      let notificationBody;
      if (isE2EEMessage) {
        notificationBody = "🔒 Encrypted message";
      } else if (voiceMessage) {
        notificationBody = "🎤 Voice message";
      } else {
        notificationBody = "New message";
      }
      sendExpoPush(receiverUser.expoPushToken, {
        title: req.user?.username || "New message",
        body: notificationBody,
        data: {
          type: "message",
          senderId: String(senderId),
          messageId: populated._id,
        },
      });
    }

    return res.status(201).json({ message: populated });
  } catch (err) {
    console.error("POST /messages", err);
    return res.status(500).json({ message: "Failed to send message" });
  }
});

/** POST /messages/voice – upload and send voice message */
router.post(
  "/voice",
  protectRoutes,
  (req, res, next) => {
    uploadVoiceMessage(req, res, (err) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res
            .status(413)
            .json({ message: "Voice message too large. Maximum 10MB." });
        }
        return res
          .status(400)
          .json({ message: err.message || "Upload failed" });
      }
      next();
    });
  },
  async (req, res) => {
    let tempPath = null;
    try {
      const { receiverId, duration } = req.body;
      const senderId = req.user._id;
      const receiverIdStr = receiverId ? String(receiverId) : "";
      const senderIdStr = String(senderId);
      const file = req.file;

      if (!receiverId) {
        return res.status(400).json({ message: "receiverId is required" });
      }

      if (!file) {
        return res.status(400).json({ message: "Voice file is required" });
      }

      const receiver = await userModel
        .findById(receiverId)
        .select("_id blockedUsers");
      if (!receiver) {
        return res.status(404).json({ message: "User not found" });
      }

      // Check if receiver has blocked the sender
      const receiverBlocked = (receiver.blockedUsers || []).some(
        (id) => String(id) === senderIdStr,
      );
      if (receiverBlocked) {
        return res.status(403).json({
          message:
            "You are blocked from this user. You cannot send messages to this user.",
        });
      }

      // Check if sender has blocked the receiver
      const sender = await userModel.findById(senderId).select("blockedUsers");
      const senderBlocked = (sender.blockedUsers || []).some(
        (id) => String(id) === receiverIdStr,
      );
      if (senderBlocked) {
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

      const receiverUser = await userModel
        .findById(receiverId)
        .select("expoPushToken")
        .lean();
      if (receiverUser?.expoPushToken) {
        sendExpoPush(receiverUser.expoPushToken, {
          title: req.user?.username || "New message",
          body: "🎤 Voice message",
          data: {
            type: "message",
            senderId: String(senderId),
            messageId: populated._id,
          },
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
  },
);

/** POST /messages/encrypted-voice – send encrypted voice message */
router.post("/encrypted-voice", protectRoutes, async (req, res) => {
  try {
    const { receiverId, encryptedVoiceMessage, isEncrypted } = req.body;
    const senderId = req.user._id;
    const receiverIdStr = receiverId ? String(receiverId) : "";
    const senderIdStr = String(senderId);

    if (!receiverId) {
      return res.status(400).json({ message: "receiverId is required" });
    }

    if (!encryptedVoiceMessage || !isEncrypted) {
      return res.status(400).json({
        message: "Encrypted voice message data is required",
      });
    }

    const { cipherText, nonce, senderPublicKey, duration } =
      encryptedVoiceMessage;
    if (!cipherText || !nonce || !senderPublicKey) {
      return res.status(400).json({
        message: "Missing encryption data (cipherText, nonce, senderPublicKey)",
      });
    }

    const receiver = await userModel
      .findById(receiverId)
      .select("_id blockedUsers");
    if (!receiver) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if receiver has blocked the sender
    const receiverBlocked = (receiver.blockedUsers || []).some(
      (id) => String(id) === senderIdStr,
    );
    if (receiverBlocked) {
      return res.status(403).json({
        message:
          "You are blocked from this user. You cannot send messages to this user.",
      });
    }

    // Check if sender has blocked the receiver
    const sender = await userModel.findById(senderId).select("blockedUsers");
    const senderBlocked = (sender.blockedUsers || []).some(
      (id) => String(id) === receiverIdStr,
    );
    if (senderBlocked) {
      return res.status(403).json({ message: "You have blocked this user" });
    }

    // Create encrypted voice message
    const msg = await messageModel.create({
      sender: senderId,
      receiver: receiverId,
      isEncrypted: true,
      encryptedVoiceMessage: {
        cipherText,
        nonce,
        senderPublicKey,
        duration: duration ? parseInt(duration, 10) : 0,
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

    const receiverUser = await userModel
      .findById(receiverId)
      .select("expoPushToken")
      .lean();
    if (receiverUser?.expoPushToken) {
      sendExpoPush(receiverUser.expoPushToken, {
        title: req.user?.username || "New message",
        body: "🔒🎤 Encrypted voice message",
        data: {
          type: "message",
          senderId: String(senderId),
          messageId: populated._id,
        },
      });
    }

    console.log(
      `✅ Encrypted voice message from ${senderIdStr} to ${receiverIdStr}`,
    );

    return res.status(201).json({ message: populated });
  } catch (err) {
    console.error("POST /messages/encrypted-voice", err);
    return res
      .status(500)
      .json({ message: "Failed to send encrypted voice message" });
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

    // If this message has a voice attachment, delete it from ImageKit
    const publicId = msg.voiceMessage?.cloudinaryPublicId;
    if (publicId) {
      try {
        await cloudinary.uploader.destroy(publicId);
      } catch (err) {
        console.error("Failed to delete voice file from ImageKit:", err);
      }
    }

    await messageModel.findByIdAndDelete(messageId);

    // Notify both users via socket
    const io = req.app.get("io");
    if (io) {
      const receiverId = String(msg.receiver);
      const receiverRoom = `user:${receiverId}`;
      const senderRoom = `user:${userId}`;

      io.to(receiverRoom).emit("message_deleted", {
        messageId: String(messageId),
      });
      io.to(senderRoom).emit("message_deleted", {
        messageId: String(messageId),
      });
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
        await cloudinary.api.delete_resources(publicIds);
      } catch (err) {
        console.error(
          "Failed to delete conversation voice files from ImageKit:",
          err,
        );
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
