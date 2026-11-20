// config/localAuthModels.js
// ─────────────────────────────────────────────────────────────────────────────
// Offline Edition (LOCAL_PRIMARY) staff authentication: devices, PINs,
// sessions, rate limits, audit log, one-time setup. Design + report:
// docs/offline-edition/18-o2-auth-device-report.md.
//
// Kept OUT of config/getModels.js on purpose: these collections only exist
// on a restaurant PC, and getModels.js must stay byte-identical for the cloud.
// Nothing here is ever read in CLOUD_PRIMARY mode.
//
// Secrets: only hashes are stored (device secret → SHA-256 of a 256-bit
// random value; PIN → scrypt + server pepper, utils/localPin.js). No field
// here ever holds a plaintext PIN or device secret.
// ─────────────────────────────────────────────────────────────────────────────
import mongoose from "mongoose";

const { Schema } = mongoose;
const ObjectId = Schema.Types.ObjectId;

export const DEVICE_STATUSES = Object.freeze({
  PENDING: "PENDING",   // registered, waiting for an admin/manager
  APPROVED: "APPROVED", // trusted — PIN login allowed for its allowedRoles
  REJECTED: "REJECTED", // admin said no — final
  REVOKED: "REVOKED",   // was trusted, now cut off (lost/stolen/retired) — final
});

/** Roles that must sign in with phone + PIN on a registered device in LOCAL mode. */
export const PIN_LOGIN_ROLES = Object.freeze(["admin", "manager", "inventory_manager", "waiter", "chef"]);

export const AUTH_EVENTS = Object.freeze([
  "BOOTSTRAP", "BOOTSTRAP_REJECTED",
  "DEVICE_REGISTERED", "DEVICE_APPROVED", "DEVICE_REJECTED", "DEVICE_REVOKED",
  "LOGIN_SUCCESS", "LOGIN_FAILED", "LOGIN_BLOCKED", "LOCKOUT",
  "LOGOUT", "PIN_SET", "PIN_CHANGED", "PIN_CHANGE_FAILED",
  "SESSION_REVOKED", "RECOVERY",
]);

const actorSchema = new Schema({
  kind: { type: String, enum: ["USER", "CONSOLE", "SYSTEM", "ANONYMOUS"], required: true },
  user: { type: ObjectId, ref: "User", default: null },
  role: { type: String, default: "" },
}, { _id: false });

// ── StaffDevice ──────────────────────────────────────────────────────────────
const staffDeviceSchema = new Schema({
  deviceId: { type: String, required: true, unique: true },       // public id, 128-bit random hex
  secretHash: { type: String, required: true, select: false },     // sha256(deviceSecret)
  pairingCode: { type: String, required: true },                   // shown on the device; admin matches it — not a secret
  label: { type: String, trim: true, maxlength: 60, default: "" },
  platform: { type: String, trim: true, maxlength: 200, default: "" },
  registeredFromIp: { type: String, default: "" },
  status: { type: String, enum: Object.values(DEVICE_STATUSES), default: DEVICE_STATUSES.PENDING, index: true },
  allowedRoles: { type: [String], enum: PIN_LOGIN_ROLES, default: [] },
  // Unapproved registrations disappear after 24 h (TTL). Cleared on approval.
  pendingExpiresAt: { type: Date, default: null },
  decidedBy: { type: actorSchema, default: null },
  decidedAt: { type: Date, default: null },
  revokedBy: { type: actorSchema, default: null },
  revokedAt: { type: Date, default: null },
  revokeReason: { type: String, trim: true, maxlength: 200, default: "" },
  lastSeenAt: { type: Date, default: null },
  lastUser: { type: ObjectId, ref: "User", default: null },
}, { timestamps: true });
staffDeviceSchema.index({ pendingExpiresAt: 1 }, { expireAfterSeconds: 0 });

// ── StaffPin (one per staff user) ────────────────────────────────────────────
const staffPinSchema = new Schema({
  user: { type: ObjectId, ref: "User", required: true, unique: true },
  pinHash: { type: String, required: true, select: false },
  mustChange: { type: Boolean, default: true },   // a PIN set by someone else must be replaced at first login
  setBy: { type: actorSchema, required: true },
  setAt: { type: Date, required: true },
  failedCount: { type: Number, default: 0 },       // consecutive wrong PINs since last success/lockout
  lockoutCount: { type: Number, default: 0 },      // lockouts since last success — drives escalation
  lockedUntil: { type: Date, default: null },
}, { timestamps: true });

// ── LocalSession ─────────────────────────────────────────────────────────────
const localSessionSchema = new Schema({
  sid: { type: String, required: true, unique: true },              // JWT `sid` claim, 128-bit random hex
  user: { type: ObjectId, ref: "User", required: true, index: true },
  device: { type: ObjectId, ref: "StaffDevice", required: true, index: true },
  role: { type: String, required: true },                           // at login (informational; authz re-reads the user)
  mustChangePin: { type: Boolean, default: false },
  expiresAt: { type: Date, required: true },
  lastUsedAt: { type: Date, required: true },
  ip: { type: String, default: "" },
  revokedAt: { type: Date, default: null },
  revokeReason: { type: String, default: "" },
  // Keep ended sessions 30 days for the audit trail, then drop them.
  purgeAt: { type: Date, required: true },
}, { timestamps: true });
localSessionSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

// ── LocalRateLimit (fixed windows, TTL-cleaned) ──────────────────────────────
const localRateLimitSchema = new Schema({
  _id: { type: String },          // e.g. "register:ip:192.168.1.7"
  count: { type: Number, default: 0 },
  resetAt: { type: Date, required: true },
}, { versionKey: false });
localRateLimitSchema.index({ resetAt: 1 }, { expireAfterSeconds: 0 });

// ── LocalAuthEvent (append-only audit) ───────────────────────────────────────
const localAuthEventSchema = new Schema({
  type: { type: String, enum: AUTH_EVENTS, required: true, index: true },
  at: { type: Date, required: true, index: true },
  actor: { type: actorSchema, required: true },
  user: { type: ObjectId, ref: "User", default: null },     // subject (whose login / PIN)
  device: { type: ObjectId, ref: "StaffDevice", default: null },
  phone: { type: String, default: "" },                     // as typed, for failed logins; never a PIN
  ip: { type: String, default: "" },
  reason: { type: String, default: "" },
}, { versionKey: false });
// Append-only, like DutyHistory: block every update/delete path at model level.
const appendOnly = function () { throw new Error("LocalAuthEvent is append-only"); };
for (const op of ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "deleteOne", "deleteMany", "findOneAndDelete", "findOneAndReplace"]) {
  localAuthEventSchema.pre(op, appendOnly);
}

// ── LocalSetupState (singleton: first-admin bootstrap) ───────────────────────
const localSetupStateSchema = new Schema({
  _id: { type: String },                            // "bootstrap"
  codeHash: { type: String, default: "", select: false },
  codeExpiresAt: { type: Date, default: null },
  failedAttempts: { type: Number, default: 0 },
  completedAt: { type: Date, default: null },
  completedBy: { type: ObjectId, ref: "User", default: null },
}, { versionKey: false, timestamps: true });

/** Models on one connection. Safe to call repeatedly. */
export const getLocalAuthModels = (conn) => ({
  StaffDevice:      conn.models.StaffDevice      || conn.model("StaffDevice", staffDeviceSchema),
  StaffPin:         conn.models.StaffPin         || conn.model("StaffPin", staffPinSchema),
  LocalSession:     conn.models.LocalSession     || conn.model("LocalSession", localSessionSchema),
  LocalRateLimit:   conn.models.LocalRateLimit   || conn.model("LocalRateLimit", localRateLimitSchema),
  LocalAuthEvent:   conn.models.LocalAuthEvent   || conn.model("LocalAuthEvent", localAuthEventSchema),
  LocalSetupState:  conn.models.LocalSetupState  || conn.model("LocalSetupState", localSetupStateSchema),
});
