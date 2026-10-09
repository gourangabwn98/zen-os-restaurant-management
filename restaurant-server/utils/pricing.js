// utils/pricing.js
// ─────────────────────────────────────────────────────────────────────────────
// Server-side order pricing. The client (customer/waiter/admin UI) sends only
// { menuItemId, qty, notes } for each line — price, name, tax etc. are always
// re-derived here from the live MenuItem + RestaurantProfile docs. Never trust
// a price/subtotal/total sent by a client.
// ─────────────────────────────────────────────────────────────────────────────

import { isItemScheduledNow } from "../services/menuScheduleService.js";
import { resolveLineAddons } from "./menuAddons.js";

const qtyOf = (raw) => {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return null;
  return n;
};

/**
 * Resolves raw client line items [{ menuItemId, qty, notes }] into
 * authoritative order-item subdocuments, using ONLY prices from the DB.
 * `scheduleCtx` (from menuScheduleService.getScheduleContext) additionally
 * rejects items whose CATEGORY schedule is outside its window right now
 * — the same rule GET /api/menu applies, so a stale cart can't bypass it.
 * `opts.keepIds` (Set of menuItem ids): items the order ALREADY has at least
 * this many of — an edit to an order the kitchen is cooking keeps them even
 * if they're sold out / out of hours now. The price still comes from the DB.
 */
export const priceItems = async (items, MenuItem, scheduleCtx = null, { keepIds = null } = {}) => {
  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error("No items in order");
    err.statusCode = 400;
    throw err;
  }

  return Promise.all(
    items.map(async (i) => {
      const qty = qtyOf(i.qty);
      if (!i.menuItemId) {
        const err = new Error("Each item requires a menuItemId");
        err.statusCode = 400;
        throw err;
      }
      if (qty === null) {
        const err = new Error(`Invalid quantity for item ${i.menuItemId}`);
        err.statusCode = 400;
        throw err;
      }

      const m = await MenuItem.findById(i.menuItemId);
      if (!m) {
        const err = new Error("Item not found. Please refresh menu.");
        err.statusCode = 400;
        throw err;
      }
      const kept = keepIds?.has(String(m._id));
      if (!m.isAvailable && !kept) {
        const err = new Error(`"${m.name}" is currently not available`);
        err.statusCode = 400;
        throw err;
      }
      if (scheduleCtx && !kept && !isItemScheduledNow(m, scheduleCtx)) {
        const err = new Error(`"${m.name}" is not available at this time`);
        err.statusCode = 400;
        throw err;
      }

      // KH-12: chosen add-ons (ids only from the client) — priced from the DB.
      const { addons, extra } = resolveLineAddons(m, i.addonIds);
      return {
        menuItem: m._id,
        name: m.name,
        nameBn: m.nameBn || "",
        price: m.price + extra,     // ← authoritative price, from DB, not client (incl. add-ons)
        qty,
        notes: typeof i.notes === "string" ? i.notes.slice(0, 300) : "",
        ...(addons.length && { addons, basePrice: m.price }), // absent → line exactly as before
      };
    })
  );
};

/**
 * ₹ a coupon takes off an item subtotal. `coupon` is a Coupon doc or an
 * order's coupon snapshot ({ discountType, discountValue, maxDiscount,
 * minOrderAmount }). 0 when there's no coupon or the subtotal is below its
 * minimum (e.g. items were removed after it was applied); never more than
 * the subtotal. Whole rupees, like every other amount here.
 */
export const computeCouponDiscount = (coupon, subtotal) => {
  if (!coupon || !(subtotal > 0)) return 0;
  if (subtotal < (Number(coupon.minOrderAmount) || 0)) return 0;
  const value = Number(coupon.discountValue) || 0;
  let off = coupon.discountType === "PERCENT" ? Math.round((subtotal * value) / 100) : Math.round(value);
  if (coupon.discountType === "PERCENT" && Number(coupon.maxDiscount) > 0) off = Math.min(off, Number(coupon.maxDiscount));
  return Math.max(0, Math.min(off, subtotal));
};

/** Computes subtotal/discount/tax/serviceCharge/total from already-resolved
 * dbItems. The only discount is a customer's coupon (`coupon`, validated
 * server-side by couponService — never an amount sent by a client); GST is
 * charged on the discounted item value. */
// `acServiceCharge` (KH-11): an Indoor-AC order's guests × rate, fixed when the
// order is placed — carried through a re-price so an edit never drops it.
// It is PART OF `subtotal` (the bill shows it above the Subtotal line); the
// coupon and GST still apply to the item value only.
export const computeTotals = (dbItems, restaurantProfile, coupon = null, { acServiceCharge = 0 } = {}) => {
  const gstRate           = (restaurantProfile?.gstRate || 0) / 100;
  const serviceChargeRate = restaurantProfile?.serviceCharge || 0;
  const itemSubtotal      = dbItems.reduce((s, i) => s + i.price * i.qty, 0);
  const totalQty          = dbItems.reduce((s, i) => s + i.qty, 0);
  const discount           = computeCouponDiscount(coupon, itemSubtotal);
  const tax                = Math.round((itemSubtotal - discount) * gstRate);
  const serviceCharge      = Math.round(serviceChargeRate * totalQty);
  const ac                  = Math.max(0, Number(acServiceCharge) || 0);
  const subtotal            = itemSubtotal + ac;
  const total               = subtotal - discount + tax + serviceCharge;
  return { subtotal, tax, serviceCharge, discount, total, totalQty };
};

/**
 * Full convenience wrapper used by placeOrder: resolve + compute in one call.
 * @returns {{ dbItems, subtotal, tax, serviceCharge, discount, total, totalQty }}
 */
export const priceOrder = async ({ items, MenuItem, restaurantProfile, scheduleCtx = null, coupon = null, acServiceCharge = 0, keepIds = null }) => {
  const dbItems = await priceItems(items, MenuItem, scheduleCtx, { keepIds });
  const totals  = computeTotals(dbItems, restaurantProfile, coupon, { acServiceCharge });
  return { dbItems, ...totals };
};
