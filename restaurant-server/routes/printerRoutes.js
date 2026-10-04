import express from "express";
import {
  getPrinterStatus, updateKotJobStatus, getPrintQueue,
  registerPrinterDevice, getPrinterDevices, deletePrinterDevice, skipStaleJobs,
} from "../controllers/printerController.js";
import { protect } from "../middleware/authMiddleware.js";
import { requireStaff, requireAdmin } from "../middleware/rbac.js";
import { objectIdParam } from "../middleware/validateIds.js";

const router = express.Router();
// Malformed ids → 404, never a CastError 500 (middleware/validateIds.js).
router.param("id", objectIdParam);
router.use(protect, requireStaff);

router.get("/status",           getPrinterStatus);
router.get("/queue",            getPrintQueue);
router.patch("/kot/:id/status", updateKotJobStatus);

// Device management — admin only (issuing/revoking long-lived credentials).
router.post("/devices",         requireAdmin, registerPrinterDevice);
router.get("/devices",          requireAdmin, getPrinterDevices);
router.delete("/devices/:id",   requireAdmin, deletePrinterDevice);
// Drop waiting jobs too old to print (e.g. queued while no print service ran).
router.post("/skip-stale",      requireAdmin, skipStaleJobs);

export default router;
