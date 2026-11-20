// services/localAuthService.js
// ─────────────────────────────────────────────────────────────────────────────
// Offline Edition (LOCAL_PRIMARY) staff authentication. Works with no
// internet: everything here reads/writes only the restaurant PC's database.
// Report + rationale: docs/offline-edition/18-o2-auth-device-report.md.
//
// Trust chain:
//   1. A device registers (gets a random deviceId + deviceSecret; PENDING).
//   2. An admin (or a manager, for waiter/chef-only devices) checks the
//      pairing code on the device and approves it for specific roles.
//   3. A staff member signs in on an APPROVED device with phone + PIN.
//      Their role comes from their User record — never from the request.
//   4. The session lives server-side (LocalSession). Every request re-checks
//      it (middleware/authMiddleware.js → checkLocalToken), so revoking a
//      device or session takes effect on the very next request.
//
// Conventions: pure-ish functions taking { models, ... }; errors carry
// statusCode + code for the controller; every status change is an atomic
// conditional update (never check-then-save); every security event writes
// an append-only LocalAuthEvent. No function here ever logs a PIN or secret.
// ─────────────────────────────────────────────────────────────────────────────
import jwt from "jsonwebtoken";
import { DEVICE_STATUSES, PIN_LOGIN_ROLES } from "../config/localAuthModels.js";
import {
  isPinShaped, pinProblem, hashPin, verifyPin, burnPinCheck,
  randomHex, sha256, safeEqualHex, humanCode, normalizeHumanCode,
} from "../utils/localPin.js";

const { PENDING, APPROVED, REJECTED, REVOKED } = DEVICE_STATUSES;

// ── Policy (one place) ───────────────────────────────────────────────────────
export const POLICY = Object.freeze({
  LOCAL_TOKEN_TYPE: "local",
  MAX_PIN_FAILURES: 5,                                   // per account, then lockout
  LOCKOUT_MINUTES: [5, 15, 60],                          // 1st, 2nd, 3rd+ lockout
  DEVICE_FAIL_LIMIT: 10, DEVICE_FAIL_WINDOW_MS: 15 * 60e3, // wrong logins per device
  IP_LOGIN_LIMIT: 30, IP_LOGIN_WINDOW_MS: 5 * 60e3,        // login attempts per IP
  REGISTER_LIMIT: 5, REGISTER_WINDOW_MS: 10 * 60e3,        // registrations per IP
  MAX_PENDING_DEVICES: 25,
  PENDING_TTL_MS: 24 * 3600e3,
  SESSION_HOURS_DEFAULT: 12, SESSION_HOURS_MIN: 1, SESSION_HOURS_MAX: 24,
  SESSION_PURGE_DAYS: 30,
  TOUCH_EVERY_MS: 60e3,                                  // lastUsedAt write throttle
  BOOTSTRAP_CODE_TTL_MS: 2 * 3600e3,
  BOOTSTRAP_MAX_ATTEMPTS: 10,
  // Roles a manager may put on a device — the people a manager manages
  // (middleware/managerScope.js). Admin/manager/inventory devices: admin only.
  MANAGER_DEVICE_ROLES: ["waiter", "chef"],
});

const PHONE_RE = /^[6-9]\d{9}$/;               // same rule as employeeService / OTP login
const SITE_ID_RE = /^[a-z0-9][a-z0-9-]{2,39}$/;
const HEX32 = /^[0-9a-f]{32}$/, HEX64 = /^[0-9a-f]{64}$/;
const PIN_CHANGE_PATHS = ["/api/local/auth/change-pin", "/api/local/auth/session", "/api/local/auth/logout"];

const fail = (statusCode, code, message, extra = {}) => Object.assign(new Error(message), { statusCode, code, ...extra });
const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const effectiveRole = (user) => (user?.isAdmin ? "admin" : user?.role || "customer");
const actorOf = (user) => (user ? { kind: "USER", user: user._id, role: effectiveRole(user) } : { kind: "ANONYMOUS", user: null, role: "" });
const minutes = (ms) => Math.max(1, Math.ceil(ms / 60e3));

export const sessionHours = (env = process.env) => {
  const n = Number(env.LOCAL_SESSION_HOURS || POLICY.SESSION_HOURS_DEFAULT);
  return Number.isFinite(n) ? Math.min(POLICY.SESSION_HOURS_MAX, Math.max(POLICY.SESSION_HOURS_MIN, n)) : POLICY.SESSION_HOURS_DEFAULT;
};
export const isValidSiteId = (v) => typeof v === "string" && SITE_ID_RE.test(v);

// ── Audit ────────────────────────────────────────────────────────────────────
export const audit = async ({ models, type, actor, user = null, device = null, phone = "", ip = "", reason = "", session }) => {
  await models.LocalAuthEvent.create([{ type, at: new Date(), actor, user, device, phone: text(phone, 20), ip: text(ip, 64), reason: text(reason, 200) }], session ? { session } : {});
};

// ── Rate limiting (fixed window, atomic $inc, TTL-cleaned) ───────────────────
export const hitRateLimit = async ({ models, key, limit, windowMs, now = new Date() }) => {
  const { LocalRateLimit } = models;
  let doc = await LocalRateLimit.findOneAndUpdate({ _id: key, resetAt: { $gt: now } }, { $inc: { count: 1 } }, { returnDocument: "after" });
  if (!doc) {
    try {
      doc = await LocalRateLimit.findOneAndUpdate(
        { _id: key, $or: [{ resetAt: { $lte: now } }, { resetAt: { $exists: false } }] },
        { $set: { count: 1, resetAt: new Date(now.getTime() + windowMs) } },
        { upsert: true, returnDocument: "after" },
      );
    } catch (err) {
      if (err?.code !== 11000) throw err; // lost the window-open race → count in the new window
      doc = await LocalRateLimit.findOneAndUpdate({ _id: key }, { $inc: { count: 1 } }, { returnDocument: "after" });
    }
  }
  return { allowed: doc.count <= limit, count: doc.count, retryAfterMs: Math.max(0, doc.resetAt - now) };
};
export const peekRateLimit = async ({ models, key, limit, now = new Date() }) => {
  const doc = await models.LocalRateLimit.findOne({ _id: key, resetAt: { $gt: now } }).lean();
  return { blocked: !!doc && doc.count >= limit, retryAfterMs: doc ? Math.max(0, doc.resetAt - now) : 0 };
};

// ── Sessions ─────────────────────────────────────────────────────────────────
const issueSession = async ({ models, user, device, mustChangePin, ip, now = new Date(), env = process.env, session }) => {
  const sid = randomHex(16);
  const hours = sessionHours(env);
  const expiresAt = new Date(now.getTime() + hours * 3600e3);
  const role = effectiveRole(user);
  await models.LocalSession.create([{
    sid, user: user._id, device: device._id, role, mustChangePin, expiresAt, lastUsedAt: now, ip: text(ip, 64),
    purgeAt: new Date(expiresAt.getTime() + POLICY.SESSION_PURGE_DAYS * 86400e3),
  }], session ? { session } : {});
  const token = jwt.sign(
    { id: String(user._id), role, sid, did: device.deviceId, typ: POLICY.LOCAL_TOKEN_TYPE },
    env.JWT_SECRET,
    { expiresIn: Math.round(hours * 3600) },
  );
  return { token, sid, expiresAt };
};

/** Same shape the existing staff login returns (authController.staffSession) + local fields. */
const sessionResponse = ({ user, issued, restaurantName, mustChangePin, device }) => ({
  token: issued.token,
  restaurantName: restaurantName || "",
  name: user.name || "",
  phone: user.phone || "",
  role: effectiveRole(user),
  isAdmin: !!user.isAdmin, // the admin app's page access reads it (admin/src/utils/access.js), as from /auth/admin/firebase-login
  local: { sessionExpiresAt: issued.expiresAt, mustChangePin: !!mustChangePin, deviceLabel: device.label || "" },
});

/** Revoke sessions matching `filter`; returns the sids so live sockets can be cut. */
export const revokeSessions = async ({ models, filter, reason, now = new Date(), session }) => {
  const open = { ...filter, revokedAt: null };
  const sids = (await models.LocalSession.find(open).select("sid").session(session || null).lean()).map((s) => s.sid);
  if (sids.length) await models.LocalSession.updateMany({ ...open, sid: { $in: sids } }, { $set: { revokedAt: now, revokeReason: reason } }, session ? { session } : {});
  return sids;
};

/**
 * The per-request check, used by protect / optionalProtect / socket auth.
 * Returns { ok:true, session|null } or { ok:false, status, body }.
 * CLOUD mode: only refuses tokens minted by a local server (never valid there).
 */
export const checkLocalToken = async ({ models, decoded, user, localMode, path = null, now = new Date() }) => {
  const reject = (reason, message = "Your session has ended — please sign in again", status = 401) =>
    ({ ok: false, status, body: { message, code: "SESSION_EXPIRED", reason } });
  const isLocalToken = decoded?.typ === POLICY.LOCAL_TOKEN_TYPE;

  if (!localMode) return isLocalToken ? reject("LOCAL_TOKEN_IN_CLOUD") : { ok: true, session: null };

  const role = effectiveRole(user);
  const pinRole = PIN_LOGIN_ROLES.includes(role);
  if (!pinRole) {
    // Customers / riders keep their existing tokens (riders: phase O8).
    return isLocalToken ? reject("ROLE_NOT_DEVICE_BOUND") : { ok: true, session: null };
  }
  if (!isLocalToken || !HEX32.test(String(decoded.sid || ""))) {
    return reject("DEVICE_LOGIN_REQUIRED", "Sign in with your PIN on a registered device");
  }

  const session = await models.LocalSession.findOne({ sid: decoded.sid }).lean();
  if (!session || String(session.user) !== String(user._id)) return reject("SESSION_REVOKED");
  if (session.revokedAt) return reject(session.revokeReason === "DEVICE_REVOKED" ? "DEVICE_REVOKED" : "SESSION_REVOKED");
  if (session.expiresAt <= now) return reject("SESSION_EXPIRED");

  const device = await models.StaffDevice.findById(session.device).lean();
  if (!device || device.deviceId !== decoded.did) return reject("DEVICE_REVOKED");
  if (device.status !== APPROVED) return reject("DEVICE_REVOKED", "This device is no longer allowed — ask the admin");
  if (!device.allowedRoles.includes(role)) return reject("ROLE_NOT_ALLOWED_ON_DEVICE", "Your role can't use this device");

  if (session.mustChangePin && (path === null || !PIN_CHANGE_PATHS.some((p) => String(path).split("?")[0] === p))) {
    return { ok: false, status: 403, body: { message: "Set your own PIN to continue", code: "PIN_CHANGE_REQUIRED" } };
  }

  if (now - session.lastUsedAt > POLICY.TOUCH_EVERY_MS) {
    models.LocalSession.updateOne({ _id: session._id, lastUsedAt: { $lt: new Date(now - POLICY.TOUCH_EVERY_MS) } }, { $set: { lastUsedAt: now } }).catch(() => {});
    models.StaffDevice.updateOne({ _id: device._id }, { $set: { lastSeenAt: now } }).catch(() => {});
  }
  return { ok: true, session: { sid: session.sid, deviceId: device.deviceId, device: device._id, expiresAt: session.expiresAt, mustChangePin: session.mustChangePin } };
};

// ── Devices ──────────────────────────────────────────────────────────────────
const findDeviceWithSecret = async ({ models, deviceId, deviceSecret }) => {
  if (!HEX32.test(String(deviceId || "")) || !HEX64.test(String(deviceSecret || ""))) return null;
  const device = await models.StaffDevice.findOne({ deviceId }).select("+secretHash");
  if (!device || !safeEqualHex(device.secretHash, sha256(deviceSecret))) return null;
  return device;
};

const publicDevice = (d) => ({
  _id: d._id, deviceId: d.deviceId, label: d.label, platform: d.platform, status: d.status,
  pairingCode: d.status === PENDING ? d.pairingCode : undefined,
  allowedRoles: d.allowedRoles, registeredFromIp: d.registeredFromIp,
  createdAt: d.createdAt, decidedAt: d.decidedAt, decidedBy: d.decidedBy,
  revokedAt: d.revokedAt, revokeReason: d.revokeReason, lastSeenAt: d.lastSeenAt, lastUser: d.lastUser,
});

/** POST /api/local/devices/register — unauthenticated, LAN-only, rate-limited. */
export const registerDevice = async ({ models, label, platform, ip, now = new Date() }) => {
  const rl = await hitRateLimit({ models, key: `register:ip:${ip}`, limit: POLICY.REGISTER_LIMIT, windowMs: POLICY.REGISTER_WINDOW_MS, now });
  if (!rl.allowed) throw fail(429, "RATE_LIMITED", `Too many registrations — try again in ${minutes(rl.retryAfterMs)} min`, { retryAfterMs: rl.retryAfterMs });
  const pending = await models.StaffDevice.countDocuments({ status: PENDING });
  if (pending >= POLICY.MAX_PENDING_DEVICES) throw fail(429, "TOO_MANY_PENDING", "Too many devices are waiting for approval — ask the admin to clear the list");

  const deviceId = randomHex(16);
  const deviceSecret = randomHex(32);
  const pairingCode = humanCode(6);
  const doc = await models.StaffDevice.create({
    deviceId, secretHash: sha256(deviceSecret), pairingCode,
    label: text(label, 60) || "Staff device", platform: text(platform, 200), registeredFromIp: text(ip, 64),
    status: PENDING, pendingExpiresAt: new Date(now.getTime() + POLICY.PENDING_TTL_MS),
  });
  await audit({ models, type: "DEVICE_REGISTERED", actor: actorOf(null), device: doc._id, ip, reason: doc.label });
  // deviceSecret is returned exactly once and never stored in plain form.
  return { deviceId, deviceSecret, pairingCode, status: PENDING };
};

/** POST /api/local/devices/status — the device asks "am I approved yet?" */
export const deviceStatus = async ({ models, deviceId, deviceSecret }) => {
  const device = await findDeviceWithSecret({ models, deviceId, deviceSecret });
  if (!device) throw fail(404, "DEVICE_NOT_REGISTERED", "This device is not registered");
  return { status: device.status, label: device.label, allowedRoles: device.status === APPROVED ? device.allowedRoles : [], pairingCode: device.status === PENDING ? device.pairingCode : undefined };
};

export const listDevices = async ({ models }) => {
  const docs = await models.StaffDevice.find({}).sort({ status: 1, createdAt: -1 }).limit(500).lean();
  return docs.map(publicDevice);
};

const assertCanManageDevice = ({ actor, roles }) => {
  const role = effectiveRole(actor);
  if (role === "admin") return;
  if (role === "manager" && roles.every((r) => POLICY.MANAGER_DEVICE_ROLES.includes(r))) return;
  throw fail(403, "FORBIDDEN", "Only the admin can manage devices used by admin, manager or inventory staff");
};

/** Approve a PENDING device for specific roles. Pairing code must match what the device shows. */
export const approveDevice = async ({ models, actor, id, allowedRoles, pairingCode, label, ip }) => {
  const roles = [...new Set(Array.isArray(allowedRoles) ? allowedRoles : [])];
  if (!roles.length || !roles.every((r) => PIN_LOGIN_ROLES.includes(r))) throw fail(400, "INVALID_ROLES", `Choose who may use this device: ${PIN_LOGIN_ROLES.join(", ")}`);
  assertCanManageDevice({ actor, roles });
  const device = await models.StaffDevice.findById(id).lean();
  if (!device) throw fail(404, "NOT_FOUND", "Device not found");
  if (device.status !== PENDING) throw fail(409, "NOT_PENDING", `This device is ${device.status.toLowerCase()}`);
  if (normalizeHumanCode(pairingCode) !== device.pairingCode) throw fail(400, "PAIRING_CODE_MISMATCH", "The code doesn't match the one shown on the device");

  const updated = await models.StaffDevice.findOneAndUpdate(
    { _id: id, status: PENDING },
    { $set: { status: APPROVED, allowedRoles: roles, decidedBy: actorOf(actor), decidedAt: new Date(), pendingExpiresAt: null, ...(text(label, 60) ? { label: text(label, 60) } : {}) } },
    { returnDocument: "after" },
  ).lean();
  if (!updated) throw fail(409, "NOT_PENDING", "This device was already decided");
  await audit({ models, type: "DEVICE_APPROVED", actor: actorOf(actor), device: updated._id, ip, reason: roles.join(",") });
  return publicDevice(updated);
};

export const rejectDevice = async ({ models, actor, id, ip }) => {
  const device = await models.StaffDevice.findById(id).lean();
  if (!device) throw fail(404, "NOT_FOUND", "Device not found");
  // A pending device has no roles yet; a manager may reject any pending registration.
  if (!["admin", "manager"].includes(effectiveRole(actor))) throw fail(403, "FORBIDDEN", "Not allowed");
  const updated = await models.StaffDevice.findOneAndUpdate(
    { _id: id, status: PENDING },
    { $set: { status: REJECTED, decidedBy: actorOf(actor), decidedAt: new Date(), pendingExpiresAt: null } },
    { returnDocument: "after" },
  ).lean();
  if (!updated) throw fail(409, "NOT_PENDING", "Only a waiting device can be rejected");
  await audit({ models, type: "DEVICE_REJECTED", actor: actorOf(actor), device: updated._id, ip });
  return publicDevice(updated);
};

/**
 * Revoke a device (lost / stolen / retired). Final. All its sessions end now;
 * returns { device, revokedSids } so the caller can disconnect live sockets.
 */
export const revokeDevice = async ({ models, actor, id, reason, currentDevice, ip, now = new Date() }) => {
  const device = await models.StaffDevice.findById(id).lean();
  if (!device) throw fail(404, "NOT_FOUND", "Device not found");
  if (![APPROVED, PENDING].includes(device.status)) throw fail(409, "ALREADY_FINAL", `This device is already ${device.status.toLowerCase()}`);
  assertCanManageDevice({ actor, roles: device.allowedRoles });
  if (currentDevice && String(currentDevice) === String(device._id)) throw fail(400, "OWN_DEVICE", "You can't revoke the device you're using — sign out instead, or revoke it from another device");

  const updated = await models.StaffDevice.findOneAndUpdate(
    { _id: id, status: { $in: [APPROVED, PENDING] } },
    { $set: { status: REVOKED, revokedBy: actorOf(actor), revokedAt: now, revokeReason: text(reason, 200), pendingExpiresAt: null } },
    { returnDocument: "after" },
  ).lean();
  if (!updated) throw fail(409, "ALREADY_FINAL", "This device was already revoked");
  const revokedSids = await revokeSessions({ models, filter: { device: updated._id }, reason: "DEVICE_REVOKED", now });
  await audit({ models, type: "DEVICE_REVOKED", actor: actorOf(actor), device: updated._id, ip, reason: text(reason, 200) });
  return { device: publicDevice(updated), revokedSids };
};

// ── Login ────────────────────────────────────────────────────────────────────
const findPinUser = (User, phone) => User.findOne({
  phone, status: { $ne: "Inactive" },
  $or: [{ role: { $in: PIN_LOGIN_ROLES } }, { isAdmin: true }],
}).select("-otp -otpExpiry -password");

const lockoutMinutesFor = (lockoutCount) => POLICY.LOCKOUT_MINUTES[Math.min(lockoutCount, POLICY.LOCKOUT_MINUTES.length - 1)];

/** Count one wrong PIN against an account; lock it at the threshold. Atomic. */
const recordPinFailure = async ({ models, pinDoc, now }) => {
  const after = await models.StaffPin.findOneAndUpdate({ _id: pinDoc._id }, { $inc: { failedCount: 1 } }, { returnDocument: "after" }).lean();
  if (after.failedCount < POLICY.MAX_PIN_FAILURES) return { locked: false };
  const mins = lockoutMinutesFor(after.lockoutCount);
  const locked = await models.StaffPin.findOneAndUpdate(
    { _id: pinDoc._id, failedCount: { $gte: POLICY.MAX_PIN_FAILURES } },
    { $set: { failedCount: 0, lockedUntil: new Date(now.getTime() + mins * 60e3) }, $inc: { lockoutCount: 1 } },
    { returnDocument: "after" },
  ).lean();
  return { locked: !!locked, minutes: mins };
};

/**
 * POST /api/local/auth/login { phone, pin, deviceId, deviceSecret }.
 * Generic "phone or PIN is incorrect" for every credential failure, so the
 * response never says whether a phone number belongs to staff.
 */
export const pinLogin = async ({ models, appModels, phone, pin, deviceId, deviceSecret, ip, now = new Date(), env = process.env }) => {
  const badCreds = () => fail(401, "INVALID_CREDENTIALS", "Phone or PIN is incorrect");
  const ipRl = await hitRateLimit({ models, key: `login:ip:${ip}`, limit: POLICY.IP_LOGIN_LIMIT, windowMs: POLICY.IP_LOGIN_WINDOW_MS, now });
  if (!ipRl.allowed) throw fail(429, "RATE_LIMITED", `Too many attempts — try again in ${minutes(ipRl.retryAfterMs)} min`, { retryAfterMs: ipRl.retryAfterMs });

  const device = await findDeviceWithSecret({ models, deviceId, deviceSecret });
  if (!device) throw fail(401, "DEVICE_NOT_REGISTERED", "This device is not registered — register it first");
  if (device.status === PENDING) throw fail(403, "DEVICE_PENDING", "This device is waiting for the admin's approval");
  if (device.status !== APPROVED) throw fail(403, "DEVICE_REVOKED", "This device is no longer allowed — ask the admin");

  const deviceKey = `login-fail:device:${device._id}`;
  const devBlock = await peekRateLimit({ models, key: deviceKey, limit: POLICY.DEVICE_FAIL_LIMIT, now });
  if (devBlock.blocked) {
    await audit({ models, type: "LOGIN_BLOCKED", actor: actorOf(null), device: device._id, phone, ip, reason: "device throttled" });
    throw fail(429, "DEVICE_THROTTLED", `Too many wrong PINs on this device — try again in ${minutes(devBlock.retryAfterMs)} min`, { retryAfterMs: devBlock.retryAfterMs });
  }

  const phoneOk = typeof phone === "string" && PHONE_RE.test(phone.trim());
  const user = phoneOk ? await findPinUser(appModels.User, phone.trim()) : null;
  const pinDoc = user ? await models.StaffPin.findOne({ user: user._id }).select("+pinHash") : null;

  if (pinDoc?.lockedUntil && pinDoc.lockedUntil > now) {
    await audit({ models, type: "LOGIN_BLOCKED", actor: actorOf(null), user: user._id, device: device._id, phone, ip, reason: "account locked" });
    const ms = pinDoc.lockedUntil - now;
    throw fail(429, "ACCOUNT_LOCKED", `Too many wrong PINs — this account is locked for ${minutes(ms)} min`, { retryAfterMs: ms });
  }

  const ok = pinDoc && isPinShaped(pin) ? await verifyPin(pin, pinDoc.pinHash, env) : await burnPinCheck(env);
  if (!ok) {
    await hitRateLimit({ models, key: deviceKey, limit: POLICY.DEVICE_FAIL_LIMIT, windowMs: POLICY.DEVICE_FAIL_WINDOW_MS, now });
    let reason = !phoneOk ? "bad phone format" : !user ? "unknown phone" : !pinDoc ? "no PIN set" : "wrong PIN";
    if (pinDoc) {
      const r = await recordPinFailure({ models, pinDoc, now });
      if (r.locked) {
        await audit({ models, type: "LOCKOUT", actor: { kind: "SYSTEM", user: null, role: "" }, user: user._id, device: device._id, ip, reason: `${r.minutes} min` });
        reason += `, locked ${r.minutes} min`;
      }
    }
    await audit({ models, type: "LOGIN_FAILED", actor: actorOf(null), user: user?._id || null, device: device._id, phone, ip, reason });
    throw badCreds();
  }

  const role = effectiveRole(user);
  if (!device.allowedRoles.includes(role)) {
    await audit({ models, type: "LOGIN_BLOCKED", actor: actorOf(user), user: user._id, device: device._id, ip, reason: `role ${role} not allowed on device` });
    throw fail(403, "ROLE_NOT_ALLOWED_ON_DEVICE", "Your role can't sign in on this device — ask the admin");
  }

  await models.StaffPin.updateOne({ _id: pinDoc._id }, { $set: { failedCount: 0, lockoutCount: 0, lockedUntil: null } });
  // One live session per person per device: a fresh login replaces the old one.
  await revokeSessions({ models, filter: { user: user._id, device: device._id }, reason: "REPLACED_BY_NEW_LOGIN", now });
  const issued = await issueSession({ models, user, device, mustChangePin: pinDoc.mustChange, ip, now, env });
  await models.StaffDevice.updateOne({ _id: device._id }, { $set: { lastSeenAt: now, lastUser: user._id } });
  await audit({ models, type: "LOGIN_SUCCESS", actor: actorOf(user), user: user._id, device: device._id, ip });
  const profile = await appModels.RestaurantProfile.findOne().select("restaurantName").lean();
  return sessionResponse({ user, issued, restaurantName: profile?.restaurantName, mustChangePin: pinDoc.mustChange, device });
};

export const logout = async ({ models, user, localSession, ip }) => {
  if (!localSession) return { ok: true };
  await revokeSessions({ models, filter: { sid: localSession.sid }, reason: "LOGOUT" });
  await audit({ models, type: "LOGOUT", actor: actorOf(user), user: user._id, device: localSession.device, ip });
  return { ok: true, revokedSids: [localSession.sid] };
};

// ── PINs ─────────────────────────────────────────────────────────────────────
/**
 * Admin/manager sets a TEMPORARY PIN for a staff member (must be changed at
 * first login). Ends that person's sessions — a reset means "something's wrong".
 */
export const setStaffPin = async ({ models, appModels, actor, userId, pin, ip, env = process.env }) => {
  const target = await appModels.User.findById(userId).select("name phone role isAdmin status").lean();
  if (!target || !PIN_LOGIN_ROLES.includes(effectiveRole(target))) throw fail(404, "NOT_FOUND", "Staff member not found (PINs are for admin, manager, inventory, waiter and chef accounts)");
  if (String(target._id) === String(actor._id)) throw fail(400, "OWN_PIN", "Change your own PIN from your account, not here");
  const actorRole = effectiveRole(actor);
  if (actorRole !== "admin" && !(actorRole === "manager" && POLICY.MANAGER_DEVICE_ROLES.includes(effectiveRole(target)))) {
    throw fail(403, "FORBIDDEN", "Only the admin can set a PIN for a manager, inventory manager or admin");
  }
  const problem = pinProblem(pin, { phone: target.phone });
  if (problem) throw fail(400, "WEAK_PIN", problem);

  const pinHash = await hashPin(pin, env);
  await models.StaffPin.findOneAndUpdate(
    { user: target._id },
    { $set: { pinHash, mustChange: true, setBy: actorOf(actor), setAt: new Date(), failedCount: 0, lockoutCount: 0, lockedUntil: null } },
    { upsert: true },
  );
  const revokedSids = await revokeSessions({ models, filter: { user: target._id }, reason: "PIN_RESET" });
  await audit({ models, type: "PIN_SET", actor: actorOf(actor), user: target._id, ip, reason: "temporary PIN set" });
  return { ok: true, mustChange: true, revokedSids };
};

/** Signed-in staff replaces their own PIN. Wrong current PIN counts toward lockout. */
export const changeOwnPin = async ({ models, user, localSession, currentPin, newPin, ip, now = new Date(), env = process.env }) => {
  if (!localSession) throw fail(403, "LOCAL_SESSION_REQUIRED", "Sign in with your PIN first");
  const pinDoc = await models.StaffPin.findOne({ user: user._id }).select("+pinHash");
  if (!pinDoc) throw fail(404, "NO_PIN", "No PIN is set for this account");
  if (pinDoc.lockedUntil && pinDoc.lockedUntil > now) throw fail(429, "ACCOUNT_LOCKED", `Locked for ${minutes(pinDoc.lockedUntil - now)} min`);
  const ok = isPinShaped(currentPin) && await verifyPin(currentPin, pinDoc.pinHash, env);
  if (!ok) {
    const r = await recordPinFailure({ models, pinDoc, now });
    await audit({ models, type: "PIN_CHANGE_FAILED", actor: actorOf(user), user: user._id, device: localSession.device, ip, reason: r.locked ? `wrong current PIN, locked ${r.minutes} min` : "wrong current PIN" });
    if (r.locked) {
      // Locked mid-session: end every session so the lock means something.
      await revokeSessions({ models, filter: { user: user._id }, reason: "LOCKED_OUT", now });
    }
    throw fail(401, "INVALID_CREDENTIALS", "Current PIN is incorrect");
  }
  const problem = pinProblem(newPin, { phone: user.phone });
  if (problem) throw fail(400, "WEAK_PIN", problem);
  if (await verifyPin(newPin, pinDoc.pinHash, env)) throw fail(400, "SAME_PIN", "Choose a PIN different from the current one");

  const pinHash = await hashPin(newPin, env);
  await models.StaffPin.updateOne({ _id: pinDoc._id }, { $set: { pinHash, mustChange: false, setBy: actorOf(user), setAt: now, failedCount: 0, lockoutCount: 0, lockedUntil: null } });
  // Other devices signed in with the old PIN are signed out; this one stays.
  const revokedSids = await revokeSessions({ models, filter: { user: user._id, sid: { $ne: localSession.sid } }, reason: "PIN_CHANGED", now });
  await models.LocalSession.updateOne({ sid: localSession.sid }, { $set: { mustChangePin: false } });
  await audit({ models, type: "PIN_CHANGED", actor: actorOf(user), user: user._id, device: localSession.device, ip });
  return { ok: true, revokedSids };
};

/** PIN state per staff user (never the hash): has a PIN, must change, locked until. */
export const listPinStatus = async ({ models, now = new Date() }) => {
  const docs = await models.StaffPin.find({}).select("user mustChange setAt setBy lockedUntil").lean();
  return docs.map((d) => ({
    user: d.user, mustChange: d.mustChange, setAt: d.setAt, setByRole: d.setBy?.role || "",
    lockedUntil: d.lockedUntil && d.lockedUntil > now ? d.lockedUntil : null,
  }));
};

export const listAuthEvents = async ({ models, limit = 200 }) =>
  models.LocalAuthEvent.find({}).sort({ at: -1 }).limit(Math.min(500, Math.max(1, Number(limit) || 200))).lean();

// ── First-admin bootstrap ────────────────────────────────────────────────────
const adminExists = (User, session) => User.exists({ $or: [{ role: "admin" }, { isAdmin: true }] }).session(session || null);

/**
 * At startup (LOCAL mode): if there is no admin yet, mint a fresh one-time
 * setup code (hash stored, plain returned for the console only). If an admin
 * exists, setup is closed for good. Returns { needed, code? }.
 */
export const prepareBootstrap = async ({ models, appModels, now = new Date() }) => {
  if (await adminExists(appModels.User)) {
    await models.LocalSetupState.updateOne({ _id: "bootstrap", completedAt: null }, { $set: { completedAt: now, codeHash: "", codeExpiresAt: null } }, { upsert: true }).catch((e) => { if (e?.code !== 11000) throw e; });
    return { needed: false };
  }
  const code = humanCode(12);
  await models.LocalSetupState.findOneAndUpdate(
    { _id: "bootstrap" },
    { $set: { codeHash: sha256(code), codeExpiresAt: new Date(now.getTime() + POLICY.BOOTSTRAP_CODE_TTL_MS), failedAttempts: 0, completedAt: null } },
    { upsert: true },
  );
  return { needed: true, code, expiresAt: new Date(now.getTime() + POLICY.BOOTSTRAP_CODE_TTL_MS) };
};

export const bootstrapStatus = async ({ models, appModels }) => {
  const state = await models.LocalSetupState.findById("bootstrap").lean();
  const needed = !state?.completedAt && !(await adminExists(appModels.User));
  return { needsBootstrap: needed };
};

/**
 * POST /api/local/setup/bootstrap — loopback only (the PC itself), one-time
 * code from the server console. Creates restaurant profile + first admin +
 * their PIN + approves THIS browser as the first trusted device, all in one
 * transaction. A second attempt — or a race — gets 409.
 */
export const bootstrapFirstAdmin = async ({ models, appModels, db, body, ip, now = new Date(), env = process.env }) => {
  const b = body || {};
  const siteId = text(b.siteId, 40).toLowerCase();
  const restaurantName = text(b.restaurant?.name, 80);
  const restaurantPhone = text(b.restaurant?.phone, 15);
  const address = text(b.restaurant?.address, 200);
  const adminName = text(b.admin?.name, 60);
  const adminPhone = text(b.admin?.phone, 15);
  const pin = typeof b.admin?.pin === "string" ? b.admin.pin : "";
  const deviceLabel = text(b.device?.label, 60) || "Restaurant PC";

  // Restaurant identity: the request must name the site this PC was installed for.
  const configured = text(env.LOCAL_SITE_ID, 40).toLowerCase();
  if (!isValidSiteId(configured)) throw fail(503, "SITE_NOT_CONFIGURED", "LOCAL_SITE_ID is not configured on this PC");
  const problems = [];
  if (siteId !== configured) problems.push("Restaurant ID doesn't match this installation");
  if (restaurantName.length < 2) problems.push("Enter the restaurant name");
  if (restaurantPhone && !/^\d{10,15}$/.test(restaurantPhone)) problems.push("Restaurant phone must be 10–15 digits");
  if (adminName.length < 2) problems.push("Enter the admin's name");
  if (!PHONE_RE.test(adminPhone)) problems.push("Enter the admin's 10-digit mobile number");
  const pp = pinProblem(pin, { phone: adminPhone });
  if (pp) problems.push(pp);

  // Setup code check (outside the transaction so wrong guesses are counted even when it aborts).
  const state = await models.LocalSetupState.findById("bootstrap").select("+codeHash").lean();
  const closed = () => fail(409, "ALREADY_BOOTSTRAPPED", "This restaurant is already set up — sign in instead");
  if (!state || state.completedAt || (await adminExists(appModels.User))) {
    await audit({ models, type: "BOOTSTRAP_REJECTED", actor: actorOf(null), ip, reason: "already set up" });
    throw closed();
  }
  if (!state.codeHash || !state.codeExpiresAt || state.codeExpiresAt <= now || state.failedAttempts >= POLICY.BOOTSTRAP_MAX_ATTEMPTS) {
    throw fail(410, "SETUP_CODE_EXPIRED", "The setup code has expired — restart the server to get a new one");
  }
  if (!safeEqualHex(state.codeHash, sha256(normalizeHumanCode(b.setupCode)))) {
    await models.LocalSetupState.updateOne({ _id: "bootstrap" }, { $inc: { failedAttempts: 1 } });
    await audit({ models, type: "BOOTSTRAP_REJECTED", actor: actorOf(null), ip, reason: "wrong setup code" });
    throw fail(401, "INVALID_SETUP_CODE", "Setup code is incorrect");
  }
  if (problems.length) throw fail(400, "INVALID_SETUP", problems.join(". "), { problems });

  const pinHash = await hashPin(pin, env); // before the transaction: scrypt is slow
  const deviceId = randomHex(16), deviceSecret = randomHex(32);
  let result;
  await db.transaction(async (session) => {
    result = null;
    // Claim the one-time setup. A concurrent bootstrap conflicts on this document.
    const claimed = await models.LocalSetupState.findOneAndUpdate(
      { _id: "bootstrap", completedAt: null, codeHash: state.codeHash },
      { $set: { completedAt: now, codeHash: "", codeExpiresAt: null } },
      { session, returnDocument: "after" },
    );
    if (!claimed || (await adminExists(appModels.User, session))) throw closed();
    if (await appModels.User.exists({ phone: adminPhone }).session(session)) throw fail(409, "PHONE_TAKEN", "That phone number already belongs to an account");

    const hasProfile = await appModels.RestaurantProfile.exists({}).session(session);
    if (!hasProfile) await appModels.RestaurantProfile.create([{ restaurantName, phone: restaurantPhone, address }], { session });
    const [admin] = await appModels.User.create([{ name: adminName, phone: adminPhone, role: "admin", isAdmin: true, status: "Active" }], { session });
    await models.LocalSetupState.updateOne({ _id: "bootstrap" }, { $set: { completedBy: admin._id } }, { session });
    const setBy = { kind: "USER", user: admin._id, role: "admin" };
    await models.StaffPin.create([{ user: admin._id, pinHash, mustChange: false, setBy, setAt: now }], { session });
    const [device] = await models.StaffDevice.create([{
      deviceId, secretHash: sha256(deviceSecret), pairingCode: humanCode(6), label: deviceLabel,
      platform: text(b.device?.platform, 200), registeredFromIp: text(ip, 64),
      status: APPROVED, allowedRoles: ["admin", "manager"], decidedBy: setBy, decidedAt: now, pendingExpiresAt: null,
    }], { session });
    const issued = await issueSession({ models, user: admin, device, mustChangePin: false, ip, now, env, session });
    await audit({ models, type: "BOOTSTRAP", actor: setBy, user: admin._id, device: device._id, ip, reason: `site ${siteId}`, session });
    result = { admin, device, issued };
  });
  return {
    device: { deviceId, deviceSecret, status: APPROVED },
    session: sessionResponse({ user: result.admin, issued: result.issued, restaurantName, mustChangePin: false, device: result.device }),
  };
};
