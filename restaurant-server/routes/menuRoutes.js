import express from "express";
import { getMenu, addMenuItem, updateMenuItem, deleteMenuItem, toggleAvailability, getCategoriesWithImage } from "../controllers/menuController.js";
import { protect, dbFromHeader } from "../middleware/authMiddleware.js";
import { requireAdmin, requireStaff } from "../middleware/rbac.js";
// import { uploadMiddleware } from "../middleware/uploadMiddleware.js";
// import { upload } from "../middleware/uploadMiddleware.js";
import multer from "multer";

// Memory storage — no disk, direct to Cloudinary
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
});
// const upload = multer({ dest: "uploads/" });
const router = express.Router();
// Public routes — use dbFromHeader (customer QR scan)
// router.get("/",          dbFromHeader, getMenu);
// router.get("/categories",dbFromHeader, getCategoriesWithImage);
const autoAuth = (req, res, next) =>
  req.headers.authorization?.startsWith("Bearer ")
    ? protect(req, res, next)
    : dbFromHeader(req, res, next);

router.get("/",           autoAuth, getMenu);
router.get("/categories", autoAuth, getCategoriesWithImage);
// Admin routes — use protect (token has mongoUri)
// router.post("/",              protect, uploadMiddleware, addMenuItem);
// router.put("/:id",            protect, uploadMiddleware, updateMenuItem);
router.post("/",              protect, requireAdmin, upload.single("image"), addMenuItem);
router.put("/:id",            protect, requireAdmin, upload.single("image"), updateMenuItem);
router.delete("/:id",         protect, requireAdmin, deleteMenuItem);
// Marking an item 86'd/available again is a routine floor action — staff, not admin-only.
router.patch("/:id/toggle",   protect, requireStaff, toggleAvailability);
export default router;
