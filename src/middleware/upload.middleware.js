import multer from "multer";
import path from "path";
import os from "os";
import fs from "fs";

const uploadDir = path.join(os.tmpdir(), "ma-uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || (file.mimetype?.startsWith("video/") ? ".mp4" : ".jpg");
    const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB for videos (with audio)
  fileFilter: (_req, file, cb) => {
    const allowed = /^image\/(jpeg|jpg|png|gif|webp)|^video\/(mp4|quicktime|x-m4v|3gpp)$/i;
    if (allowed.test(file.mimetype)) return cb(null, true);
    cb(new Error("Invalid file type. Use image (JPEG/PNG/GIF/WEBP) or video (MP4/MOV)."));
  },
});

const uploadAudio = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB for audio files
  fileFilter: (_req, file, cb) => {
    const allowed = /^audio\/(mpeg|mp3|wav|aac|ogg|m4a|webm)$/i;
    if (allowed.test(file.mimetype)) return cb(null, true);
    cb(new Error("Invalid file type. Use audio (MP3/WAV/AAC/OGG/M4A/WEBM)."));
  },
});

export const uploadMedia = upload.single("media");
export const uploadVoiceMessage = uploadAudio.single("voice");
