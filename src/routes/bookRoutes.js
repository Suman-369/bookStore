import express from "express";
import cloudinary from "../db/cloudinary.js";
import bookModel from "../models/bookModel.js";
import { protectRoutes } from "../middleware/auth.middleware.js";

const router = express.Router();

//create a book
router.post("/create", protectRoutes, async (req, res) => {
    try {
        const {title,caption,image,rating} = req.body
        if(!title || !caption || !image || !rating) {
            return res.status(400).json({
                message:"All fields are required"
            })
        }
        if(rating<1 || rating>5) {
            return res.status(400).json({
                message:"Rating must be between 1 and 5"
            })
        }
        const result = await cloudinary.uploader.upload(image)

        const imageUrl = result.secure_url

        const newBook = await bookModel.create({
            title,
            caption,
            image:imageUrl,
            rating,
            user: req.user._id
        })

        res.status(201).json({
            message:"Book created successfully",
            book:newBook
        })

    } catch (error) {
        res.status(500).json({
            message:"Internal server error",
            error:error.message
        })
    }
})


//fetch all books
router.get("/all", protectRoutes, async (req, res) => {
    try {

        const page = req.query.page||1
        const limit  = req.query.limit || 2

        const skip = (page-1)*limit

        const books = await bookModel.find()
        .populate("user","username profileImg")
        .sort({createdAt:-1})
        .skip(skip)
        .limit(limit)

        const totalBooks = await bookModel.countDocuments()

        res.send({
            books,
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


//get recomnded books
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

        if(book.image && book.image.includes("cloudinary")){
            try {
                const publicId = book.image.split("/").pop().split(".")[0]
                await cloudinary.uploader.destroy(publicId)
            } catch (error) {
                return res.status(500).json({
                    message:"Error deleting image from Cloudinary",
                    error:error.message
                })
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