import express from "express";
import { getChefs, createChef, updateChef, deleteChef, updateChefStatus } from "../controllers/chefController.js";
import { protect } from "../middleware/authMiddleware.js";
import { requireAdmin } from "../middleware/rbac.js";
import { objectIdParam } from "../middleware/validateIds.js";
const router = express.Router();
// Malformed ids → 404, never a CastError 500 (middleware/validateIds.js).
router.param("id", objectIdParam);
router.use(protect, requireAdmin);
router.get("/",           getChefs);
router.post("/",          createChef);
router.put("/:id",        updateChef);
router.delete("/:id",     deleteChef);
router.patch("/:id/status",updateChefStatus);
export default router;
