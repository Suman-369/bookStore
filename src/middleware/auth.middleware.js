import jwt from "jsonwebtoken";
import userModel from "../models/userModel.js";

const COOKIE_NAME = "token";

export async function protectRoutes(req, res, next) {
  try {
    // Check for token in cookies (web) or Authorization header (mobile)
    let token = req.cookies?.[COOKIE_NAME];
    
    // If no token in cookies, check Authorization header
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.substring(7); // Remove "Bearer " prefix
      }
    }

    if (!token) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ message: "Server misconfigured" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded?.id;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await userModel.findById(userId).select("-password");
    if (!user) {
      return res.status(401).json({ message: "Unauthorized: user not found" });
    }

    req.user = user;
    next();
  } catch (error) {
    const msg =
      error?.name === "TokenExpiredError"
        ? "Unauthorized: token expired"
        : "Unauthorized: invalid token";
    return res.status(401).json({ message: msg });
  }
}


