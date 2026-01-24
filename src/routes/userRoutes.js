import express from "express";
import userModel from "../models/userModel.js";
import bookModel from "../models/bookModel.js";
import { protectRoutes } from "../middleware/auth.middleware.js";

const router = express.Router();

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
