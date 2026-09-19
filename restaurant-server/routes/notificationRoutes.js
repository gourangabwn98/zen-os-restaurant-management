import express from "express";
import { subscribe, unsubscribe, sendBroadcast, getHistory } from "../controllers/notificationController.js";
import { protect } from "../middleware/authMiddleware.js";
import { requireAdmin } from "../middleware/rbac.js";

const router = express.Router();

// ── Customer self-service (opt-in / opt-out) ──────────────────────────────────
router.post("/subscribe",   protect, subscribe);
router.post("/unsubscribe", protect, unsubscribe);

// ── Admin broadcast ────────────────────────────────────────────────────────────
router.post("/admin/send",    protect, requireAdmin, sendBroadcast);
router.get ("/admin/history", protect, requireAdmin, getHistory);

export default router;
