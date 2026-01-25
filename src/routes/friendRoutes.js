import express from "express";
import friendModel from "../models/friendModel.js";
import userModel from "../models/userModel.js";
import { protectRoutes } from "../middleware/auth.middleware.js";
import { sendExpoPush } from "../lib/pushNotifications.js";

const router = express.Router();

// Send friend request
router.post("/request", protectRoutes, async (req, res) => {
  try {
    const { receiverId } = req.body;
    const senderId = req.user._id;

    if (!receiverId) {
      return res.status(400).json({
        message: "Receiver ID is required",
      });
    }

    if (senderId.toString() === receiverId.toString()) {
      return res.status(400).json({
        message: "Cannot send friend request to yourself",
      });
    }

    // Check if receiver exists
    const receiver = await userModel.findById(receiverId);
    if (!receiver) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    // Check if friend request already exists
    const existingRequest = await friendModel.findOne({
      $or: [
        { sender: senderId, receiver: receiverId },
        { sender: receiverId, receiver: senderId },
      ],
    });

    if (existingRequest) {
      if (existingRequest.status === "accepted") {
        return res.status(400).json({
          message: "You are already friends",
        });
      }
      if (existingRequest.status === "pending") {
        if (existingRequest.sender.toString() === senderId.toString()) {
          return res.status(400).json({
            message: "Friend request already sent",
          });
        } else {
          // If receiver is trying to send request back, accept it
          existingRequest.status = "accepted";
          await existingRequest.save();
          return res.status(200).json({
            message: "Friend request accepted",
            request: existingRequest,
          });
        }
      }
    }

    // Create new friend request
    const friendRequest = await friendModel.create({
      sender: senderId,
      receiver: receiverId,
      status: "pending",
    });

    const populatedRequest = await friendModel
      .findById(friendRequest._id)
      .populate("sender", "username profileImg")
      .populate("receiver", "username profileImg");

    // Send notification to receiver
    try {
      const receiverUser = await userModel.findById(receiverId).select("expoPushToken").lean();
      if (receiverUser?.expoPushToken) {
        sendExpoPush(receiverUser.expoPushToken, {
          title: "New friend request",
          body: `${req.user.username} sent you a friend request`,
          data: { type: "friend_request", senderId: String(senderId) },
        });
      }
    } catch (e) {
      // Ignore notification errors
    }

    res.status(201).json({
      message: "Friend request sent successfully",
      request: populatedRequest,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        message: "Friend request already exists",
      });
    }
    res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
});

// Accept friend request
router.post("/accept", protectRoutes, async (req, res) => {
  try {
    const { senderId } = req.body;
    const receiverId = req.user._id;

    if (!senderId) {
      return res.status(400).json({
        message: "Sender ID is required",
      });
    }

    const friendRequest = await friendModel.findOne({
      sender: senderId,
      receiver: receiverId,
      status: "pending",
    });

    if (!friendRequest) {
      return res.status(404).json({
        message: "Friend request not found",
      });
    }

    friendRequest.status = "accepted";
    await friendRequest.save();

    const populatedRequest = await friendModel
      .findById(friendRequest._id)
      .populate("sender", "username profileImg")
      .populate("receiver", "username profileImg");

    const accepterName = req.user?.username || "Someone";
    const senderUser = await userModel.findById(senderId).select("expoPushToken").lean();
    if (senderUser?.expoPushToken) {
      sendExpoPush(senderUser.expoPushToken, {
        title: "Friend request accepted",
        body: `${accepterName} accepted your friend request`,
        data: { type: "friend_accept", accepterId: String(receiverId) },
      });
    }

    res.status(200).json({
      message: "Friend request accepted",
      request: populatedRequest,
    });
  } catch (error) {
    res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
});

// Reject friend request
router.post("/reject", protectRoutes, async (req, res) => {
  try {
    const { senderId } = req.body;
    const receiverId = req.user._id;

    if (!senderId) {
      return res.status(400).json({
        message: "Sender ID is required",
      });
    }

    const friendRequest = await friendModel.findOne({
      sender: senderId,
      receiver: receiverId,
      status: "pending",
    });

    if (!friendRequest) {
      return res.status(404).json({
        message: "Friend request not found",
      });
    }

    friendRequest.status = "rejected";
    await friendRequest.save();

    res.status(200).json({
      message: "Friend request rejected",
    });
  } catch (error) {
    res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
});

// Cancel friend request (sender cancels their own request)
router.post("/cancel", protectRoutes, async (req, res) => {
  try {
    const { receiverId } = req.body;
    const senderId = req.user._id;

    if (!receiverId) {
      return res.status(400).json({
        message: "Receiver ID is required",
      });
    }

    const friendRequest = await friendModel.findOne({
      sender: senderId,
      receiver: receiverId,
      status: "pending",
    });

    if (!friendRequest) {
      return res.status(404).json({
        message: "Friend request not found",
      });
    }

    await friendModel.findByIdAndDelete(friendRequest._id);

    res.status(200).json({
      message: "Friend request cancelled",
    });
  } catch (error) {
    res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
});

// Unfriend
router.post("/unfriend", protectRoutes, async (req, res) => {
  try {
    const { friendId } = req.body;
    const userId = req.user._id;

    if (!friendId) {
      return res.status(400).json({
        message: "Friend ID is required",
      });
    }

    const friendship = await friendModel.findOne({
      $or: [
        { sender: userId, receiver: friendId, status: "accepted" },
        { sender: friendId, receiver: userId, status: "accepted" },
      ],
    });

    if (!friendship) {
      return res.status(404).json({
        message: "Friendship not found",
      });
    }

    await friendModel.findByIdAndDelete(friendship._id);

    res.status(200).json({
      message: "Unfriended successfully",
    });
  } catch (error) {
    res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
});

// Get friend status between current user and another user
router.get("/status/:userId", protectRoutes, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user._id;

    if (currentUserId.toString() === userId.toString()) {
      return res.status(200).json({
        status: "self",
      });
    }

    const friendship = await friendModel.findOne({
      $or: [
        { sender: currentUserId, receiver: userId },
        { sender: userId, receiver: currentUserId },
      ],
    });

    if (!friendship) {
      return res.status(200).json({
        status: "none",
      });
    }

    if (friendship.status === "accepted") {
      return res.status(200).json({
        status: "friends",
      });
    }

    if (friendship.status === "pending") {
      if (friendship.sender.toString() === currentUserId.toString()) {
        return res.status(200).json({
          status: "requested",
        });
      } else {
        return res.status(200).json({
          status: "pending",
        });
      }
    }

    return res.status(200).json({
      status: "none",
    });
  } catch (error) {
    res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
});

// Get friend count for a user
router.get("/count/:userId", protectRoutes, async (req, res) => {
  try {
    const { userId } = req.params;

    const friendCount = await friendModel.countDocuments({
      $or: [
        { sender: userId, status: "accepted" },
        { receiver: userId, status: "accepted" },
      ],
    });

    res.status(200).json({
      count: friendCount,
    });
  } catch (error) {
    res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
});

// Get received friend requests
router.get("/requests/received", protectRoutes, async (req, res) => {
  try {
    const userId = req.user._id;

    const friendRequests = await friendModel
      .find({
        receiver: userId,
        status: "pending",
      })
      .populate("sender", "username profileImg email")
      .sort({ createdAt: -1 });

    res.status(200).json({
      requests: friendRequests,
    });
  } catch (error) {
    res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
});

// Get sent friend requests
router.get("/requests/sent", protectRoutes, async (req, res) => {
  try {
    const userId = req.user._id;

    const friendRequests = await friendModel
      .find({
        sender: userId,
        status: "pending",
      })
      .populate("receiver", "username profileImg email")
      .sort({ createdAt: -1 });

    res.status(200).json({
      requests: friendRequests,
    });
  } catch (error) {
    res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
});

// Get all friends list (current user's friends)
router.get("/list", protectRoutes, async (req, res) => {
  try {
    const userId = req.user._id;

    const friendships = await friendModel
      .find({
        $or: [
          { sender: userId, status: "accepted" },
          { receiver: userId, status: "accepted" },
        ],
      })
      .populate("sender", "username profileImg email")
      .populate("receiver", "username profileImg email")
      .sort({ createdAt: -1 });

    // Extract friends (excluding the current user). Skip if sender/receiver failed to populate (e.g. deleted user).
    const friends = friendships
      .filter((f) => f.sender && f.receiver)
      .map((friendship) => {
        if (friendship.sender._id.toString() === userId.toString()) {
          return friendship.receiver;
        }
        return friendship.sender;
      });

    res.status(200).json({
      friends,
    });
  } catch (error) {
    res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
});

// Get specific user's friends list
router.get("/list/:userId", protectRoutes, async (req, res) => {
  try {
    const { userId } = req.params;

    const friendships = await friendModel
      .find({
        $or: [
          { sender: userId, status: "accepted" },
          { receiver: userId, status: "accepted" },
        ],
      })
      .populate("sender", "username profileImg email")
      .populate("receiver", "username profileImg email")
      .sort({ createdAt: -1 });

    // Extract friends (excluding the target user). Skip if sender/receiver failed to populate (e.g. deleted user).
    const friends = friendships
      .filter((f) => f.sender && f.receiver)
      .map((friendship) => {
        if (friendship.sender._id.toString() === userId.toString()) {
          return friendship.receiver;
        }
        return friendship.sender;
      });

    res.status(200).json({
      friends,
    });
  } catch (error) {
    res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
});

export default router;
