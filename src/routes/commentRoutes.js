import express from "express";
import commentModel from "../models/commentModel.js";
import { protectRoutes } from "../middleware/auth.middleware.js";

const router = express.Router();

// Add a comment (top-level or reply)
router.post("/:bookId", protectRoutes, async (req, res) => {
  try {
    const { bookId } = req.params;
    const { text, parentCommentId } = req.body;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({
        message: "Comment text is required",
      });
    }

    const newComment = await commentModel.create({
      user: req.user._id,
      book: bookId,
      text: text.trim(),
      parentComment: parentCommentId || null,
    });

    const populatedComment = await commentModel
      .findById(newComment._id)
      .populate("user", "username profileImg")
      .populate({
        path: "parentComment",
        populate: { path: "user", select: "username profileImg" },
      });

    res.status(201).json({
      message: "Comment added successfully",
      comment: populatedComment,
    });
  } catch (error) {
    res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
});

// Get all comments for a book
router.get("/:bookId", protectRoutes, async (req, res) => {
  try {
    const { bookId } = req.params;

    // Get all comments for this book
    const allComments = await commentModel
      .find({ book: bookId })
      .populate("user", "username profileImg")
      .sort({ createdAt: 1 });

    // Separate top-level comments and replies
    const topLevelComments = allComments.filter(
      (comment) => !comment.parentComment
    );

    // Organize replies under their parent comments
    const commentsWithReplies = topLevelComments.map((comment) => {
      const replies = allComments.filter(
        (reply) =>
          reply.parentComment &&
          reply.parentComment.toString() === comment._id.toString()
      );
      return {
        ...comment.toObject(),
        replies: replies.sort((a, b) => a.createdAt - b.createdAt),
      };
    });

    res.status(200).json({
      comments: commentsWithReplies,
      count: topLevelComments.length,
      totalCount: allComments.length,
    });
  } catch (error) {
    res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
});

// Delete a comment
router.delete("/:commentId", protectRoutes, async (req, res) => {
  try {
    const { commentId } = req.params;
    const userId = req.user._id;

    const comment = await commentModel.findById(commentId);

    if (!comment) {
      return res.status(404).json({
        message: "Comment not found",
      });
    }

    // Check if user owns the comment
    if (comment.user.toString() !== userId.toString()) {
      return res.status(403).json({
        message: "Unauthorized - You can only delete your own comments",
      });
    }

    // Delete the comment and all its replies
    await commentModel.deleteMany({
      $or: [
        { _id: commentId },
        { parentComment: commentId },
      ],
    });

    res.status(200).json({
      message: "Comment deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
});

export default router;
