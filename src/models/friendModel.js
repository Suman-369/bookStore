import mongoose from "mongoose";

const friendSchema = new mongoose.Schema({
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  receiver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  status: {
    type: String,
    enum: ["pending", "accepted", "rejected"],
    default: "pending",
  },
}, { timestamps: true });

// Compound index to ensure unique friend relationships
friendSchema.index({ sender: 1, receiver: 1 }, { unique: true });

// Index for faster queries
friendSchema.index({ receiver: 1, status: 1 });
friendSchema.index({ sender: 1, status: 1 });

const friendModel = mongoose.model("Friend", friendSchema);

export default friendModel;
