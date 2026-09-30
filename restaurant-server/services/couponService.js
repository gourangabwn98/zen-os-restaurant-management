// services/couponService.js
// ─────────────────────────────────────────────────────────────────────────────
// Admin-managed discount coupons that customers apply at checkout.
//
// A coupon is "live" only while isActive AND startsAt <= now <= endsAt, judged
// by the server clock — so a Puja offer (10–15 Oct) and a Special offer
// (20–30 Oct) are both stored up front, but on 25 Oct customers are shown and
// can use only the Special one. Outside its window a coupon is neither listed
// nor accepted.
//
// The client only ever sends a coupon CODE. Whether it applies, and how much
// it takes off, is decided here and in utils/pricing.js (computeTotals) — a
// discount amount from a client is never trusted. The order keeps a snapshot
// of the coupon's terms, so editing/deleting a coupon later never changes an
// order that was already placed with it.
// ─────────────────────────────────────────────────────────────────────────────
import { computeCouponDiscount } from "../utils/pricing.js";

export const DISCOUNT_TYPES = ["PERCENT", "FLAT"];

const httpError = (msg, statusCode = 400) => {
  const err = new Error(msg);
  err.statusCode = statusCode;
  return err;
};

// Same format as offer-notification coupon codes (notificationService.js —
// not imported, as it loads Firebase Admin), so a code sent in an offer push
// can be created here as a real coupon.
const COUPON_RE = /^[A-Z0-9_-]{3,20}$/;
const normalizeCouponCode = (raw) => {
  const code = String(raw ?? "").trim().toUpperCase();
  if (code && !COUPON_RE.test(code)) throw httpError("Coupon code must be 3–20 characters: letters, numbers, - or _");
  return code;
};

const has = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);

export const isCouponLive = (c, now = new Date()) =>
  Boolean(c?.isActive) && new Date(c.startsAt) <= now && now <= new Date(c.endsAt);

/** Only what a customer needs to see — never who created it etc. */
const toPublicCoupon = (c) => ({
  code: c.code, title: c.title, description: c.description || "",
  discountType: c.discountType, discountValue: c.discountValue,
  maxDiscount: c.maxDiscount ?? null, minOrderAmount: c.minOrderAmount || 0,
  startsAt: c.startsAt, endsAt: c.endsAt,
});

/** The terms copied onto an order (Order.coupon). */
const toSnapshot = (c) => ({
  code: c.code, title: c.title, discountType: c.discountType, discountValue: c.discountValue,
  maxDiscount: c.maxDiscount ?? null, minOrderAmount: c.minOrderAmount || 0,
});

const numberOrNull = (raw, label, { min = 0, max = 1e7 } = {}) => {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) throw httpError(`${label} must be a number from ${min} to ${max}`);
  return Math.round(n);
};

const dateOrThrow = (raw, label) => {
  const d = new Date(raw);
  if (raw === undefined || raw === null || raw === "" || Number.isNaN(d.getTime())) throw httpError(`${label} is required`);
  return d;
};

/**
 * Validates admin input into Coupon fields. `existing` (on update) supplies
 * the values the admin didn't send, so cross-field checks (end after start,
 * % ≤ 100) always see the final coupon. Dates arrive as ISO strings from the
 * admin's browser (it converts its local date), so no timezone guessing here.
 */
export const normalizeCouponInput = (body = {}, existing = null) => {
  const pick = (k) => (has(body, k) ? body[k] : existing?.[k]);
  const out = {};

  const code = normalizeCouponCode(pick("code"));
  if (!code) throw httpError("Coupon code is required");
  out.code = code;

  out.title = String(pick("title") ?? "").trim();
  if (!out.title) throw httpError("Title is required");
  if (out.title.length > 60) throw httpError("Title must be 60 characters or fewer");

  out.description = String(pick("description") ?? "").trim();
  if (out.description.length > 200) throw httpError("Description must be 200 characters or fewer");

  out.discountType = String(pick("discountType") ?? "").toUpperCase();
  if (!DISCOUNT_TYPES.includes(out.discountType)) throw httpError(`Discount type must be one of: ${DISCOUNT_TYPES.join(", ")}`);

  out.discountValue = out.discountType === "PERCENT"
    ? numberOrNull(pick("discountValue"), "Discount %", { min: 1, max: 100 })
    : numberOrNull(pick("discountValue"), "Discount amount", { min: 1, max: 100000 });
  if (out.discountValue === null) throw httpError("Discount value is required");

  // A ₹ cap only makes sense for a % coupon.
  out.maxDiscount = out.discountType === "PERCENT"
    ? numberOrNull(pick("maxDiscount"), "Max discount", { min: 1, max: 100000 }) : null;
  out.minOrderAmount = numberOrNull(pick("minOrderAmount"), "Minimum order", { min: 0, max: 1000000 }) ?? 0;

  out.startsAt = dateOrThrow(pick("startsAt"), "Start date");
  out.endsAt   = dateOrThrow(pick("endsAt"), "End date");
  if (out.endsAt <= out.startsAt) throw httpError("End date must be after the start date");

  out.isActive = has(body, "isActive") ? Boolean(body.isActive) : (existing ? Boolean(existing.isActive) : true);
  return out;
};

const duplicateCode = (err) => err?.code === 11000 && (err.keyPattern?.code || /code/.test(err.message));

// ── Admin CRUD ───────────────────────────────────────────────────────────────

/** Every coupon, newest window first — the admin sees upcoming/expired too. */
export const listAllCoupons = ({ models }) =>
  models.Coupon.find().sort({ startsAt: -1, createdAt: -1 }).lean();

export const createCoupon = async ({ models, body, actor }) => {
  const data = normalizeCouponInput(body);
  try {
    return await models.Coupon.create({ ...data, createdBy: actor });
  } catch (err) {
    if (duplicateCode(err)) throw httpError(`A coupon with code ${data.code} already exists`, 409);
    throw err;
  }
};

export const updateCoupon = async ({ models, id, body }) => {
  const existing = await models.Coupon.findById(id).lean();
  if (!existing) throw httpError("Coupon not found", 404);
  const data = normalizeCouponInput(body, existing);
  try {
    return await models.Coupon.findByIdAndUpdate(id, { $set: data }, { new: true });
  } catch (err) {
    if (duplicateCode(err)) throw httpError(`A coupon with code ${data.code} already exists`, 409);
    throw err;
  }
};

/** Safe at any time — orders placed with it keep their own snapshot. */
export const deleteCoupon = async ({ models, id }) => {
  const deleted = await models.Coupon.findByIdAndDelete(id);
  if (!deleted) throw httpError("Coupon not found", 404);
  return deleted;
};

// ── Customer side ────────────────────────────────────────────────────────────

/** Coupons a customer can use right now, ending soonest first. */
export const listLiveCoupons = async ({ models, now = new Date() }) => {
  const rows = await models.Coupon.find({ isActive: true, startsAt: { $lte: now }, endsAt: { $gte: now } })
    .sort({ endsAt: 1 })
    .lean();
  return { coupons: rows.map(toPublicCoupon), serverNow: now };
};

/** Looks a code up and throws a customer-readable 400 unless it's live now. */
const findLiveCoupon = async ({ models, code, now }) => {
  const clean = String(code ?? "").trim().toUpperCase();
  if (!clean) throw httpError("Enter a coupon code");
  const c = await models.Coupon.findOne({ code: clean }).lean();
  if (!c || !c.isActive) throw httpError("This coupon code isn't valid");
  if (now < new Date(c.startsAt)) throw httpError("This coupon isn't active yet");
  if (now > new Date(c.endsAt)) throw httpError("This coupon has expired");
  return c;
};

/** GET /api/coupons/:code — lets the cart check a typed-in code. */
export const getLiveCoupon = async ({ models, code, now = new Date() }) =>
  toPublicCoupon(await findLiveCoupon({ models, code, now }));

/**
 * Called by orderService.placeOrderTx with the server-computed item subtotal.
 * Returns the snapshot to price the order with (Order.coupon), or null when
 * no code was sent. Throws 400 if the code is unknown/not live or the order
 * is below the coupon's minimum — the order is refused rather than silently
 * placed at full price, so the customer never pays more than they were shown.
 */
export const resolveCouponForOrder = async ({ models, code, subtotal, now = new Date() }) => {
  if (code === undefined || code === null || String(code).trim() === "") return null;
  const c = await findLiveCoupon({ models, code, now });
  const min = c.minOrderAmount || 0;
  if (subtotal < min) throw httpError(`Coupon ${c.code} needs an order of at least ₹${min} — add ₹${min - subtotal} more`);
  if (computeCouponDiscount(c, subtotal) <= 0) throw httpError(`Coupon ${c.code} doesn't apply to this order`);
  return toSnapshot(c);
};
