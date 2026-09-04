import express from "express";
import {
  getPrinterStatus, updateKotJobStatus, getPrintQueue,
  registerPrinterDevice, getPrinterDevices, deletePrinterDevice,
} from "../controllers/printerController.js";
import { protect } from "../middleware/authMiddleware.js";
import { requireStaff, requireAdmin } from "../middleware/rbac.js";

const router = express.Router();
router.use(protect, requireStaff);

router.get("/status",           getPrinterStatus);
router.get("/queue",            getPrintQueue);
router.patch("/kot/:id/status", updateKotJobStatus);

// Device management — admin only (issuing/revoking long-lived credentials).
router.post("/devices",         requireAdmin, registerPrinterDevice);
router.get("/devices",          requireAdmin, getPrinterDevices);
router.delete("/devices/:id",   requireAdmin, deletePrinterDevice);

export default router;
