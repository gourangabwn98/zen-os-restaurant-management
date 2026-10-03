import express from "express";
import {
  getLiveCoupons, checkCoupon, getAllCoupons, addCoupon, editCoupon, removeCoupon,
  getOfferStats, checkOffer,
} from "../controllers/couponController.js";
import { protect, optionalProtect } from "../middleware/authMiddleware.js";
import { requireAdmin } from "../middleware/rbac.js";
import { objectIdParam } from "../middleware/validateIds.js";

const router = express.Router();
// Malformed ids → 404, never a CastError 500 (middleware/validateIds.js).
router.param("id", objectIdParam);

// ── Customer (guest or logged in — the login decides which audience applies) ─
router.get("/",             optionalProtect, getLiveCoupons);
router.get("/check/:code",  optionalProtect, checkCoupon);

// ── Admin management ─────────────────────────────────────────────────────────
router.get   ("/admin",     protect, requireAdmin, getAllCoupons);
// Admin → Offers: read-only results/reach and a cost check of a draft.
router.get   ("/admin/stats", protect, requireAdmin, getOfferStats);
router.post  ("/admin/check", protect, requireAdmin, checkOffer);
router.post  ("/admin",     protect, requireAdmin, addCoupon);
router.put   ("/admin/:id", protect, requireAdmin, editCoupon);
router.delete("/admin/:id", protect, requireAdmin, removeCoupon);

export default router;
