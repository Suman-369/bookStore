import mongoose from "mongoose";

const likeSchema = new mongoose.Schema({
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
}, { timestamps: true });

// Ensure one like per user per book
likeSchema.index({ user: 1, book: 1 }, { unique: true });

const likeModel = mongoose.model("Like", likeSchema);

export default likeModel;
