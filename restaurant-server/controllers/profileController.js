// controllers/profileController.js
import cloudinary  from "../config/cloudinary.js";
import streamifier from "streamifier";

const uploadToCloudinary = (buffer, folder = "restaurant") =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, allowed_formats: ["jpg","jpeg","png","webp","avif"],
        transformation: [{ width: 400, height: 400, crop: "limit", quality: "auto" }] },
      (error, result) => { if (error) return reject(error); resolve(result.secure_url); }
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });

export const getRestaurantProfile = async (req, res) => {
  try {
    const { RestaurantProfile } = req.models;
    const profile = await RestaurantProfile.findOne();
    if (!profile) return res.status(404).json({ message: "Profile not found" });
    res.json({ data: profile });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const updateRestaurantProfile = async (req, res) => {
  try {
    const { RestaurantProfile } = req.models;
    let profile = await RestaurantProfile.findOne();
    if (!profile) {
      profile = await RestaurantProfile.create({ restaurantName: req.body.restaurantName || "Restaurant", ...req.body });
    } else {
      Object.assign(profile, req.body);
      await profile.save();
    }
    res.json({ success: true, data: profile });
  } catch (err) { res.status(400).json({ message: err.message }); }
};

export const uploadRestaurantLogo = async (req, res) => {
  try {
    const { RestaurantProfile } = req.models;
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const url = await uploadToCloudinary(req.file.buffer, "adda-logos");
    const profile = await RestaurantProfile.findOneAndUpdate({}, { logo: url }, { new: true, upsert: true });
    res.json({ success: true, logo: url, data: profile });
  } catch (err) { res.status(500).json({ message: err.message }); }
};
