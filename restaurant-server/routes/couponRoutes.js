import express from "express";
import {
  getLiveCoupons, checkCoupon, getAllCoupons, addCoupon, editCoupon, removeCoupon,
} from "../controllers/couponController.js";
import { protect, dbFromHeader } from "../middleware/authMiddleware.js";
import { requireAdmin } from "../middleware/rbac.js";

const router = express.Router();

// ── Customer (guest or logged in) — only coupons live right now ─────────────
router.get("/",             dbFromHeader, getLiveCoupons);
router.get("/check/:code",  dbFromHeader, checkCoupon);

// ── Admin management ─────────────────────────────────────────────────────────
router.get   ("/admin",     protect, requireAdmin, getAllCoupons);
router.post  ("/admin",     protect, requireAdmin, addCoupon);
router.put   ("/admin/:id", protect, requireAdmin, editCoupon);
router.delete("/admin/:id", protect, requireAdmin, removeCoupon);

export default router;
