import express from "express";
import { getRestaurantProfile, updateRestaurantProfile, uploadRestaurantLogo } from "../controllers/profileController.js";
import { protect, dbFromHeader } from "../middleware/authMiddleware.js";
import { requireAdmin } from "../middleware/rbac.js";
import { isPhonePeConfigured } from "../services/paymentService.js";
// import { uploadMiddleware } from "../middleware/uploadMiddleware.js";
import { upload } from "../middleware/uploadMiddleware.js";
const router = express.Router();
// router.get("/profile",  dbFromHeader, getRestaurantProfile);
router.get("/profile", async (req, res, next) => {
  // If has JWT token → use protect logic inline, else use dbFromHeader
  if (req.headers.authorization?.startsWith("Bearer ")) {
    return protect(req, res, next);
  }
  return dbFromHeader(req, res, next);
}, getRestaurantProfile);
// Restaurant-wide settings (GST rate, service charge, etc.) — admin only.
router.put("/profile",  protect, requireAdmin, updateRestaurantProfile);
// router.post("/logo",    protect,      uploadMiddleware, uploadRestaurantLogo);
router.post("/logo",    protect, requireAdmin, upload.single("logo"), uploadRestaurantLogo);
// In restaurantRoutes.js or profileRoutes.js — no protect middleware
// NOTE: this previously had no tenant-resolving middleware at all, so
// req.models was undefined and every call 500'd. dbFromHeader fixes that
// without changing the route's (public, read-only) behaviour.
router.get("/restaurant/profile", dbFromHeader, async (req, res) => {
  try {
    const { RestaurantProfile } = req.models;
    const profile = await RestaurantProfile.findOne();
    if (!profile) return res.status(404).json({ message: "Profile not found" });
    // `phonePeEnabled` reflects backend .env config (the salt key is a secret,
    // so it lives there, not on the profile document). The customer app uses
    // it to decide whether to offer "Pay with PhonePe".
    res.json({ success: true, data: { ...profile.toObject(), phonePeEnabled: isPhonePeConfigured() } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
export default router;
