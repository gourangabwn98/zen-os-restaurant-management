import express from "express";
import {
  placeOrder, confirmOrder, approveOrder, rejectOrder,
  getMyOrders, getOrderById, cancelOrder,
} from "../controllers/orderController.js";
import { protect, optionalProtect, dbFromHeader } from "../middleware/authMiddleware.js";
import { requireStaff } from "../middleware/rbac.js";

const router = express.Router();

const autoAuth = (req, res, next) =>
  req.headers.authorization?.startsWith("Bearer ")
    ? protect(req, res, next)
    : dbFromHeader(req, res, next);

// ── Central order system — shared by Customer, Waiter, and Admin ─────────────
// Source (CUSTOMER/WAITER/ADMIN) and initial status are always derived
// server-side from the authenticated identity, never from the request body.
router.post("/",            optionalProtect, placeOrder);
router.get("/my",           protect,         getMyOrders);
router.get("/:id",           autoAuth,        getOrderById);

// Guests may cancel their own order via x-guest-order-token; logged-in
// customers/staff are identified via JWT. optionalProtect resolves both.
router.delete("/:id",        optionalProtect, cancelOrder);

// Staff-only: confirm a pending order (creates its KOT job) / decline it.
// "/confirm" is the new canonical name; "/approve" is kept as an alias so
// any existing caller of the old route keeps working unchanged.
router.patch("/:id/confirm", protect, requireStaff, confirmOrder);
router.patch("/:id/approve", protect, requireStaff, approveOrder);
router.patch("/:id/reject",  protect, requireStaff, rejectOrder);

export default router;
