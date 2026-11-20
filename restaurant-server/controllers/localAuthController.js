// controllers/localAuthController.js — thin HTTP wrapper over
// services/localAuthService.js (Offline Edition only; mounted by server.js
// in LOCAL_PRIMARY mode). Never echoes a PIN or device secret except the
// one-time deviceSecret returned to the registering device itself.
import { getLocalAuthModels } from "../config/localAuthModels.js";
import * as svc from "../services/localAuthService.js";
import { disconnectLocalSessions } from "../sockets/socket.js";

const ipOf = (req) => String(req.socket?.remoteAddress || "").replace(/^::ffff:/, "");
const lm = (req) => getLocalAuthModels(req.db);

const handle = (fn) => async (req, res) => {
  try {
    const out = await fn(req, res);
    if (out?.revokedSids) { disconnectLocalSessions(out.revokedSids); delete out.revokedSids; }
    if (!res.headersSent) res.json(out);
  } catch (err) {
    const status = err.statusCode || 500;
    if (status >= 500) console.error("local auth error:", err.message);
    if (err.retryAfterMs) res.set("Retry-After", String(Math.ceil(err.retryAfterMs / 1000)));
    res.status(status).json({ message: status >= 500 ? "Something went wrong" : err.message, code: err.code || "ERROR", ...(err.problems ? { problems: err.problems } : {}) });
  }
};

// ── setup ──
export const setupStatus = handle((req) => svc.bootstrapStatus({ models: lm(req), appModels: req.models }));
export const bootstrap = handle(async (req, res) => {
  const out = await svc.bootstrapFirstAdmin({ models: lm(req), appModels: req.models, db: req.db, body: req.body, ip: ipOf(req) });
  res.status(201).json(out);
});

// ── devices ──
export const registerDevice = handle(async (req, res) => {
  const out = await svc.registerDevice({ models: lm(req), label: req.body?.label, platform: req.body?.platform, ip: ipOf(req) });
  res.status(201).json(out);
});
export const deviceStatus = handle((req) => svc.deviceStatus({ models: lm(req), deviceId: req.body?.deviceId, deviceSecret: req.body?.deviceSecret }));
export const listDevices = handle((req) => svc.listDevices({ models: lm(req) }));
export const approveDevice = handle((req) => svc.approveDevice({
  models: lm(req), actor: req.user, id: req.params.id, allowedRoles: req.body?.allowedRoles,
  pairingCode: req.body?.pairingCode, label: req.body?.label, ip: ipOf(req),
}));
export const rejectDevice = handle((req) => svc.rejectDevice({ models: lm(req), actor: req.user, id: req.params.id, ip: ipOf(req) }));
export const revokeDevice = handle((req) => svc.revokeDevice({
  models: lm(req), actor: req.user, id: req.params.id, reason: req.body?.reason,
  currentDevice: req.localSession?.device, ip: ipOf(req),
}));

// ── auth ──
export const login = handle((req) => svc.pinLogin({
  models: lm(req), appModels: req.models, phone: req.body?.phone, pin: req.body?.pin,
  deviceId: req.body?.deviceId, deviceSecret: req.body?.deviceSecret, ip: ipOf(req),
}));
export const session = handle((req) => ({
  name: req.user.name, phone: req.user.phone, role: req.user.isAdmin ? "admin" : req.user.role,
  local: req.localSession ? { sessionExpiresAt: req.localSession.expiresAt, mustChangePin: req.localSession.mustChangePin } : null,
}));
export const logout = handle((req) => svc.logout({ models: lm(req), user: req.user, localSession: req.localSession, ip: ipOf(req) }));
export const changePin = handle((req) => svc.changeOwnPin({
  models: lm(req), user: req.user, localSession: req.localSession,
  currentPin: req.body?.currentPin, newPin: req.body?.newPin, ip: ipOf(req),
}));
export const setStaffPin = handle((req) => svc.setStaffPin({
  models: lm(req), appModels: req.models, actor: req.user, userId: req.params.userId, pin: req.body?.pin, ip: ipOf(req),
}));
export const pinStatus = handle((req) => svc.listPinStatus({ models: lm(req) }));
export const authEvents = handle((req) => svc.listAuthEvents({ models: lm(req), limit: req.query?.limit }));
