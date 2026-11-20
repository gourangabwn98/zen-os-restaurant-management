// routes/localAuthRoutes.js — Offline Edition staff auth, mounted at /api/local
// by server.js ONLY in LOCAL_PRIMARY mode (in the cloud these paths don't exist).
//
//   GET  /setup/status            LAN       → { needsBootstrap }
//   POST /setup/bootstrap         PC only   one-time first admin (setup code from the server console)
//   POST /devices/register        LAN       → { deviceId, deviceSecret (once), pairingCode }
//   POST /devices/status          LAN       device polls its approval
//   GET  /devices                 admin/manager
//   POST /devices/:id/approve     admin (manager: waiter/chef-only devices)  body { allowedRoles, pairingCode, label? }
//   POST /devices/:id/reject      admin/manager
//   POST /devices/:id/revoke      admin (manager: waiter/chef-only devices)  body { reason }
//   POST /auth/login              LAN       body { phone, pin, deviceId, deviceSecret }
//   GET  /auth/session            signed in
//   POST /auth/logout             signed in
//   POST /auth/change-pin         signed in  body { currentPin, newPin }
//   GET  /staff/pins              admin/manager  → [{ user, mustChange, setAt, lockedUntil }] (no hashes)
//   PUT  /staff/:userId/pin       admin/manager  body { pin } (temporary; must be changed at first login)
//   GET  /auth/events             admin      audit log
import express from "express";
import mongoose from "mongoose";
import { protect, dbFromHeader } from "../middleware/authMiddleware.js";
import { requireAdmin, requireManagement, requireRole } from "../middleware/rbac.js";
import { requireLan, requireLoopback } from "../local/lanOnly.js";
import { PIN_LOGIN_ROLES } from "../config/localAuthModels.js";
import * as c from "../controllers/localAuthController.js";

const router = express.Router();
const validId = (_req, res, next, id) => (mongoose.isValidObjectId(id) ? next() : res.status(404).json({ message: "Not found", code: "NOT_FOUND" }));
router.param("id", validId);
router.param("userId", validId);

// Every local auth route is for the restaurant network only.
router.use(requireLan);

router.get ("/setup/status",    dbFromHeader, c.setupStatus);
router.post("/setup/bootstrap", requireLoopback, dbFromHeader, c.bootstrap);

router.post("/devices/register", dbFromHeader, c.registerDevice);
router.post("/devices/status",   dbFromHeader, c.deviceStatus);
router.get ("/devices",              protect, requireManagement, c.listDevices);
router.post("/devices/:id/approve",  protect, requireManagement, c.approveDevice);
router.post("/devices/:id/reject",   protect, requireManagement, c.rejectDevice);
router.post("/devices/:id/revoke",   protect, requireManagement, c.revokeDevice);

router.post("/auth/login",      dbFromHeader, c.login);
const anyPinRole = requireRole(...PIN_LOGIN_ROLES);
router.get ("/auth/session",    protect, anyPinRole, c.session);
router.post("/auth/logout",     protect, anyPinRole, c.logout);
router.post("/auth/change-pin", protect, anyPinRole, c.changePin);
router.get ("/auth/events",     protect, requireAdmin, c.authEvents);

router.get ("/staff/pins",        protect, requireManagement, c.pinStatus);
router.put ("/staff/:userId/pin", protect, requireManagement, c.setStaffPin);

export default router;
