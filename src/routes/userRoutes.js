import express from "express";
import userModel from "../models/userModel.js";
import bookModel from "../models/bookModel.js";
import { protectRoutes } from "../middleware/auth.middleware.js";
import * as onlineStore from "../lib/onlineStore.js";

const router = express.Router();

/** GET /users/online-status?ids=id1,id2 – returns { id1: true, id2: false } */
router.get("/online-status", protectRoutes, (req, res) => {
  try {
    const ids = req.query.ids;
    const arr = Array.isArray(ids) ? ids : ids ? String(ids).split(",") : [];
    const status = onlineStore.getStatus(arr);
    return res.json(status);
  } catch (e) {
    return res.status(500).json({ message: "Failed to get online status" });
  }
});

/** GET /users/last-seen?ids=id1,id2 – returns { id1: "2024-01-01T00:00:00Z", id2: "2024-01-02T00:00:00Z" } */
router.get("/last-seen", protectRoutes, async (req, res) => {
  try {
    const ids = req.query.ids;
    const arr = Array.isArray(ids) ? ids : ids ? String(ids).split(",") : [];
    if (!arr.length) return res.json({});
    
    const users = await userModel.find({ _id: { $in: arr } }).select("_id lastSeen").lean();
    const lastSeenMap = {};
    users.forEach((user) => {
      lastSeenMap[String(user._id)] = user.lastSeen || user.createdAt || new Date();
    });
    return res.json(lastSeenMap);
  } catch (e) {
    return res.status(500).json({ message: "Failed to get last seen" });
  }
});

/** POST /users/push-token – register Expo push token */
router.post("/push-token", protectRoutes, async (req, res) => {
  try {
    const { token } = req.body;
    const userId = req.user._id;
    if (!token || typeof token !== "string") {
      return res.status(400).json({ message: "Token required" });
    }
    await userModel.findByIdAndUpdate(userId, {
      $set: { expoPushToken: token.trim() },
    });
    return res.json({ message: "Push token registered" });
  } catch (e) {
    return res.status(500).json({ message: "Failed to register push token" });
  }
});

// Get user by ID
router.get("/:userId", protectRoutes, async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await userModel.findById(userId).select("-password");

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    res.status(200).json({
      user,
    });
  } catch (error) {
    res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
});

// Get user's books/posts
router.get("/:userId/books", protectRoutes, async (req, res) => {
  try {
    const { userId } = req.params;

    // Verify user exists
    const user = await userModel.findById(userId);
    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    const books = await bookModel
      .find({ user: userId })
      .sort({ createdAt: -1 })
      .populate("user", "username profileImg");

    res.status(200).json({
      books,
    });
  } catch (error) {
    res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
});

export default router;
