import express from "express";
import likeModel from "../models/likeModel.js";
import { protectRoutes } from "../middleware/auth.middleware.js";

const router = express.Router();

// Toggle like (like/unlike)
router.post("/:bookId", protectRoutes, async (req, res) => {
  try {
    const { bookId } = req.params;
    const userId = req.user._id;

    const existingLike = await likeModel.findOne({
      user: userId,
      book: bookId,
    });

    if (existingLike) {
      // Unlike
      await likeModel.findByIdAndDelete(existingLike._id);
      return res.status(200).json({
        message: "Unliked successfully",
        liked: false,
      });
    } else {
      // Like
      const newLike = await likeModel.create({
        user: userId,
        book: bookId,
      });
      return res.status(201).json({
        message: "Liked successfully",
        liked: true,
        like: newLike,
      });
    }
  } catch (error) {
    res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
});

// Get all likes for a book
router.get("/:bookId", protectRoutes, async (req, res) => {
  try {
    const { bookId } = req.params;

    const likes = await likeModel
      .find({ book: bookId })
      .populate("user", "username profileImg")
      .sort({ createdAt: -1 });

    res.status(200).json({
      likes,
      count: likes.length,
    });
  } catch (error) {
    res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
});

// Check if current user liked a book
router.get("/:bookId/check", protectRoutes, async (req, res) => {
  try {
    const { bookId } = req.params;
    const userId = req.user._id;

    const like = await likeModel.findOne({
      user: userId,
      book: bookId,
    });

    res.status(200).json({
      liked: !!like,
    });
  } catch (error) {
    res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
});

export default router;
