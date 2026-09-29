// routes/waiterCallRoutes.js — "Call waiter" (services/waiterCallService.js)
import express from "express";
import {
  getOrderCallState, callWaiter, withdrawCall, myCalls, acknowledge, resolve,
} from "../controllers/waiterCallController.js";
import { protect, dbFromHeader } from "../middleware/authMiddleware.js";
import { requireStaff } from "../middleware/rbac.js";
import { requireWaiterOnDuty } from "../middleware/dutyMiddleware.js";

const router = express.Router();

// Customer (JWT) or guest (x-guest-order-token, checked strictly in the service).
const autoAuth = (req, res, next) =>
  req.headers.authorization?.startsWith("Bearer ")
    ? protect(req, res, next)
    : dbFromHeader(req, res, next);

router.post  ("/",               autoAuth, callWaiter);
router.get   ("/order/:orderId", autoAuth, getOrderCallState);
router.delete("/order/:orderId", autoAuth, withdrawCall);

// Waiter app.
router.get  ("/mine",        protect, requireStaff, myCalls);
router.patch("/:id/ack",     protect, requireStaff, requireWaiterOnDuty, acknowledge);
router.patch("/:id/resolve", protect, requireStaff, requireWaiterOnDuty, resolve);

export default router;
