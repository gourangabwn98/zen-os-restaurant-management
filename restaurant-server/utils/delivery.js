// utils/delivery.js
// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers for home delivery — no DB, no sockets, so every rule here is
// unit-tested directly (test/delivery.test.js).
//
//   deliverySettings     RestaurantProfile.delivery with defaults + clamps
//   parseDeliveryCheckout the customer's address/pin → a validated snapshot
//   OTP                  4-digit hand-over code, constant-time compare
//   tracking tokens      signed, expiring, revocable — never stored
//   GPS points           range / clock / speed sanity checks
// ─────────────────────────────────────────────────────────────────────────────

import crypto from "node:crypto";
import { distanceMeters, parseCustomerLocation } from "./diningRadius.js";
import { TERMINAL_JOB_STATUSES } from "./deliveryStateMachine.js";

const bad = (message, statusCode = 400, code) => Object.assign(new Error(message), { statusCode, ...(code && { code }) });

// ── Settings ─────────────────────────────────────────────────────────────────
export const DELIVERY_DEFAULTS = Object.freeze({
  defaultCapacity:        3,   // active deliveries a rider may hold at once
  offerTtlSeconds:        45,  // how long one broadcast round stays open
  maxRounds:              5,   // rounds before the job is escalated to an admin
  trackingTtlHours:       2,   // tracking link stays readable this long after delivery
  presenceTimeoutMinutes: 10,  // an idle "online" rider with no heartbeat for this long goes offline
  maxOtpAttempts:         5,
});

const clampInt = (v, min, max, dflt) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};

export const SETTING_LIMITS = Object.freeze({
  defaultCapacity:        [1, 10],
  offerTtlSeconds:        [15, 300],
  maxRounds:              [1, 20],
  trackingTtlHours:       [0, 48],
  presenceTimeoutMinutes: [2, 240],
  maxOtpAttempts:         [3, 10],
});

/** RestaurantProfile → effective delivery settings (always complete + in range). */
export const deliverySettings = (profile) => {
  const raw = profile?.delivery?.toObject?.() || profile?.delivery || {};
  const out = {};
  for (const [k, [min, max]] of Object.entries(SETTING_LIMITS)) out[k] = clampInt(raw[k], min, max, DELIVERY_DEFAULTS[k]);
  return out;
};

/** Validates an admin's settings patch. Unknown keys are refused, not ignored.
 *  `payment` (delivery payment methods) is validated by parsePaymentSettingsPatch. */
export const parseSettingsPatch = (body) => {
  if (!body || typeof body !== "object") throw bad("Settings must be an object");
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === "payment") { out.payment = parsePaymentSettingsPatch(v); continue; }
    const lim = SETTING_LIMITS[k];
    if (!lim) throw bad(`Unknown delivery setting "${k}"`);
    const n = Number(v);
    if (!Number.isInteger(n) || n < lim[0] || n > lim[1]) throw bad(`${k} must be a whole number from ${lim[0]} to ${lim[1]}`);
    out[k] = n;
  }
  return out;
};

/** A rider's own capacity override, else the restaurant default. */
export const capacityFor = (state, settings) =>
  Number.isInteger(state?.capacity) && state.capacity > 0 ? state.capacity : settings.defaultCapacity;

// ── Delivery payment policy (COD default) ────────────────────────────────────
// RestaurantProfile.delivery.payment — Admin → Delivery → Settings. Applies to
// HOME DELIVERY only; dine-in / takeaway keep RestaurantProfile.paymentMode.
// Stored methods: COD (cash collected by the rider) and ONLINE (the existing
// PhonePe pay-first flow). Order.paymentMethod keeps its canonical values:
// COD → "Cash", ONLINE → "Online".
export const DELIVERY_PAYMENT_DEFAULTS = Object.freeze({ codEnabled: true, onlineEnabled: false, defaultMethod: "COD" });
export const DELIVERY_PAYMENT_METHODS = ["COD", "ONLINE"];
const ORDER_METHOD = { COD: "Cash", ONLINE: "Online" };

export const deliveryPaymentSettings = (profile) => {
  const raw = profile?.delivery?.payment?.toObject?.() || profile?.delivery?.payment || {};
  return {
    codEnabled:    typeof raw.codEnabled === "boolean" ? raw.codEnabled : DELIVERY_PAYMENT_DEFAULTS.codEnabled,
    onlineEnabled: typeof raw.onlineEnabled === "boolean" ? raw.onlineEnabled : DELIVERY_PAYMENT_DEFAULTS.onlineEnabled,
    defaultMethod: DELIVERY_PAYMENT_METHODS.includes(raw.defaultMethod) ? raw.defaultMethod : DELIVERY_PAYMENT_DEFAULTS.defaultMethod,
  };
};

export const parsePaymentSettingsPatch = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw bad("payment must be an object");
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === "codEnabled" || k === "onlineEnabled") {
      if (typeof v !== "boolean") throw bad(`payment.${k} must be true or false`);
      out[k] = v;
    } else if (k === "defaultMethod") {
      if (!DELIVERY_PAYMENT_METHODS.includes(v)) throw bad(`payment.defaultMethod must be one of: ${DELIVERY_PAYMENT_METHODS.join(", ")}`);
      out[k] = v;
    } else throw bad(`Unknown payment setting "${k}"`);
  }
  return out;
};

/**
 * What delivery checkout may offer right now, as Order.paymentMethod values.
 * Online appears only when the admin enabled it AND PhonePe is configured;
 * COD never depends on PhonePe.
 * @returns {{ methods: string[], defaultMethod: string|null, available: boolean, unavailableReason: string }}
 */
export const deliveryPaymentOptions = ({ profile, phonePeEnabled }) => {
  const p = deliveryPaymentSettings(profile);
  const methods = [];
  if (p.codEnabled) methods.push(ORDER_METHOD.COD);
  if (p.onlineEnabled && phonePeEnabled) methods.push(ORDER_METHOD.ONLINE);
  const preferred = ORDER_METHOD[p.defaultMethod];
  let unavailableReason = "";
  if (!methods.length) {
    unavailableReason = p.onlineEnabled && !phonePeEnabled
      ? "Home delivery is unavailable: Cash on Delivery is turned off and online payment isn't set up"
      : "Home delivery is unavailable: no payment method is enabled for delivery";
  }
  return { methods, defaultMethod: methods.includes(preferred) ? preferred : methods[0] || null, available: methods.length > 0, unavailableReason };
};

/** The customer's choice → "Cash" | "Online", or throws 400 with a reason. */
export const resolveDeliveryPaymentMethod = ({ requested, options }) => {
  if (!options.available) throw bad(options.unavailableReason, 400, "DELIVERY_PAYMENT_UNAVAILABLE");
  const method = requested ?? options.defaultMethod;
  if (!options.methods.includes(method)) {
    throw bad(`For delivery, payment must be: ${options.methods.map((m) => (m === "Cash" ? "Cash on Delivery" : "Online")).join(" or ")}`, 400, "DELIVERY_PAYMENT_METHOD");
  }
  return method;
};

/** Is ₹ `given` exactly the ₹ `due` (to the paisa)? */
export const sameAmount = (given, due) => {
  const g = Math.round(Number(given) * 100), d = Math.round(Number(due) * 100);
  return Number.isFinite(g) && Number.isFinite(d) && g === d;
};

// ── Customer checkout ────────────────────────────────────────────────────────
const text = (v, max) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/**
 * The customer's delivery details → the snapshot stored on Order.deliveryAddress.
 * Coordinates are required (a map pin / GPS fix) and must lie inside
 * RestaurantProfile.deliveryRange (metres) of the restaurant. Throws 400/403/503.
 */
export const parseDeliveryCheckout = ({ profile, delivery }) => {
  if (!delivery || typeof delivery !== "object") throw bad("Delivery address is required", 400, "DELIVERY_ADDRESS_REQUIRED");
  const address = text(delivery.address, 300);
  if (address.length < 5) throw bad("Please enter your full delivery address", 400, "DELIVERY_ADDRESS_REQUIRED");
  const point = parseCustomerLocation({ latitude: delivery.latitude, longitude: delivery.longitude });
  if (!point) throw bad("Please pin your delivery location on the map", 400, "DELIVERY_LOCATION_REQUIRED");
  const phone = String(delivery.contactPhone ?? "").replace(/[^\d+]/g, "");
  if (!/^\+?\d{10,15}$/.test(phone)) throw bad("Enter a valid phone number for the delivery partner", 400, "DELIVERY_PHONE_REQUIRED");

  const restaurant = parseCustomerLocation({ latitude: profile?.latitude, longitude: profile?.longitude });
  const range = Number(profile?.deliveryRange);
  if (!restaurant || !Number.isFinite(range) || range <= 0) {
    throw bad("Delivery isn't set up yet — the restaurant's location is missing", 503, "DELIVERY_NOT_CONFIGURED");
  }
  const dist = distanceMeters(restaurant, point);
  if (dist > range) {
    throw Object.assign(bad(`Sorry, we deliver only within ${(range / 1000).toFixed(1)} km`, 403, "OUTSIDE_DELIVERY_RANGE"), {
      details: { distanceMeters: Math.round(dist), rangeMeters: range },
    });
  }
  return {
    address,
    landmark:       text(delivery.landmark, 120),
    latitude:       point.latitude,
    longitude:      point.longitude,
    contactName:    text(delivery.contactName, 60),
    contactPhone:   phone,
    distanceMeters: Math.round(dist),
  };
};

// ── Hand-over OTP ────────────────────────────────────────────────────────────
export const generateOtp = () => String(crypto.randomInt(0, 10000)).padStart(4, "0");

export const otpMatches = (expected, given) => {
  const a = Buffer.from(String(expected ?? ""));
  const b = Buffer.from(String(given ?? "").trim());
  return a.length === 4 && a.length === b.length && crypto.timingSafeEqual(a, b);
};

// ── Tracking tokens ──────────────────────────────────────────────────────────
// token = "<jobId>.<version>.<hmac>". Nothing is stored: the owner's app can
// fetch its link again at any time, a leaked link is revoked by bumping
// DeliveryJob.trackingVersion, and it expires with the job (trackingOpen).
// The key is derived from JWT_SECRET for a separate purpose, so a tracking
// token can never be replayed as (or forged from) a login token.
const trackingKey = () => {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is not set");
  return crypto.createHash("sha256").update(`zen-delivery-tracking:${process.env.JWT_SECRET}`).digest();
};
const mac = (jobId, version) =>
  crypto.createHmac("sha256", trackingKey()).update(`${jobId}.${version}`).digest("base64url").slice(0, 32);

export const signTrackingToken = (jobId, version = 0) => `${jobId}.${version}.${mac(String(jobId), Number(version) || 0)}`;

/** → { jobId, version } for a well-formed, correctly signed token, else null. */
export const parseTrackingToken = (token) => {
  if (typeof token !== "string" || token.length > 120) return null;
  const m = /^([a-f0-9]{24})\.(\d{1,6})\.([A-Za-z0-9_-]{32})$/.exec(token);
  if (!m) return null;
  const expected = Buffer.from(mac(m[1], Number(m[2])));
  const given = Buffer.from(m[3]);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  return { jobId: m[1], version: Number(m[2]) };
};

/** Is this job's tracking link still readable? (version checked by the caller) */
export const trackingOpen = (job, settings, now = new Date()) => {
  if (!job || job.trackingRevokedAt || job.status === "CANCELLED") return false;
  if (!TERMINAL_JOB_STATUSES.includes(job.status)) return true;
  const closedAt = job.deliveredAt || job.failedAt;
  if (!closedAt) return false;
  return now.getTime() - new Date(closedAt).getTime() <= settings.trackingTtlHours * 3600 * 1000;
};

// ── GPS points ───────────────────────────────────────────────────────────────
export const MAX_POINTS_PER_BATCH = 100;
const MAX_SPEED_MPS = 55;        // ~200 km/h — anything faster is a bad fix or spoofing
const MAX_ACCURACY_M = 1000;     // coarser than this tells nobody anything
const FUTURE_SKEW_MS = 2 * 60 * 1000;
const MAX_AGE_MS = 24 * 3600 * 1000; // a queued point older than a day is dropped

/**
 * Validates one batch from a rider's device. Points are sorted by time;
 * out-of-range, future-dated, stale, inaccurate or physically impossible
 * points (speed between consecutive fixes) are dropped and counted.
 * @returns {{ points: object[], rejected: number }}
 */
export const sanitizeLocationBatch = (raw, { now = new Date(), previous = null } = {}) => {
  if (!Array.isArray(raw)) throw bad("points must be an array");
  if (raw.length > MAX_POINTS_PER_BATCH) throw bad(`At most ${MAX_POINTS_PER_BATCH} points per request`);
  const parsed = [];
  let rejected = 0;
  for (const p of raw) {
    const loc = parseCustomerLocation({ latitude: p?.latitude, longitude: p?.longitude });
    const at = new Date(p?.at);
    const accuracy = p?.accuracy == null ? null : Number(p.accuracy);
    const ok = loc && !Number.isNaN(at.getTime())
      && at.getTime() <= now.getTime() + FUTURE_SKEW_MS && now.getTime() - at.getTime() <= MAX_AGE_MS
      && (accuracy == null || (Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= MAX_ACCURACY_M))
      && !(loc.latitude === 0 && loc.longitude === 0);
    if (!ok) { rejected++; continue; }
    const num = (v, min, max) => { const n = Number(v); return v != null && Number.isFinite(n) && n >= min && n <= max ? n : null; };
    parsed.push({ ...loc, accuracy, speed: num(p.speed, 0, 100), heading: num(p.heading, 0, 360), at: at > now ? now : at });
  }
  parsed.sort((a, b) => a.at - b.at);
  const points = [];
  let last = previous?.at ? { ...previous, at: new Date(previous.at) } : null;
  for (const p of parsed) {
    if (last) {
      const dt = (p.at - last.at) / 1000;
      if (dt <= 0) { if (dt < 0) rejected++; continue; } // duplicate or older than what we already have
      if (distanceMeters(last, p) / dt > MAX_SPEED_MPS) { rejected++; continue; }
    }
    points.push(p);
    last = p;
  }
  return { points, rejected };
};

/** Straight-line metres between two {latitude, longitude} (null if either is missing). */
export const straightLineMeters = (a, b) => {
  const pa = parseCustomerLocation(a || {}), pb = parseCustomerLocation(b || {});
  return pa && pb ? Math.round(distanceMeters(pa, pb)) : null;
};
