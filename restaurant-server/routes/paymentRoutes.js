import express from "express";
import {
  initiatePhonePe, phonePeOrderStatus, phonePeCallback,
} from "../controllers/paymentController.js";
import { protect, optionalProtect, dbFromHeader } from "../middleware/authMiddleware.js";
import { objectIdParam } from "../middleware/validateIds.js";

const router = express.Router();
// Malformed ids → 404, never a CastError 500 (middleware/validateIds.js).
router.param("orderId", objectIdParam);

// Same "JWT if present, else public DB" pattern as orderRoutes.js.
const autoAuth = (req, res, next) =>
  req.headers.authorization?.startsWith("Bearer ")
    ? protect(req, res, next)
    : dbFromHeader(req, res, next);

// Customer / guest starts an online payment for their own order.
router.post("/phonepe/initiate", optionalProtect, initiatePhonePe);

// Customer / guest polls the outcome after being redirected back from PhonePe.
router.get("/phonepe/status/:orderId", autoAuth, phonePeOrderStatus);

// PhonePe → us, server-to-server. Authenticated by the X-VERIFY checksum, not a JWT.
router.post("/phonepe/callback", dbFromHeader, phonePeCallback);

export default router;
