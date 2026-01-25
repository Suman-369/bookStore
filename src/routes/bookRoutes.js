import express from "express";
import fs from "fs/promises";
import cloudinary from "../db/cloudinary.js";
import bookModel from "../models/bookModel.js";
import likeModel from "../models/likeModel.js";
import commentModel from "../models/commentModel.js";
import userModel from "../models/userModel.js";
import { protectRoutes } from "../middleware/auth.middleware.js";
import { uploadMedia } from "../middleware/upload.middleware.js";

const router = express.Router();

//create a book (multipart/form-data: media file + title, caption, rating, mediaType)
router.post("/create", protectRoutes, (req, res, next) => {
    uploadMedia(req, res, (err) => {
        if (err) {
            if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ message: "File too large. Maximum 100MB for video (with audio) or image." });
            return res.status(400).json({ message: err.message || "Upload failed" });
        }
        next();
    });
}, async (req, res) => {
    let tempPath = null;
    try {
        const { title, caption, rating, mediaType } = req.body;
        const file = req.file;
        if (!title || !caption || !rating) {
            return res.status(400).json({ message: "All fields are required" });
        }
        if (!file) {
            return res.status(400).json({ message: "Please select an image or video" });
        }
        const r = Number(rating);
        if (!Number.isFinite(r) || r < 1 || r > 5) {
            return res.status(400).json({ message: "Rating must be between 1 and 5" });
        }
        const type = (mediaType === "video" ? "video" : "image");
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

        res.status(201).json({ message: "Book created successfully", book: newBook });
    } catch (error) {
        if (tempPath) await fs.unlink(tempPath).catch(() => {});
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
})


//fetch all books
router.get("/all", protectRoutes, async (req, res) => {
    try {
        const userId = req.user._id;
        const page = req.query.page||1
        const limit  = req.query.limit || 5

        const skip = (page-1)*limit

        const books = await bookModel.find()
        .populate("user","username profileImg")
        .sort({createdAt:-1})
        .skip(skip)
        .limit(limit)

        // Get likes and comments count for each book, and check if current user liked
        const booksWithStats = await Promise.all(
            books.map(async (book) => {
                const likesCount = await likeModel.countDocuments({ book: book._id });
                const commentsCount = await commentModel.countDocuments({ book: book._id });
                const isLiked = await likeModel.findOne({ user: userId, book: book._id });

                return {
                    ...book.toObject(),
                    likesCount,
                    commentsCount,
                    isLiked: !!isLiked,
                };
            })
        );

        const totalBooks = await bookModel.countDocuments()

        res.send({
            books: booksWithStats,
            currentPage:page,
            totalBooks,
            totalPages:Math.ceil(totalBooks/limit)
        })

    } catch (error) {
        res.status(500).json({
            message:"Internal server error",
            error:error.message
        })
    }
})


//get recomnded books (current user's books)
router.get("/user", protectRoutes, async (req, res) => {
    try {
        const books = await bookModel.find({user:req.user._id}).sort({rating:-1}).limit(5)
        res.status(200).json({
            books
        })
    } catch (error) {
        res.status(500).json({
            message:"Internal server error",
            error:error.message
        })
    }
})

//get specific user's books
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
})


//delete a book
router.delete("/delete/:id", protectRoutes, async (req, res) => {
    try {
        const {id} = req.params
        const book = await bookModel.findById(id)
        if(!book){
            return res.status(404).json({
                message:"Book not found"
            })
        }
        if(book.user.toString() !== req.user._id.toString()){
            return res.status(403).json({
                message:"Unauthorized"
            })
        }

        if (book.image && book.image.includes("cloudinary")) {
            try {
                const publicId = book.cloudinaryPublicId || book.image.split("/").pop().split(".")[0];
                const resourceType = book.mediaType === "video" ? "video" : "image";
                await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
            } catch (error) {
                return res.status(500).json({
                    message: "Error deleting media from Cloudinary",
                    error: error.message,
                });
            }
        }
        await bookModel.findByIdAndDelete(id)

        res.status(200).json({
            message:"Book deleted successfully"
        })
    } catch (error) {
        res.status(500).json({
            message:"Internal server error",
            error:error.message
        })
    }
})




export default router;