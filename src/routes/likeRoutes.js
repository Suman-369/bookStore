import express from "express";
import likeModel from "../models/likeModel.js";
import bookModel from "../models/bookModel.js";
import userModel from "../models/userModel.js";
import { protectRoutes } from "../middleware/auth.middleware.js";
import { sendExpoPush } from "../lib/pushNotifications.js";

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
      
      // Send notification to book owner
      try {
        const book = await bookModel.findById(bookId).populate("user").lean();
        if (book && book.user && book.user._id.toString() !== userId.toString()) {
          const owner = await userModel.findById(book.user._id).select("expoPushToken").lean();
          if (owner?.expoPushToken) {
            sendExpoPush(owner.expoPushToken, {
              title: "New like",
              body: `${req.user.username} liked your post`,
              data: { type: "like", bookId: String(bookId), userId: String(userId) },
            });
          }
        }
      } catch (e) {
        // Ignore notification errors
      }
      
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
