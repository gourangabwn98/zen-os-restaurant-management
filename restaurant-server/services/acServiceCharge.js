// services/acServiceCharge.js — KH-11
// ─────────────────────────────────────────────────────────────────────────────
// Indoor-AC service charge = guests × rate-per-guest. Staff enter the guest
// count on the order form (after customer name / phone) when the table is
// Indoor-AC; it is REQUIRED there and priced when the order is placed
// (acChargeForNewOrder, called by orderService.placeOrderTx):
//   • only on DINE_IN orders seated in Indoor-AC (utils/diningArea.js);
//   • charged ONCE per table visit: a follow-up order, or another order while
//     the table's open session already has a counted order, adds nothing;
//   • the rate comes from RestaurantProfile.acServiceChargePerGuest (default
//     ₹20) and is SNAPSHOTTED on the order (Order.acServiceRate);
//   • a PAID, settled, completed or cancelled order is never changed.
// The charge is part of Order.subtotal and Order.total (pricing.computeTotals
// carries it through a re-price) — so payment, PhonePe amount and reports
// all include it. Coupon and GST apply to the item value only.
// The older "guests at bill print" path (applyGuestsToOrder/Selection) is
// still accepted by the print endpoints but no app sends it any more.
// ─────────────────────────────────────────────────────────────────────────────
import { DINING_AREA_AC_ROOM } from "../utils/diningArea.js";
import { effectiveBillStatus } from "../utils/orderStateMachine.js";

export const GUESTS_MAX = 100;
export const DEFAULT_AC_RATE = 20;

const httpError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const round2 = (n) => Math.round(n * 100) / 100;

/** Request value → guest count, or null when not given. 400 when invalid. */
export const parseGuests = (raw) => {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > GUESTS_MAX) throw httpError(`Guests must be a whole number from 1 to ${GUESTS_MAX}`);
  return n;
};

export const isAcRoomOrder = (o) => o?.orderType === "DINE_IN" && o?.diningArea === DINING_AREA_AC_ROOM;

/** A bill that is paid / settled / finished keeps its charge forever. */
export const isChargeLocked = (o) =>
  o?.paymentStatus === "PAID" || effectiveBillStatus(o) === "SETTLED" || ["COMPLETED", "CANCELLED"].includes(o?.status);

/** The order's own snapshotted rate, else the profile's current rate. */
export const acRateFor = (order, profile) => {
  if (order?.acServiceRate != null) return Number(order.acServiceRate);
  const r = Number(profile?.acServiceChargePerGuest);
  return Number.isFinite(r) && r >= 0 ? r : DEFAULT_AC_RATE;
};

/**
 * A new staff order at an Indoor-AC table → the fields to store
 * ({ guests, acServiceRate, acServiceCharge }), or {} when nothing is charged.
 * `alreadyCounted`: the table's open session already has a counted order.
 * Throws 400 when the guest count is required but missing.
 */
export const acChargeForNewOrder = ({ isAcRoom, isStaffOrder, isFollowUp, alreadyCounted, guests, profile }) => {
  if (!isAcRoom || !isStaffOrder || isFollowUp || alreadyCounted) return {};
  if (guests == null) throw httpError("Enter the number of guests — required for an Indoor-AC table");
  const rate = acRateFor(null, profile);
  return { guests, acServiceRate: rate, acServiceCharge: round2(guests * rate) };
};

const itemValue = (order) => (order.items || []).reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 0), 0);

/** Pure: the fields to $set for `guests` on `order` (null = nothing to change). */
export const guestChargeUpdate = (order, guests, profile) => {
  if (guests == null || isChargeLocked(order)) return null;
  const set = { guests };
  if (isAcRoomOrder(order)) {
    const rate = acRateFor(order, profile);
    const charge = round2(guests * rate);
    set.acServiceRate = rate;
    set.acServiceCharge = charge;
    set.subtotal = round2(itemValue(order) + charge);
    set.total = round2((Number(order.total) || 0) - (Number(order.acServiceCharge) || 0) + charge);
  }
  return set;
};

/** Atomic write of `set` against the order as it was read. */
const writeCharge = async (Order, order, set) => {
  const oldCharge = Number(order.acServiceCharge) || 0;
  const updated = await Order.findOneAndUpdate(
    {
      _id: order._id,
      total: order.total,
      acServiceCharge: oldCharge ? oldCharge : { $in: [0, null] }, // older orders have no field
      paymentStatus: { $ne: "PAID" },
      billStatus: { $ne: "SETTLED" },
      status: { $nin: ["COMPLETED", "CANCELLED"] },
    },
    { $set: set },
    { returnDocument: "after" },
  );
  if (!updated) throw httpError("This bill changed a moment ago (paid or edited) — please try again", 409);
  return updated;
};

/** Single bill print: record guests; AC Room → (re)compute the charge. */
export const applyGuestsToOrder = async ({ Order, order, guests, profile }) => {
  const set = guestChargeUpdate(order, guests, profile);
  if (!set) return order;
  return writeCharge(Order, order, set);
};

/**
 * Combined bill print: guests are asked ONCE for the whole bill, so the
 * charge goes on ONE AC Room order (the oldest still-open one) and any other
 * open AC Room order on the bill is set back to 0 — never charged twice.
 * If the selection already contains a paid/settled order that carries an AC
 * charge, the guests were already billed: nothing changes.
 * @returns {boolean} true when anything was written (caller re-reads).
 */
export const applyGuestsToSelection = async ({ Order, orders, guests, profile }) => {
  if (guests == null) return false;
  const ac = orders.filter(isAcRoomOrder);
  if (!ac.length) return false;
  if (ac.some((o) => isChargeLocked(o) && Number(o.acServiceCharge) > 0)) return false;
  const target = ac.find((o) => !isChargeLocked(o));
  if (!target) return false;
  await writeCharge(Order, target, guestChargeUpdate(target, guests, profile));
  for (const o of ac) {
    if (o === target || isChargeLocked(o) || !(Number(o.acServiceCharge) > 0)) continue;
    await writeCharge(Order, o, {
      acServiceCharge: 0,
      subtotal: round2(itemValue(o)),
      total: round2((Number(o.total) || 0) - Number(o.acServiceCharge)),
    });
  }
  return true;
};
