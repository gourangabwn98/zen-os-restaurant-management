// ─── middleware/uploadMiddleware.js ───────────────────────────────────────────
// Uses multer (in-memory) + cloudinary upload stream
// npm install multer cloudinary

import multer from "multer";
import { Readable } from "stream";
import cloudinary from "../config/cloudinary.js";

// store file in memory buffer (no disk write)
const storage = multer.memoryStorage();

export const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (_, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files allowed"), false);
  },
});

// helper: upload buffer → cloudinary, return secure_url
export const uploadToCloudinary = (buffer, folder = "adda-menu") =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
        transformation: [
          { width: 600, height: 600, crop: "fill", quality: "auto" },
        ],
      },
      (err, result) => {
        if (err) reject(err);
        else resolve(result.secure_url);
      },
    );
    Readable.from(buffer).pipe(stream);
  });

// helper: delete from cloudinary by URL
export const deleteFromCloudinary = async (imageUrl) => {
  if (!imageUrl || !imageUrl.includes("cloudinary.com")) return;
  try {
    // extract public_id from URL
    const parts = imageUrl.split("/");
    const file = parts[parts.length - 1].split(".")[0];
    const folder = parts[parts.length - 2];
    const publicId = `${folder}/${file}`;
    await cloudinary.uploader.destroy(publicId);
  } catch (e) {
    console.warn("Cloudinary delete warn:", e.message);
  }
};
