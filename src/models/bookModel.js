import mongoose from "mongoose";

const bookSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
    },
    caption: {
      type: String,
      required: true,
    },
    image: {
      type: String,
      required: true,
    },
    imagekitPublicId: {
      type: String,
      default: null,
    },
    mediaType: {
      type: String,
      enum: ["image", "video"],
      default: "image",
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

const bookModel = mongoose.model("Book", bookSchema);

export default bookModel;
