// routes/deliveryRoutes.js — mounted at /api/delivery
//   /me/*, /offers/*, /jobs/*   rider (role delivery)
//   /orders/:orderId            the logged-in customer who owns that order
//   /track/:token               public — the signed tracking token is the auth
//   /admin/*                    admin + manager (settings: admin only)
import express from "express";
import * as c from "../controllers/deliveryController.js";
import { protect, dbFromHeader } from "../middleware/authMiddleware.js";
import { requireDelivery, requireManagement, requireAdmin } from "../middleware/rbac.js";
import { objectIdParam } from "../middleware/validateIds.js";
import { rateLimit } from "../middleware/rateLimit.js";

const router = express.Router();
for (const p of ["jobId", "partnerId", "orderId"]) router.param(p, objectIdParam);

const perMinute = (max, message) => rateLimit({ windowMs: 60 * 1000, max, message });
const byIp = (max) => rateLimit({ windowMs: 60 * 1000, max, key: (req) => req.ip });

// ── Public tracking link ─────────────────────────────────────────────────────
router.get("/track/:token", byIp(60), dbFromHeader, c.track);

// ── Customer: own order ─────────────────────────────────────────────────────
router.get("/orders/:orderId", protect, perMinute(60), c.customerOrderDelivery);

// ── Rider ────────────────────────────────────────────────────────────────────
// Guards attached per route (not router.use) so they can never leak onto /admin/*.
const R = [protect, requireDelivery];
router.get("/me", ...R, c.me);
router.post("/me/online", ...R, perMinute(20), c.setOnline);
router.post("/me/heartbeat", ...R, perMinute(30), c.heartbeat);
router.post("/me/push-token", ...R, perMinute(10), c.addToken);
router.delete("/me/push-token", ...R, perMinute(10), c.removeToken);
router.post("/me/locations", ...R, perMinute(30, "Location updates are too frequent"), c.locations);
router.get("/me/history", ...R, c.myHistory);
router.get("/me/summary", ...R, c.mySummary);
router.get("/me/cash", ...R, c.myCash);
// Google Routes API costs money per call — keep it rare.
router.post("/me/route", ...R, perMinute(6, "Route requested too often"), c.myRoute);
router.get("/offers", ...R, c.offers);
router.post("/offers/:jobId/accept", ...R, perMinute(30), c.accept);
router.post("/offers/:jobId/reject", ...R, perMinute(30), c.reject);
router.get("/jobs/:jobId", ...R, c.myJob);
// OTP guessing is capped per job in the DB (maxOtpAttempts); this damps bursts.
router.post("/jobs/:jobId/:step", ...R, perMinute(20), c.step);

// ── Admin / manager ──────────────────────────────────────────────────────────
const admin = express.Router();
admin.use(protect, requireManagement);
for (const p of ["jobId", "partnerId", "collectionId"]) admin.param(p, objectIdParam);
admin.get("/overview", c.overview);
admin.get("/jobs", c.jobs);
admin.get("/jobs/:jobId/events", c.jobEvents);
admin.post("/jobs/:jobId/assign", c.assign);
admin.post("/jobs/:jobId/unassign", c.unassign);
admin.post("/jobs/:jobId/rebroadcast", c.rebroadcast);
admin.post("/jobs/:jobId/cancel", c.cancelJob);
admin.post("/jobs/:jobId/reset-otp", c.resetOtp);
admin.post("/jobs/:jobId/revoke-tracking", c.revokeTracking);
admin.get("/partners", c.partners);
admin.patch("/partners/:partnerId", c.updatePartner);
admin.post("/partners/:partnerId/force-offline", c.forceOffline);
admin.get("/live", c.live);
admin.get("/reports", c.reports);
admin.get("/cod", c.codList);
admin.post("/cod/:collectionId/verify", c.codVerify);
admin.post("/cod/:collectionId/dispute", c.codDispute);
admin.get("/settings", c.getSettings);
admin.patch("/settings", requireAdmin, c.updateSettings);
router.use("/admin", admin);

export default router;
