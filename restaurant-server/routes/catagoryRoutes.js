// import express from "express";
// import { getCategories, createCategory, updateCategory, deleteCategory } from "../controllers/categoryController.js";
// import { protect, dbFromHeader } from "../middleware/authMiddleware.js";
// const router = express.Router();
// router.get("/",      dbFromHeader, getCategories);
// router.post("/",     protect,      createCategory);
// router.put("/:id",   protect,      updateCategory);
// router.delete("/:id",protect,      deleteCategory);
// export default router;
import express from "express";
import { getCategories, createCategory, updateCategory, deleteCategory } from "../controllers/categoryController.js";
import { protect, dbFromHeader } from "../middleware/authMiddleware.js";
import { requireAdmin } from "../middleware/rbac.js";
import { upload } from "../middleware/uploadMiddleware.js"; // ← ADD

const router = express.Router();
// router.get("/",       dbFromHeader, getCategories);
const autoAuth = (req, res, next) =>
  req.headers.authorization?.startsWith("Bearer ")
    ? protect(req, res, next)
    : dbFromHeader(req, res, next);

router.get("/", autoAuth, getCategories);
router.post("/",      protect, requireAdmin, upload.single("image"), createCategory);
router.put("/:id",    protect, requireAdmin, updateCategory);
router.delete("/:id", protect, requireAdmin, deleteCategory);
export default router;