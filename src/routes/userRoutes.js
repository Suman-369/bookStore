import express from "express";
import userModel from "../models/userModel.js";
import bookModel from "../models/bookModel.js";
import { protectRoutes } from "../middleware/auth.middleware.js";
import * as onlineStore from "../lib/onlineStore.js";
import { validatePublicKey } from "../utils/cryptoUtils.js";

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

/** GET /users/:userId/public-key – get user's public key for E2EE */
router.get("/:userId/public-key", protectRoutes, async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await userModel.findById(userId).select("publicKey _id").lean();

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (!user.publicKey) {
      return res.status(400).json({
        message: "User has not set up E2EE yet",
      });
    }

    return res.json({
      userId: user._id,
      publicKey: user.publicKey,
    });
  } catch (error) {
    console.error("GET /users/:userId/public-key", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
});

/** POST /users/upload-public-key – upload user's public key */
router.post("/upload-public-key", protectRoutes, async (req, res) => {
  try {
    const { publicKey } = req.body;
    const userId = req.user._id;

    if (!publicKey || typeof publicKey !== "string") {
      return res.status(400).json({
        message: "Public key is required and must be a string",
      });
    }

    // Validate public key format
    if (!validatePublicKey(publicKey)) {
      return res.status(400).json({
        message: "Invalid public key format",
      });
    }

    // Update user's public key
    await userModel.findByIdAndUpdate(userId, {
      $set: { publicKey: publicKey.trim() },
    });

    return res.json({
      message: "Public key uploaded successfully",
    });
  } catch (error) {
    console.error("POST /users/upload-public-key", error);
    return res.status(500).json({
      message: "Failed to upload public key",
    });
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

/** POST /users/block – block a user */
router.post("/block", protectRoutes, async (req, res) => {
  try {
    const { userId } = req.body;
    const currentUserId = req.user._id;

    if (!userId || userId === currentUserId.toString()) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const userToBlock = await userModel.findById(userId);
    if (!userToBlock) {
      return res.status(404).json({ message: "User not found" });
    }

    const currentUser = await userModel.findById(currentUserId);
    if (!currentUser.blockedUsers) {
      currentUser.blockedUsers = [];
    }

    // Check if already blocked
    if ((currentUser.blockedUsers || []).some((id) => String(id) === String(userId))) {
      return res.status(400).json({ message: "User is already blocked" });
    }

    currentUser.blockedUsers.push(userId);
    await currentUser.save();

    return res.json({ message: "User blocked successfully" });
  } catch (error) {
    console.error("POST /users/block", error);
    return res.status(500).json({ message: "Failed to block user" });
  }
});

/** POST /users/unblock – unblock a user */
router.post("/unblock", protectRoutes, async (req, res) => {
  try {
    const { userId } = req.body;
    const currentUserId = req.user._id;

    if (!userId) {
      return res.status(400).json({ message: "User ID required" });
    }

    const currentUser = await userModel.findById(currentUserId);
    if (!currentUser.blockedUsers) {
      return res.status(400).json({ message: "User is not blocked" });
    }

    currentUser.blockedUsers = currentUser.blockedUsers.filter(
      (id) => id.toString() !== userId
    );
    await currentUser.save();

    return res.json({ message: "User unblocked successfully" });
  } catch (error) {
    console.error("POST /users/unblock", error);
    return res.status(500).json({ message: "Failed to unblock user" });
  }
});

/** GET /users/blocked – get list of blocked users */
router.get("/blocked/list", protectRoutes, async (req, res) => {
  try {
    const currentUser = await userModel
      .findById(req.user._id)
      .populate("blockedUsers", "username profileImg _id")
      .select("blockedUsers")
      .lean();

    return res.json({
      blockedUsers: currentUser?.blockedUsers || [],
    });
  } catch (error) {
    console.error("GET /users/blocked/list", error);
    return res.status(500).json({ message: "Failed to fetch blocked users" });
  }
});

export default router;
