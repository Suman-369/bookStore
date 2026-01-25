import express from "express";
import { protectRoutes } from "../middleware/auth.middleware.js";
import messageModel from "../models/messageModel.js";
import userModel from "../models/userModel.js";

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
            text: c.lastMessage.text,
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

    await messageModel.updateMany(
      { sender: otherUserId, receiver: userId, read: false },
      { $set: { read: true } }
    );

    return res.json({ messages: reversed, hasMore: messages.length === limit });
  } catch (err) {
    console.error("GET /:otherUserId", err);
    return res.status(500).json({ message: "Failed to fetch messages" });
  }
});

/** POST /messages – send message (persist). Used when socket unavailable or fallback. */
router.post("/", protectRoutes, async (req, res) => {
  try {
    const { receiverId, text } = req.body;
    const senderId = req.user._id;

    if (!receiverId || !text || typeof text !== "string") {
      return res.status(400).json({ message: "receiverId and text required" });
    }

    const trimmed = text.trim();
    if (!trimmed) {
      return res.status(400).json({ message: "Message cannot be empty" });
    }

    const receiver = await userModel.findById(receiverId).select("_id");
    if (!receiver) {
      return res.status(404).json({ message: "User not found" });
    }

    const msg = await messageModel.create({
      sender: senderId,
      receiver: receiverId,
      text: trimmed,
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

    return res.status(201).json({ message: populated });
  } catch (err) {
    console.error("POST /messages", err);
    return res.status(500).json({ message: "Failed to send message" });
  }
});

export default router;
