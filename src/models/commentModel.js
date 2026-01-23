import mongoose from "mongoose";

const commentSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  book: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Book",
    required: true,
  },
  text: {
    type: String,
    required: true,
    trim: true,
  },
  parentComment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Comment",
    default: null, // null for top-level comments, ObjectId for replies
  },
}, { timestamps: true });

const commentModel = mongoose.model("Comment", commentSchema);

export default commentModel;
