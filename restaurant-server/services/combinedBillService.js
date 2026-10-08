// services/combinedBillService.js
// ─────────────────────────────────────────────────────────────────────────────
// Admin → Orders → a table → "Generate Combine Bill": the admin ticks SOME of
// the table's orders, then previews / prints ONE combined bill, marks the
// ticked ones paid, or completes them.
//
// A combined bill is only a grouping of existing orders — never a new money
// record. Every figure is the orders' own stored subtotal / discount / tax /
// serviceCharge / total; payment and completion stay per order (each order
// is still counted exactly once by revenueOrderMatch everywhere).
//
// Selection rule = the existing table combined bill (getCombinedBill): the
// table's DINE_IN orders that are accepted and still on the table
// (CONFIRMED, PREPARING, READY, DELIVERED). Every id is re-checked here
// against the database — nothing about an order is taken from the client.
// Each write is one atomic conditional update per order, so retries, double
// clicks and two admins at once are safe; the result lists what happened to
// every requested id.
// ─────────────────────────────────────────────────────────────────────────────
import { ORDER_STATUSES, PAYMENT_STATUSES, ORDER_TYPES } from "../utils/orderStateMachine.js";
import { roundMoney } from "../utils/recipeCost.js";
import { parseGuests, applyGuestsToSelection } from "./acServiceCharge.js";

const pick = (list, v) => { if (!list.includes(v)) throw new Error(`combinedBillService: unknown enum ${v}`); return v; };
const CANCELLED = pick(ORDER_STATUSES, "CANCELLED");
const COMPLETED = pick(ORDER_STATUSES, "COMPLETED");
const PAID = pick(PAYMENT_STATUSES, "PAID");
const DINE_IN = pick(ORDER_TYPES, "DINE_IN");
export const COMBINABLE = ["CONFIRMED", "PREPARING", "READY", "DELIVERED"].map((s) => pick(ORDER_STATUSES, s));
export const MAX_SELECTION = 50;
const PAY_METHODS = ["Cash", "Online"];

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const httpError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

/** Pure: request body → { tableNo, groupOf, ids } or throws 400. Duplicates
 * collapse. Table mode (tableNo) as before; KH-07 group mode (groupOf = any
 * order of the group) bills an order together with its follow-ups — used for
 * takeaway, which has no table. */
export const parseSelection = (body = {}) => {
  const groupOf = body.groupOf != null && body.groupOf !== "" ? String(body.groupOf) : null;
  if (groupOf && !OBJECT_ID.test(groupOf)) throw httpError("Invalid order id");
  const tableNo = groupOf ? null : Number(body.tableNo);
  if (!groupOf && (!Number.isInteger(tableNo) || tableNo <= 0)) throw httpError("tableNo is required");
  if (!Array.isArray(body.orderIds) || !body.orderIds.length) throw httpError("Select at least one order");
  const ids = [...new Set(body.orderIds.map(String))];
  if (ids.length > MAX_SELECTION) throw httpError(`At most ${MAX_SELECTION} orders at once`);
  const bad = ids.filter((id) => !OBJECT_ID.test(id));
  if (bad.length) throw httpError(`Invalid order id: ${bad[0]}`);
  return groupOf ? { tableNo, groupOf, ids } : { tableNo, ids }; // table mode: shape unchanged
};

/** Root of an order's follow-up group (KH-07): its parent, or itself. */
export const groupRootId = (order) => String(order?.parentOrder || order?._id || "");

/** Pure: why an order can't be part of this combined bill, or null.
 * `scope` = a table number (table mode, as before) or { rootId } (group mode). */
export const ineligibleReason = (order, scope) => {
  if (!order) return "Order not found";
  if (scope && typeof scope === "object") {
    if (groupRootId(order) !== String(scope.rootId)) return "Not part of this order";
  } else if (order.orderType !== DINE_IN || Number(order.tableNo) !== scope) return "Not an order of this table";
  if (order.status === CANCELLED) return "Cancelled";
  if (!COMBINABLE.includes(order.status)) return order.status === COMPLETED ? "Already completed" : "Not accepted yet";
  return null;
};

/** Pure: the combined figures — sums of the orders' STORED amounts. */
export const combineTotals = (orders) => {
  const sum = (f) => roundMoney(orders.reduce((s, o) => s + (Number(o[f]) || 0), 0));
  const paid = orders.filter((o) => o.paymentStatus === PAID);
  return {
    orderCount: orders.length,
    subtotal: sum("subtotal"), discount: sum("discount"), tax: sum("tax"),
    serviceCharge: sum("serviceCharge"), acServiceCharge: sum("acServiceCharge"), total: sum("total"),
    paidTotal: roundMoney(paid.reduce((s, o) => s + (Number(o.total) || 0), 0)),
    dueTotal: roundMoney(orders.filter((o) => o.paymentStatus !== PAID).reduce((s, o) => s + (Number(o.total) || 0), 0)),
    allPaid: orders.length > 0 && paid.length === orders.length,
  };
};

// The customer on an order (staff-placed orders keep the waiter in `user`).
const customerOf = (o) => o.guestName || ((!o.source || o.source === "CUSTOMER") ? o.user?.name : "") || "";

/** Loads + validates a selection. → { tableNo, rootId, orders (eligible, oldest first), rejected } */
export const resolveSelection = async ({ models, body }) => {
  const { tableNo, groupOf, ids } = parseSelection(body);
  let rootId = null;
  if (groupOf) {
    const anchor = await models.Order.findById(groupOf).select("_id parentOrder").lean();
    if (!anchor) throw httpError("Order not found", 404);
    rootId = groupRootId(anchor);
  }
  const scope = rootId ? { rootId } : tableNo;
  const found = await models.Order.find({ _id: { $in: ids } }).populate("user", "name phone").lean();
  const byId = new Map(found.map((o) => [String(o._id), o]));
  const orders = [], rejected = [];
  for (const id of ids) {
    const o = byId.get(id);
    const why = ineligibleReason(o, scope);
    if (why) rejected.push({ id, orderId: o?.orderId || "", reason: why });
    else orders.push(o);
  }
  orders.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  return { tableNo, rootId, orders, rejected };
};

/** KH-07 — an order with its follow-ups (root first, oldest first), for the
 * waiter/admin order screen. Cancelled and unpaid pay-first ones are left out. */
export const orderGroup = async ({ models, id }) => {
  if (!OBJECT_ID.test(String(id))) throw httpError("Invalid order id");
  const anchor = await models.Order.findById(id).select("_id parentOrder").lean();
  if (!anchor) throw httpError("Order not found", 404);
  const rootId = groupRootId(anchor);
  const orders = await models.Order.find({
    $or: [{ _id: rootId }, { parentOrder: rootId }],
    status: { $nin: [CANCELLED, "AWAITING_PAYMENT"] },
  }).sort({ createdAt: 1 }).lean();
  return { rootId, orders };
};

/** Preview ("Generate Combined Bill") — read only. */
export const previewCombinedBill = async ({ models, body }) => {
  const { tableNo, orders, rejected } = await resolveSelection({ models, body });
  return {
    tableNo, rejected,
    orders: orders.map((o) => ({
      _id: o._id, orderId: o.orderId, status: o.status, paymentStatus: o.paymentStatus, paymentMethod: o.paymentMethod,
      customer: customerOf(o), createdAt: o.createdAt,
      items: (o.items || []).map((i) => ({ name: i.name, nameBn: i.nameBn || "", qty: i.qty, price: i.price, addons: i.addons || [] })),
      subtotal: o.subtotal, discount: o.discount || 0, couponCode: o.coupon?.code || "", tax: o.tax, serviceCharge: o.serviceCharge, total: o.total,
    })),
    totals: combineTotals(orders),
  };
};

/** The BillPrintJob payload for ONE combined bill (billRenderer's `orders` layout). */
export const combinedPrintPayload = ({ tableNo, orders, restaurant }) => {
  const orderType = orders[0]?.orderType || DINE_IN; // KH-07: a takeaway group too
  const t = combineTotals(orders);
  const methods = [...new Set(orders.filter((o) => o.paymentStatus === PAID).map((o) => o.paymentMethod || "Cash"))];
  return {
    combined: true,
    restaurantName: restaurant?.restaurantName || "",
    logoUrl: /^https?:\/\//i.test(restaurant?.logo || "") ? restaurant.logo : "",
    orderId: `${orders.length} orders`,
    tableNo: tableNo ?? orders[0]?.tableNo ?? null, orderType,
    // KH-10: "AC Room"/"Garden" when every order on the bill sits there.
    diningArea: new Set(orders.map((o) => o.diningArea || "")).size === 1 ? (orders[0]?.diningArea || "") : "",
    orders: orders.map((o) => ({
      orderId: o.orderId, total: o.total, paymentStatus: o.paymentStatus,
      items: (o.items || []).map((i) => ({ name: i.name, qty: i.qty, price: i.price, addons: i.addons || [] })),
    })),
    items: orders.flatMap((o) => o.items || []).map((i) => ({ name: i.name, qty: i.qty, price: i.price, addons: i.addons || [] })),
    subtotal: t.subtotal, discount: t.discount, tax: t.tax, serviceCharge: t.serviceCharge, total: t.total,
    // KH-11 — AC Room guest service charge (inside total), with its guests × rate.
    acServiceCharge: t.acServiceCharge,
    ...(() => { const o = orders.find((x) => Number(x.acServiceCharge) > 0); return o ? { guests: o.guests ?? null, acServiceRate: o.acServiceRate ?? null } : {}; })(),
    couponCode: "",
    paymentStatus: t.allPaid ? PAID : "PENDING_VERIFICATION",
    paymentMethod: t.allPaid ? methods.join(" + ") : "",
    dueTotal: t.dueTotal,
    guestName: [...new Set(orders.map(customerOf).filter(Boolean))].join(", "),
    guestPhone: "",
  };
};

/** "Print Combined Bill" — exactly ONE BillPrintJob for the selection.
 * Double clicks / retries: the client sends a requestKey per print intent
 * (unique index → the second insert returns the first job), and an identical
 * selection printed in the last 15 s by anyone returns that job too. */
export const printCombinedBill = async ({ models, body, actor }) => {
  const { BillPrintJob, RestaurantProfile } = models;
  let { tableNo, orders, rejected } = await resolveSelection({ models, body });
  if (!orders.length) throw httpError("None of the selected orders can be billed", 409);
  const guests = parseGuests(body.guests); // KH-11 — asked once for the whole bill
  const key = orders.map((o) => String(o._id)).sort().join(",");
  const requestKey = typeof body.requestKey === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(body.requestKey) ? body.requestKey : null;

  if (requestKey) {
    const same = await BillPrintJob.findOne({ requestKey }).lean();
    if (same) return { job: same, duplicate: true, rejected, payload: same.payload };
  }
  const recent = await BillPrintJob.findOne({ combinedKey: key, createdAt: { $gte: new Date(Date.now() - 15000) } }).lean();
  if (recent) return { job: recent, duplicate: true, rejected, payload: recent.payload };

  const restaurant = await RestaurantProfile.findOne().select("restaurantName logo acServiceChargePerGuest").lean();
  if (guests != null && await applyGuestsToSelection({ Order: models.Order, orders, guests, profile: restaurant })) {
    ({ tableNo, orders, rejected } = await resolveSelection({ models, body })); // re-read: totals changed
  }
  const payload = combinedPrintPayload({ tableNo, orders, restaurant });
  try {
    const job = await BillPrintJob.create({
      order: null, orderId: payload.orderId, tableNo: payload.tableNo, orderType: payload.orderType, payload,
      combinedKey: key, combinedOrders: orders.map((o) => o._id), ...(requestKey && { requestKey }),
      createdBy: actor,
    });
    return { job: job.toObject(), duplicate: false, rejected, payload };
  } catch (err) {
    if (err?.code === 11000 && requestKey) {
      const same = await BillPrintJob.findOne({ requestKey }).lean();
      return { job: same, duplicate: true, rejected, payload: same.payload };
    }
    throw err;
  }
};

/** "Mark Selected as Paid" — per order, atomic, idempotent.
 * Only an eligible, not-yet-paid order changes; an already-paid one is
 * reported, never re-written (its method stays as recorded). */
export const markSelectedPaid = async ({ models, body, canPay }) => {
  const method = body.paymentMethod;
  if (!PAY_METHODS.includes(method)) throw httpError(`paymentMethod must be one of: ${PAY_METHODS.join(", ")}`);
  if (!canPay) throw httpError("You are not allowed to mark payments", 403);
  const { tableNo, rootId, orders, rejected } = await resolveSelection({ models, body });
  const paid = [], alreadyPaid = [], changed = [];
  // Re-checked at write time: still in this table / group (KH-07).
  const scopeFilter = rootId ? { $or: [{ _id: rootId }, { parentOrder: rootId }] } : { orderType: DINE_IN, tableNo };
  for (const o of orders) {
    if (o.paymentStatus === PAID) { alreadyPaid.push(o.orderId); continue; }
    const updated = await models.Order.findOneAndUpdate(
      // Re-checked at write time: still this table, still combinable, still unpaid.
      { _id: o._id, ...scopeFilter, status: { $in: COMBINABLE }, paymentStatus: { $ne: PAID } },
      { $set: { paymentStatus: PAID, paymentMethod: method } },
      { returnDocument: "after" },
    );
    if (updated) { paid.push(o.orderId); changed.push(updated); continue; }
    const now = await models.Order.findById(o._id).select("status paymentStatus orderId").lean();
    if (now?.paymentStatus === PAID) alreadyPaid.push(o.orderId);
    else rejected.push({ id: String(o._id), orderId: o.orderId, reason: now?.status === CANCELLED ? "Cancelled" : "Changed by someone else — refresh" });
  }
  return { paid, alreadyPaid, rejected, changed };
};

/** "Settle Selected" (BIL-01/BIL-02) — settles the ticked orders' bills
 * through the billing workflow (services/billingService.js settleBills): a
 * not-yet-paid order needs `paymentMethod` (it's collected now); a served
 * order is completed right after; one still cooking stays cooking and
 * completes when it's served. Nobody completes an order by hand any more.
 * `settle` is billingService.settleBills (injected to keep this module free
 * of the order-service import chain in tests). */
export const completeSelected = async ({ req, body, settle, actor, role }) => {
  const { orders, rejected } = await resolveSelection({ models: req.models, body });
  if (!orders.length) {
    const done = rejected.filter((r) => r.reason === "Already completed");
    return { settled: [], alreadySettled: done.map((r) => r.orderId), completed: [], rejected: rejected.filter((r) => r.reason !== "Already completed"), changed: [], completions: [] };
  }
  const r = await settle({
    models: req.models, orderIds: orders.map((o) => String(o._id)), paymentMethod: body.paymentMethod || undefined, actor, role,
  });
  // Ids that were already COMPLETED at selection time come back as rejected
  // "Already completed" from resolveSelection — their bills are settled.
  const done = rejected.filter((x) => x.reason === "Already completed");
  return {
    settled: r.settled,
    alreadySettled: [...r.alreadySettled, ...done.map((x) => x.orderId)],
    completed: r.completions.map((c) => c.order.orderId),
    rejected: [...rejected.filter((x) => x.reason !== "Already completed"), ...r.rejected],
    changed: r.changed, completions: r.completions,
  };
};
