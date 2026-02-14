import express from "express";
import fs from "fs/promises";
import cloudinary from "../db/cloudinary.js";
import bookModel from "../models/bookModel.js";
import likeModel from "../models/likeModel.js";
import commentModel from "../models/commentModel.js";
import userModel from "../models/userModel.js";
import friendModel from "../models/friendModel.js";
import { protectRoutes } from "../middleware/auth.middleware.js";
import { uploadMedia } from "../middleware/upload.middleware.js";
import { sendExpoPush } from "../lib/pushNotifications.js";

const router = express.Router();

//create a book (multipart/form-data: media file + title, caption, rating, mediaType)
router.post(
  "/create",
  protectRoutes,
  (req, res, next) => {
    uploadMedia(req, res, (err) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE")
          return res
            .status(413)
            .json({
              message:
                "File too large. Maximum 100MB for video (with audio) or image.",
            });
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
      const { title, caption, rating, mediaType } = req.body;
      const file = req.file;
      if (!title || !caption || !rating) {
        return res.status(400).json({ message: "All fields are required" });
      }
      if (!file) {
        return res
          .status(400)
          .json({ message: "Please select an image or video" });
      }
      const r = Number(rating);
      if (!Number.isFinite(r) || r < 1 || r > 5) {
        return res
          .status(400)
          .json({ message: "Rating must be between 1 and 5" });
      }
      const type = mediaType === "video" ? "video" : "image";
      tempPath = file.path;
      const uploadOptions = { resource_type: type };
      const result = await cloudinary.uploader.upload(tempPath, uploadOptions);
      const mediaUrl = result.secure_url;
      const publicId = result.public_id || null;
      await fs.unlink(tempPath).catch(() => {});
      tempPath = null;

      const newBook = await bookModel.create({
        title,
        caption,
        image: mediaUrl,
        cloudinaryPublicId: publicId,
        mediaType: type,
        rating: r,
        user: req.user._id,
      });

      // Send notifications to all friends when a post is created
      try {
        const userId = req.user._id;
        const username = req.user.username || "Someone";

        // Get all accepted friendships where user is either sender or receiver
        const friendships = await friendModel
          .find({
            $or: [
              { sender: userId, status: "accepted" },
              { receiver: userId, status: "accepted" },
            ],
          })
          .select("sender receiver")
          .lean();

        // Extract friend IDs (excluding the current user)
        const friendIds = friendships
          .map((friendship) => {
            if (String(friendship.sender) === String(userId)) {
              return friendship.receiver;
            }
            return friendship.sender;
          })
          .filter(Boolean);

        // Get all friends with push tokens
        if (friendIds.length > 0) {
          const friendsWithTokens = await userModel
            .find({
              _id: { $in: friendIds },
              expoPushToken: { $exists: true, $ne: "" },
            })
            .select("expoPushToken")
            .lean();

          // Collect all valid push tokens
          const pushTokens = friendsWithTokens
            .map((friend) => friend.expoPushToken)
            .filter((token) => token && typeof token === "string");

          // Send notification to all friends at once (batch send)
          if (pushTokens.length > 0) {
            const postTitle =
              title.length > 40 ? title.slice(0, 37) + "…" : title;
            sendExpoPush(pushTokens, {
              title: "New post from " + username,
              body: postTitle,
              data: {
                type: "post",
                bookId: String(newBook._id),
                userId: String(userId),
              },
            });
          }
        }
      } catch (e) {
        // Ignore notification errors - don't fail the post creation
        console.warn("Error sending post notifications:", e?.message || e);
      }

      res
        .status(201)
        .json({ message: "Book created successfully", book: newBook });
    } catch (error) {
      if (tempPath) await fs.unlink(tempPath).catch(() => {});
      res
        .status(500)
        .json({ message: "Internal server error", error: error.message });
    }
  },
);

//fetch all books
router.get("/all", protectRoutes, async (req, res) => {
  try {
    const userId = req.user._id;
    const page = req.query.page || 1;
    const limit = req.query.limit || 5;

    const skip = (page - 1) * limit;

    const books = await bookModel
      .find()
      .populate("user", "username profileImg")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // Get likes and comments count for each book, and check if current user liked
    const booksWithStats = await Promise.all(
      books.map(async (book) => {
        const likesCount = await likeModel.countDocuments({ book: book._id });
        const commentsCount = await commentModel.countDocuments({
          book: book._id,
        });
        const isLiked = await likeModel.findOne({
          user: userId,
          book: book._id,
        });

        return {
          ...book.toObject(),
          likesCount,
          commentsCount,
          isLiked: !!isLiked,
        };
      }),
    );

    const totalBooks = await bookModel.countDocuments();

    res.send({
      books: booksWithStats,
      currentPage: page,
      totalBooks,
      totalPages: Math.ceil(totalBooks / limit),
    });
  } catch (error) {
    res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
});

//get recomnded books (current user's books)
router.get("/user", protectRoutes, async (req, res) => {
  try {
    const books = await bookModel
      .find({ user: req.user._id })
      .sort({ rating: -1 })
      .limit(5);
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

//get specific user's books (must be before /:id route)
router.get("/user/:userId", protectRoutes, async (req, res) => {
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

//get a single book by ID (must be after all specific routes)
router.get("/:id", protectRoutes, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const book = await bookModel
      .findById(id)
      .populate("user", "username profileImg");

    if (!book) {
      return res.status(404).json({
        message: "Book not found",
      });
    }

    // Get likes and comments count, and check if current user liked
    const likesCount = await likeModel.countDocuments({ book: book._id });
    const commentsCount = await commentModel.countDocuments({ book: book._id });
    const isLiked = await likeModel.findOne({ user: userId, book: book._id });

    const bookWithStats = {
      ...book.toObject(),
      likesCount,
      commentsCount,
      isLiked: !!isLiked,
    };

    res.status(200).json({
      book: bookWithStats,
    });
  } catch (error) {
    res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
});

//delete a book
router.delete("/delete/:id", protectRoutes, async (req, res) => {
  try {
    const { id } = req.params;
    const book = await bookModel.findById(id);
    if (!book) {
      return res.status(404).json({
        message: "Book not found",
      });
    }
    if (book.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        message: "Unauthorized",
      });
    }

    if (book.cloudinaryPublicId) {
      try {
        const publicId = book.cloudinaryPublicId;
        await cloudinary.uploader.destroy(publicId);
      } catch (error) {
        console.error("Error deleting media from ImageKit:", error.message);
        // Continue with database deletion even if ImageKit deletion fails
      }
    }
    await bookModel.findByIdAndDelete(id);

    res.status(200).json({
      message: "Book deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
});

export default router;
