import express from "express";
import {
  adminSendOTP, adminVerifyOTP,
  waiterSendOTP, waiterVerifyOTP,
  firebaseVerify,
  getProfile, updateProfile, updateVegMode, updateLanguage,
  firebaseLogin,
} from "../controllers/authController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// ── Admin OTP login ────────────────────────────────────────────────────────────
router.post("/admin/send-otp",    adminSendOTP);
router.post("/admin/verify-otp",  adminVerifyOTP);

// ── Waiter OTP login ──────────────────────────────────────────────────────────
router.post("/waiter/send-otp",   waiterSendOTP);
router.post("/waiter/verify-otp", waiterVerifyOTP);
// Same controller logic, exposed under a role-neutral name — the Kitchen
// app (chef login) and any future employee category use this instead of
// the waiter-specific path. Zero duplicated logic: the underlying
// functions already look up the User by phone and return whatever role
// that account actually has.
router.post("/employee/send-otp",   waiterSendOTP);
router.post("/employee/verify-otp", waiterVerifyOTP);

// ── Customer Firebase login ───────────────────────────────────────────────────
router.post("/firebase-verify",   firebaseVerify);
router.post("/admin/firebase-login", firebaseLogin);

// ── Protected profile routes ──────────────────────────────────────────────────
router.get  ("/profile",  protect, getProfile);
router.put  ("/profile",  protect, updateProfile);
router.patch("/veg-mode", protect, updateVegMode);
router.patch("/language", protect, updateLanguage);

export default router;