import express from "express";
import {
  getMenu, getBestSellers, addMenuItem, updateMenuItem, deleteMenuItem, toggleAvailability, getCategoriesWithImage, bulkUpdateSchedule,
  setItemsAvailability, bulkEditMenuItems, getMenuTimes, createMenuTimeHandler, updateMenuTimeHandler, deleteMenuTimeHandler,
  readMenuImportText, readMenuImportFile, commitMenuImport,
} from "../controllers/menuController.js";
import { importUploadSingle } from "../middleware/importUploadMiddleware.js";
import { protect, dbFromHeader } from "../middleware/authMiddleware.js";
import { requireAdmin, requireStaff } from "../middleware/rbac.js";
// import { uploadMiddleware } from "../middleware/uploadMiddleware.js";
// import { upload } from "../middleware/uploadMiddleware.js";
import multer from "multer";
import { objectIdParam } from "../middleware/validateIds.js";

// Memory storage — no disk, direct to Cloudinary
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
});
// const upload = multer({ dest: "uploads/" });
const router = express.Router();
// Malformed ids → 404, never a CastError 500 (middleware/validateIds.js).
router.param("id", objectIdParam);
// Public routes — use dbFromHeader (customer QR scan)
// router.get("/",          dbFromHeader, getMenu);
// router.get("/categories",dbFromHeader, getCategoriesWithImage);
const autoAuth = (req, res, next) =>
  req.headers.authorization?.startsWith("Bearer ")
    ? protect(req, res, next)
    : dbFromHeader(req, res, next);

router.get("/",           autoAuth, getMenu);
router.get("/categories", autoAuth, getCategoriesWithImage);
// Home slider: real top sellers that are orderable now (services/bestSellerService.js).
router.get("/best-sellers", autoAuth, getBestSellers);
// Admin routes — use protect (token has mongoUri)
// router.post("/",              protect, uploadMiddleware, addMenuItem);
// router.put("/:id",            protect, uploadMiddleware, updateMenuItem);
// Bulk scheduled-visibility update for CATEGORIES — admin only (items have no schedule).
router.patch("/schedule",     protect, requireAdmin, bulkUpdateSchedule);
// Big-menu tools (Admin → Menu items). Registered before the "/:id" routes.
router.patch("/availability", protect, requireStaff, setItemsAvailability); // On · Sold out today · Off
router.post("/bulk",          protect, requireAdmin, bulkEditMenuItems);
router.get("/times",          protect, requireAdmin, getMenuTimes);
router.post("/times",         protect, requireAdmin, createMenuTimeHandler);
router.put("/times/:id",      protect, requireAdmin, updateMenuTimeHandler);
router.delete("/times/:id",   protect, requireAdmin, deleteMenuTimeHandler);
router.post("/import/read",   protect, requireAdmin, readMenuImportText);
router.post("/import/read-file", protect, requireAdmin, importUploadSingle("file"), readMenuImportFile);
router.post("/import",        protect, requireAdmin, commitMenuImport);
router.post("/",              protect, requireAdmin, upload.single("image"), addMenuItem);
router.put("/:id",            protect, requireAdmin, upload.single("image"), updateMenuItem);
router.delete("/:id",         protect, requireAdmin, deleteMenuItem);
// Marking an item 86'd/available again is a routine floor action — staff, not admin-only.
router.patch("/:id/toggle",   protect, requireStaff, toggleAvailability);
export default router;
