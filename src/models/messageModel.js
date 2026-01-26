import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    receiver: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    text: { type: String, required: function() { return !this.voiceMessage; }, trim: true },
    voiceMessage: {
      url: { type: String },
      duration: { type: Number }, // Duration in seconds
      cloudinaryPublicId: { type: String },
    },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

messageSchema.index({ sender: 1, receiver: 1, createdAt: -1 });
messageSchema.index({ receiver: 1, sender: 1, createdAt: -1 });

const messageModel = mongoose.model("Message", messageSchema);
export default messageModel;
