import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requireStaff, requireAdmin } from "../middleware/rbac.js";
import { getCapabilities, getSettings, patchSettings } from "../controllers/inventoryV3Controller.js";

const router = express.Router();
router.use(protect);
router.get("/capabilities", requireStaff, getCapabilities);
router.get("/settings", requireAdmin, getSettings);
// Available with the kill switch off so an admin can always disable V3.
// Enabling requires both explicit setup and the backend environment switch.
router.patch("/settings", requireAdmin, patchSettings);
export default router;
