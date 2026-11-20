import express from "express";
import {
  adminSendOTP, adminVerifyOTP,
  waiterSendOTP, waiterVerifyOTP,
  firebaseVerify,
  getProfile, updateProfile, updateVegMode, updateLanguage, updateTheme,
  firebaseLogin,
  employeeCheckPhone, employeeFirebaseVerify,
} from "../controllers/authController.js";
import { protect } from "../middleware/authMiddleware.js";
// Offline Edition: staff use PIN login in LOCAL mode; no-ops in the cloud.
import { blockInLocalMode, blockPinRolesInLocalMode } from "../local/staffLoginGate.js";

const router = express.Router();

// ── Admin OTP login ────────────────────────────────────────────────────────────
router.post("/admin/send-otp",    blockInLocalMode, adminSendOTP);
router.post("/admin/verify-otp",  blockInLocalMode, adminVerifyOTP);

// ── Waiter OTP login ──────────────────────────────────────────────────────────
router.post("/waiter/send-otp",   blockPinRolesInLocalMode, waiterSendOTP);
router.post("/waiter/verify-otp", blockPinRolesInLocalMode, waiterVerifyOTP);
// Same controller logic, exposed under a role-neutral name — the Kitchen
// app (chef login) and any future employee category use this instead of
// the waiter-specific path. Zero duplicated logic: the underlying
// functions already look up the User by phone and return whatever role
// that account actually has.
router.post("/employee/send-otp",   blockPinRolesInLocalMode, waiterSendOTP);
router.post("/employee/verify-otp", blockPinRolesInLocalMode, waiterVerifyOTP);
// Staff login via Firebase Phone Auth (same SMS service as the customer app).
router.post("/employee/check-phone",     blockPinRolesInLocalMode, employeeCheckPhone);
router.post("/employee/firebase-verify", employeeFirebaseVerify);

// ── Customer Firebase login ───────────────────────────────────────────────────
router.post("/firebase-verify",   firebaseVerify);
router.post("/admin/firebase-login", blockInLocalMode, firebaseLogin);

// ── Protected profile routes ──────────────────────────────────────────────────
router.get  ("/profile",  protect, getProfile);
router.put  ("/profile",  protect, updateProfile);
router.patch("/veg-mode", protect, updateVegMode);
router.patch("/language", protect, updateLanguage);
router.patch("/theme",    protect, updateTheme);

export default router;