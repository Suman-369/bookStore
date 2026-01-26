import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
    },
    profileImg: {
      type: String,
      default: "",
    },
    expoPushToken: {
      type: String,
      default: "",
    },
    lastSeen: { type: Date, default: Date.now },
    blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    // End-to-End Encryption
    publicKey: {
      type: String, // Base64 encoded Curve25519 public key
      default: "",
    },
    e2eeEnabled: {
      type: Boolean,
      default: false, // Only true after public key successfully uploaded
    },
  },
  { timestamps: true },
);

const userModel = mongoose.model("User", userSchema);

export default userModel;
