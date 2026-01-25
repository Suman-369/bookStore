import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    password: {
        type: String,
        required: true,
        minlength: 6
    },
    profileImg:{
        type:String,
        default:""
    },
    expoPushToken: { type: String, default: "" },
},{timestamps:true})

const userModel = mongoose.model("User",userSchema)

export default userModel