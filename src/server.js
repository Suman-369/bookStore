import express from "express";
import "dotenv/config";
import cookieParser from "cookie-parser";
import authRoutes from "./routes/authRoutes.js";
import bookRoutes from "./routes/bookRoutes.js";
import connectDB from "./db/db.js";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;


connectDB();

app.use(express.json());
app.use(cookieParser());
app.use(cors())

app.use("/api/auth", authRoutes);
app.use("/api/books", bookRoutes);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});