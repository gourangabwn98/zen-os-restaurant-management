// test/payFirst.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Customer payment mode (utils/paymentMode.js) and pay-first orders:
// AWAITING_PAYMENT on placement, promotion only on a verified payment,
// expiry of unpaid orders, and the state-machine rules around them.
// No DB, no network — fake models; PhonePe "configured" via env. Run:
//   node test/payFirst.test.js
// ─────────────────────────────────────────────────────────────────────────────

import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const {
  effectivePaymentMode, allowedPaymentMethods, resolveCustomerPaymentMethod, isPayFirst, PAY_FIRST_WINDOW_MS,
} = await import("../utils/paymentMode.js");
const { validateTransition } = await import("../utils/orderStateMachine.js");
const { placeOrderTx, promotePaidOrder, expireUnpaidOrders } = await import("../services/orderService.js");
const { runPayFirstTick } = await import("../services/payFirstService.js");

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.error(`  ✗ ${name}\n    ${err.stack || err.message}`); }
};

const phonePe = (on) => {
  if (on) { process.env.PHONEPE_MERCHANT_ID = "M1"; process.env.PHONEPE_SALT_KEY = "salt"; }
  else { delete process.env.PHONEPE_MERCHANT_ID; delete process.env.PHONEPE_SALT_KEY; }
};

// ── Fakes ────────────────────────────────────────────────────────────────────
const MENU = [{ _id: "m1", name: "Cold Coffee", price: 90, isAvailable: true, category: "Drinks" }];
const val = (v) => (v instanceof Date ? v.getTime() : v);
const matches = (doc, f) => Object.entries(f).every(([k, c]) => {
  const v = doc[k];
  if (c && typeof c === "object" && !(c instanceof Date)) {
    return Object.entries(c).every(([op, x]) =>
      op === "$lte" ? v != null && val(v) <= val(x)
      : op === "$ne" ? val(v) !== val(x)
      : (() => { throw new Error(`fake: ${op}`); })());
  }
  return String(val(v)) === String(val(c));
});

const makeWorld = ({ profile = {}, table = null, orders = [] } = {}) => {
  const state = { orders: orders.map((o) => ({ statusHistory: [], ...o })), sessionsOpened: 0, sessionOrders: [] };
  let n = 0;
  const doc = (o) => o && ({ ...o, toObject: () => ({ ...o }) });
  const models = {
    MenuItem: { findById: async (id) => MENU.find((m) => m._id === id) || null },
    RestaurantProfile: { findOne: async () => ({ gstRate: 0, serviceCharge: 0, ...profile }) },
    Category: { find: () => ({ select: () => ({ lean: async () => [] }) }) },
    Table: { findOne: async () => table, updateOne: async () => ({}) },
    TableSession: {
      findOne: async () => null,
      create: async (d) => { state.sessionsOpened++; return { _id: "sess1", ...d }; },
      findByIdAndUpdate: async (_id, u) => { state.sessionOrders.push(u.$addToSet?.orders); return {}; },
    },
    KOTJob: {},
    Order: {
      findOne: async (f) => {
        const clean = Object.fromEntries(Object.entries(f || {}).filter(([, v]) => v !== undefined));
        return doc(state.orders.find((o) => matches(o, clean)) || null);
      },
      findById: async (id) => doc(state.orders.find((o) => String(o._id) === String(id)) || null),
      find: (f) => {
        const rows = state.orders.filter((o) => matches(o, f)).map(doc);
        const q = { limit: () => q, select: () => q, lean: async () => rows, then: (r, j) => Promise.resolve(rows).then(r, j) };
        return q;
      },
      create: async (payload) => { const o = { _id: `o${++n}`, orderId: `ORD${n}`, ...payload }; state.orders.push(o); return doc(o); },
      findOneAndUpdate: async (f, u) => {
        const o = state.orders.find((x) => matches(x, f));
        if (!o) return null;
        Object.assign(o, u.$set || {});
        if (u.$push?.statusHistory) o.statusHistory = [...(o.statusHistory || []), u.$push.statusHistory];
        return doc(o);
      },
    },
  };
  return { state, models };
};

const body = (extra = {}) => ({ items: [{ menuItemId: "m1", qty: 1 }], orderType: "TAKEAWAY", customerName: "Asha", customerPhone: "9999999999", ...extra });
const place = (models, extra, user = null) => placeOrderTx({ req: { models, db: {}, user }, body: body(extra) });

// ── paymentMode util ─────────────────────────────────────────────────────────
await test("effective mode: ONLINE without PhonePe falls back to CASH; unknown → BOTH", () => {
  assert.equal(effectivePaymentMode("ONLINE", false), "CASH");
  assert.equal(effectivePaymentMode("ONLINE", true), "ONLINE");
  assert.equal(effectivePaymentMode("CASH", true), "CASH");
  assert.equal(effectivePaymentMode(undefined, true), "BOTH");
  assert.equal(effectivePaymentMode("nonsense", false), "BOTH");
  assert.deepEqual(allowedPaymentMethods("BOTH"), ["Cash", "Online"]);
});

await test("resolve method: disallowed choice → 400; missing → the only allowed one", () => {
  assert.throws(() => resolveCustomerPaymentMethod({ requested: "Online", mode: "CASH", phonePeEnabled: true }), (e) => e.statusCode === 400);
  assert.throws(() => resolveCustomerPaymentMethod({ requested: "Cash", mode: "ONLINE", phonePeEnabled: true }), (e) => e.statusCode === 400);
  assert.throws(() => resolveCustomerPaymentMethod({ requested: "Bitcoin", mode: "BOTH", phonePeEnabled: true }), (e) => e.statusCode === 400);
  assert.equal(resolveCustomerPaymentMethod({ mode: "ONLINE", phonePeEnabled: true }), "Online");
  assert.equal(resolveCustomerPaymentMethod({ mode: "BOTH", phonePeEnabled: true }), "Cash");
  assert.equal(isPayFirst("Online", true), true);
  assert.equal(isPayFirst("Online", false), false, "UPI fallback can't be verified → not pay-first");
});

// ── placeOrderTx ─────────────────────────────────────────────────────────────
await test("CASH mode: cash order goes straight to PENDING_CONFIRMATION; online is refused", async () => {
  phonePe(true);
  const { models } = makeWorld({ profile: { paymentMode: "CASH" } });
  const { order } = await place(models, { paymentMethod: "Cash" });
  assert.equal(order.status, "PENDING_CONFIRMATION");
  assert.equal(order.paymentDeadline, null);
  await assert.rejects(place(models, { paymentMethod: "Online" }), (e) => e.statusCode === 400);
});

await test("ONLINE mode + PhonePe: order starts AWAITING_PAYMENT with a deadline; cash refused", async () => {
  phonePe(true);
  const { models } = makeWorld({ profile: { paymentMode: "ONLINE" } });
  const before = Date.now();
  const { order } = await place(models, { paymentMethod: "Online" });
  assert.equal(order.status, "AWAITING_PAYMENT");
  assert.equal(order.paymentMethod, "Online");
  const dl = new Date(order.paymentDeadline).getTime();
  assert.ok(dl >= before + PAY_FIRST_WINDOW_MS - 1000 && dl <= Date.now() + PAY_FIRST_WINDOW_MS);
  await assert.rejects(place(models, { paymentMethod: "Cash" }), (e) => e.statusCode === 400);
});

await test("pay-first dine-in order does NOT open/join the table session until paid", async () => {
  phonePe(true);
  const table = { _id: "t5", tableNo: 5, status: "Active", qrToken: "qr5" };
  const { models, state } = makeWorld({ profile: { paymentMode: "ONLINE" }, table });
  const { order } = await place(models, { paymentMethod: "Online", orderType: "DINE_IN", tableNo: 5, tableToken: "qr5" });
  assert.equal(order.status, "AWAITING_PAYMENT");
  assert.equal(order.tableSession, null);
  assert.equal(state.sessionsOpened, 0);
});

await test("pay-first dine-in still validates the table QR token", async () => {
  phonePe(true);
  const table = { _id: "t5", tableNo: 5, status: "Active", qrToken: "qr5" };
  const { models } = makeWorld({ profile: { paymentMode: "ONLINE" }, table });
  await assert.rejects(place(models, { paymentMethod: "Online", orderType: "DINE_IN", tableNo: 5, tableToken: "WRONG" }), (e) => e.statusCode === 400);
});

await test("BOTH mode: Online + PhonePe is pay-first; Online without PhonePe keeps the old UPI flow", async () => {
  const { models } = makeWorld({ profile: { paymentMode: "BOTH" } });
  phonePe(true);
  assert.equal((await place(models, { paymentMethod: "Online" })).order.status, "AWAITING_PAYMENT");
  phonePe(false);
  assert.equal((await place(models, { paymentMethod: "Online" })).order.status, "PENDING_CONFIRMATION");
  assert.equal((await place(models, { paymentMethod: "Cash" })).order.status, "PENDING_CONFIRMATION");
});

await test("ONLINE mode but PhonePe removed from the server: customers can still order with cash", async () => {
  phonePe(false);
  const { models } = makeWorld({ profile: { paymentMode: "ONLINE" } });
  assert.equal((await place(models, { paymentMethod: "Cash" })).order.status, "PENDING_CONFIRMATION");
});

// ── State machine ────────────────────────────────────────────────────────────
await test("state machine: only the system promotes AWAITING_PAYMENT; customer may cancel it", () => {
  assert.equal(validateTransition("AWAITING_PAYMENT", "PENDING_CONFIRMATION", "system").ok, true);
  assert.equal(validateTransition("AWAITING_PAYMENT", "PENDING_CONFIRMATION", "waiter").ok, false);
  assert.equal(validateTransition("AWAITING_PAYMENT", "PENDING_CONFIRMATION", "customer").ok, false);
  assert.equal(validateTransition("AWAITING_PAYMENT", "CONFIRMED", "waiter").ok, false, "can't skip ahead");
  assert.equal(validateTransition("AWAITING_PAYMENT", "CANCELLED", "customer").ok, true);
  assert.equal(validateTransition("AWAITING_PAYMENT", "CANCELLED", "system").ok, true);
  assert.equal(validateTransition("AWAITING_PAYMENT", "CANCELLED", "waiter").ok, false);
});

// ── Promotion ────────────────────────────────────────────────────────────────
await test("promote: unpaid order is not promoted", async () => {
  const { models } = makeWorld({ orders: [{ _id: "o1", status: "AWAITING_PAYMENT", paymentStatus: "PENDING_VERIFICATION", orderType: "TAKEAWAY" }] });
  const r = await promotePaidOrder({ models, orderId: "o1" });
  assert.equal(r.promoted, false);
  assert.equal(r.order.status, "AWAITING_PAYMENT");
});

await test("promote: paid order → PENDING_CONFIRMATION exactly once, joins the table session", async () => {
  const table = { _id: "t5", tableNo: 5, status: "Active" };
  const { models, state } = makeWorld({
    table,
    orders: [{ _id: "o1", status: "AWAITING_PAYMENT", paymentStatus: "PAID", orderType: "DINE_IN", tableNo: 5, paymentDeadline: new Date() }],
  });
  const r1 = await promotePaidOrder({ models, orderId: "o1" });
  const r2 = await promotePaidOrder({ models, orderId: "o1" });
  assert.equal(r1.promoted, true);
  assert.equal(r2.promoted, false);
  const o = state.orders[0];
  assert.equal(o.status, "PENDING_CONFIRMATION");
  assert.equal(o.tableSession, "sess1");
  assert.equal(o.paymentDeadline, null);
  assert.ok(o.cancelDeadline > new Date(), "customer cancel window starts at promotion");
  assert.deepEqual(state.sessionOrders, ["o1"]);
  assert.equal(o.statusHistory.at(-1).note, "Paid online");
});

// ── Expiry ───────────────────────────────────────────────────────────────────
const NOW = new Date(Date.UTC(2026, 8, 30, 12, 0));
const mins = (m) => new Date(NOW.getTime() + m * 60000);

await test("expire: unpaid past deadline → CANCELLED; not-yet-due and paid ones untouched", async () => {
  const { models, state } = makeWorld({ orders: [
    { _id: "late", status: "AWAITING_PAYMENT", paymentStatus: "PENDING_VERIFICATION", paymentDeadline: mins(-1) },
    { _id: "early", status: "AWAITING_PAYMENT", paymentStatus: "PENDING_VERIFICATION", paymentDeadline: mins(5) },
    { _id: "paid", status: "AWAITING_PAYMENT", paymentStatus: "PAID", paymentDeadline: mins(-1) },
  ] });
  const cancelled = await expireUnpaidOrders({ models, now: NOW });
  assert.deepEqual(cancelled.map((o) => o._id), ["late"]);
  const by = Object.fromEntries(state.orders.map((o) => [o._id, o]));
  assert.equal(by.late.status, "CANCELLED");
  assert.equal(by.late.cancelReason, "Not paid in time");
  assert.equal(by.early.status, "AWAITING_PAYMENT");
  assert.equal(by.paid.status, "AWAITING_PAYMENT", "a paid order is promoted, never cancelled");
});

await test("tick: promotes a paid-but-stuck order and expires an unpaid one", async () => {
  phonePe(false);
  const { models, state } = makeWorld({ orders: [
    { _id: "stuck", status: "AWAITING_PAYMENT", paymentStatus: "PAID", orderType: "TAKEAWAY", paymentDeadline: mins(-3) },
    { _id: "late", status: "AWAITING_PAYMENT", paymentStatus: "PENDING_VERIFICATION", paymentDeadline: mins(-1) },
  ] });
  const promoted = [], expired = [];
  const r = await runPayFirstTick({ models, now: NOW, onPromoted: (o) => promoted.push(o._id), onExpired: (o) => expired.push(o._id) });
  assert.deepEqual(r, { promoted: 1, expired: 1 });
  assert.deepEqual(promoted, ["stuck"]);
  assert.deepEqual(expired, ["late"]);
  assert.equal(state.orders.find((o) => o._id === "stuck").status, "PENDING_CONFIRMATION");
});

await test("tick: an attempt still in flight on PhonePe gets extra time before cancelling", async () => {
  phonePe(false);
  const inflight = { _id: "fly", status: "AWAITING_PAYMENT", paymentStatus: "PENDING_VERIFICATION", paymentDeadline: mins(-2), payment: { state: "PENDING" } };
  const { models, state } = makeWorld({ orders: [inflight] });
  await runPayFirstTick({ models, now: NOW });
  assert.equal(state.orders[0].status, "AWAITING_PAYMENT", "within grace");
  await runPayFirstTick({ models, now: mins(9) });
  assert.equal(state.orders[0].status, "CANCELLED", "grace over");
});

phonePe(false);
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ALL TESTS PASSED");
