import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
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
    text: {
      type: String,
      required: function () {
        return !this.voiceMessage && !this.encryptedMessage;
      },
      trim: true,
    },
    voiceMessage: {
      url: { type: String },
      duration: { type: Number }, // Duration in seconds
      cloudinaryPublicId: { type: String },
    },
    // End-to-End Encryption fields
    encryptedMessage: {
      type: String, // Base64 encoded encrypted message
      default: "",
    },
    encryptedSymmetricKey: {
      type: String, // Base64 encoded encrypted AES key
      default: "",
    },
    nonce: {
      type: String, // Base64 encoded nonce
      default: "",
    },
    senderPublicKey: {
      type: String, // Base64 encoded sender's public key used for encryption
      default: "",
    },
    isEncrypted: { type: Boolean, default: false },
    read: { type: Boolean, default: false },
  },
  { timestamps: true },
);

messageSchema.index({ sender: 1, receiver: 1, createdAt: -1 });
messageSchema.index({ receiver: 1, sender: 1, createdAt: -1 });

const messageModel = mongoose.model("Message", messageSchema);
export default messageModel;
