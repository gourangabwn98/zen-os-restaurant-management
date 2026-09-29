// test/editWindow.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Order flow: staff orders start CONFIRMED ("Placed"); customer orders start
// PENDING_CONFIRMATION until a waiter/admin accepts them (→ CONFIRMED). A
// Placed order can be edited until autoPrepareAt (default 3 min), then moves
// to PREPARING — KOT + stock in the same transaction — by the timer or
// "Start preparing". No DB — fakes whose session writes only apply on
// commit. Run:
//   node test/editWindow.test.js
// ─────────────────────────────────────────────────────────────────────────────

import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
delete process.env.PHONEPE_MERCHANT_ID;

const {
  placeOrderTx, sendToKitchenTx, confirmOrderTx, autoSendDueOrders, modifyOrderItemsTx, promotePaidOrder,
  transitionOrderStatusTx, editWindowMs,
} = await import("../services/orderService.js");
const { validateTransition } = await import("../utils/orderStateMachine.js");
const { signGuestOrderToken } = await import("../utils/guestOrderToken.js");

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.error(`  ✗ ${name}\n    ${err.stack || err.message}`); }
};

// ── Fakes ────────────────────────────────────────────────────────────────────
const MENU = [
  { _id: "m1", name: "Cold Coffee", price: 90, isAvailable: true, category: "Drinks" },
  { _id: "m2", name: "Sandwich", price: 120, isAvailable: true, category: "Snacks" },
];
const val = (v) => (v instanceof Date ? v.getTime() : v);
const matches = (doc, f) => Object.entries(f).every(([k, c]) => {
  const v = doc[k];
  if (c && typeof c === "object" && !(c instanceof Date)) {
    return Object.entries(c).every(([op, x]) =>
      op === "$lte" ? v != null && val(v) <= val(x)
      : op === "$ne" ? val(v) !== val(x)
      : op === "$in" ? x.map(val).includes(val(v) ?? null)
      : (() => { throw new Error(`fake: ${op}`); })());
  }
  return String(val(v)) === String(val(c));
});

/**
 * @param stock  { ingredientId: currentStock } — Sandwich (m2) needs 1 "bread".
 */
const makeWorld = ({ profile = {}, orders = [], stock = { bread: 10 }, failKot = false } = {}) => {
  const state = { orders: orders.map((o) => ({ statusHistory: [], stockDeducted: false, revision: 0, ...o })), kots: [], stock: { ...stock } };
  let n = 0;
  const doc = (o) => o && ({ ...o, toObject: () => ({ ...o }) });
  const apply = (o, u) => {
    Object.assign(o, u.$set || {});
    for (const [k, v] of Object.entries(u.$inc || {})) o[k] = (o[k] || 0) + v;
    const push = u.$push?.statusHistory;
    if (push) o.statusHistory = [...(o.statusHistory || []), ...(push.$each || [push])];
  };
  const staged = (session, fn) => (session ? session.stage(fn) : fn());

  const models = {
    MenuItem: { findById: async (id) => MENU.find((m) => m._id === id) || null },
    RestaurantProfile: { findOne: async () => ({ gstRate: 0, serviceCharge: 0, ...profile }) },
    Category: { find: () => ({ select: () => ({ lean: async () => [] }) }) },
    Recipe: { find: async () => [{ menuItem: "m2", status: "Active", ingredients: [{ inventoryItem: "bread", quantity: 1, unit: "pc" }] }] },
    InventoryItem: {
      find: () => {
        const rows = Object.entries(state.stock).map(([id, currentStock]) => ({ _id: id, name: id, unit: "pc", status: "Active", currentStock }));
        return { session: async () => rows, then: (r, j) => Promise.resolve(rows).then(r, j) };
      },
      findOneAndUpdate: async (f, u, opts) => {
        const cur = state.stock[f._id];
        if (cur == null || cur < f.currentStock.$gte) return null;
        staged(opts?.session, () => { state.stock[f._id] = cur + u.$inc.currentStock; });
        return { _id: f._id, name: f._id, currentStock: cur + u.$inc.currentStock, reorderLevel: 0, criticalLevel: 0, unit: "pc" };
      },
    },
    StockLedger: { create: async () => [{}] },
    InventoryBatch: { find: () => ({ sort: () => ({ session: async () => [] }) }), findOneAndUpdate: async () => null },
    Table: { findOne: async () => null },
    TableSession: { findByIdAndUpdate: async () => ({}) },
    KOTJob: {
      create: async (docs, opts) => {
        if (failKot) throw new Error("kot write failed");
        const job = { _id: `kot${state.kots.length + 1}`, ...docs[0] };
        staged(opts?.session, () => state.kots.push(job));
        return [job];
      },
      findOne: () => ({ session: async () => null }),
    },
    Order: {
      findOne: async (f) => {
        const clean = Object.fromEntries(Object.entries(f || {}).filter(([, v]) => v !== undefined));
        return doc(state.orders.find((o) => matches(o, clean)) || null);
      },
      findById: (id) => {
        const o = state.orders.find((x) => String(x._id) === String(id));
        const p = Promise.resolve(doc(o ? { ...o } : null));
        p.select = async () => doc(o ? { ...o } : null);
        return p;
      },
      find: (f) => {
        const rows = state.orders.filter((o) => matches(o, f)).map((o) => ({ ...o }));
        const q = { select: () => q, limit: () => q, lean: async () => rows };
        return q;
      },
      create: async (payload) => { const o = { _id: `o${++n}`, orderId: `ORD${n}`, stockDeducted: false, revision: 0, ...payload }; state.orders.push(o); return doc(o); },
      findByIdAndUpdate: async (id, u, opts = {}) => {
        const o = state.orders.find((x) => String(x._id) === String(id));
        if (o) staged(opts.session, () => apply(o, u));
        return doc(o);
      },
      findOneAndUpdate: async (f, u, opts = {}) => {
        const o = state.orders.find((x) => matches(x, f));
        if (!o) return null;
        const next = { ...o, statusHistory: [...(o.statusHistory || [])] };
        apply(next, u);
        staged(opts.session, () => apply(o, u));
        return doc(next);
      },
    },
  };
  const db = {
    startSession: async () => {
      let writes = [];
      return {
        stage: (fn) => writes.push(fn),
        withTransaction: async (fn) => { writes = []; await fn(); writes.forEach((w) => w()); },
        endSession: () => {},
      };
    },
  };
  return { state, models, db };
};

const WAITER = { _id: "w1", role: "waiter", name: "Ravi" };
const ADMIN = { _id: "a1", isAdmin: true, name: "Owner" };
const CUSTOMER = { _id: "u1", role: "customer", name: "Asha" };
const body = (extra = {}) => ({ items: [{ menuItemId: "m1", qty: 1 }], orderType: "TAKEAWAY", customerName: "Asha", customerPhone: "9999999999", ...extra });
const place = (w, user, extra) => placeOrderTx({ req: { models: w.models, db: w.db, user, headers: {} }, body: body(extra) });

// ── Placement ────────────────────────────────────────────────────────────────
await test("edit window defaults to 3 minutes, clamps to 0–15", () => {
  assert.equal(editWindowMs({}), 3 * 60000);
  assert.equal(editWindowMs({ editWindowMinutes: 0 }), 0);
  assert.equal(editWindowMs({ editWindowMinutes: 99 }), 15 * 60000);
  assert.equal(editWindowMs({ editWindowMinutes: -3 }), 0);
});

await test("waiter/admin orders start Placed (CONFIRMED) with a 3-minute timer — no KOT yet", async () => {
  for (const user of [WAITER, ADMIN]) {
    const w = makeWorld();
    const before = Date.now();
    const { order } = await place(w, user);
    assert.equal(order.status, "CONFIRMED", user.name);
    assert.equal(order.confirmedBy.name, user.name);
    const at = new Date(order.autoPrepareAt).getTime();
    assert.ok(at >= before + 3 * 60000 - 1000 && at <= Date.now() + 3 * 60000);
    assert.equal(w.state.kots.length, 0);
    assert.equal(w.state.stock.bread, 10);
  }
});

await test("customer/guest orders start Awaiting confirmation — no timer, cancellable any time", async () => {
  for (const user of [null, CUSTOMER]) {
    const w = makeWorld();
    const { order } = await place(w, user);
    assert.equal(order.status, "PENDING_CONFIRMATION");
    assert.equal(order.autoPrepareAt, null, "nothing happens until staff accept it");
    assert.equal(order.cancelDeadline, null);
    assert.equal(w.state.kots.length, 0);
  }
});

await test("0-minute window: a staff order goes straight to PREPARING with its KOT; a customer order still waits", async () => {
  let w = makeWorld({ profile: { editWindowMinutes: 0 } });
  const r = await place(w, WAITER, { items: [{ menuItemId: "m2", qty: 2 }] });
  assert.equal(r.order.status, "PREPARING");
  assert.equal(r.kotCreated, true);
  assert.equal(w.state.kots.length, 1);
  assert.equal(w.state.stock.bread, 8);
  w = makeWorld({ profile: { editWindowMinutes: 0 } });
  assert.equal((await place(w, CUSTOMER)).order.status, "PENDING_CONFIRMATION");
});

await test("placement fails early when stock clearly can't cover it", async () => {
  const w = makeWorld({ stock: { bread: 1 } });
  await assert.rejects(place(w, CUSTOMER, { items: [{ menuItemId: "m2", qty: 3 }] }), (e) => e.statusCode === 409 && /Insufficient stock/.test(e.message));
  assert.equal(w.state.orders.length, 0);
});

// ── Send to kitchen ──────────────────────────────────────────────────────────
const pending = (extra = {}) => ({
  _id: "o1", orderId: "ORD1", status: "CONFIRMED", orderType: "TAKEAWAY", source: "CUSTOMER",
  items: [{ menuItem: "m2", name: "Sandwich", qty: 2, price: 120 }], subtotal: 240, tax: 0, total: 240,
  paymentStatus: "PENDING_VERIFICATION", autoPrepareAt: new Date(Date.now() - 1000), sendError: "", ...extra,
});
const sys = { id: null, role: null, name: "System" };

await test("accept: Awaiting confirmation → Placed with a 3-min timer, no KOT; only once", async () => {
  const w = makeWorld({ orders: [pending({ status: "PENDING_CONFIRMATION", autoPrepareAt: null })] });
  const req = { models: w.models, db: w.db, user: WAITER, headers: {} };
  const before = Date.now();
  const r = await confirmOrderTx({ req, orderId: "o1" });
  assert.equal(r.order.status, "CONFIRMED");
  assert.equal(r.order.confirmedBy.name, "Ravi");
  assert.ok(new Date(r.order.autoPrepareAt).getTime() >= before + 3 * 60000 - 1000);
  assert.equal(w.state.kots.length, 0, "KOT prints at PREPARING, not at acceptance");
  await assert.rejects(confirmOrderTx({ req, orderId: "o1" }), (e) => e.statusCode === 400 || e.statusCode === 409);
});

await test("accept with a 0-minute window goes straight on to PREPARING + KOT", async () => {
  const w = makeWorld({ profile: { editWindowMinutes: 0 }, orders: [pending({ status: "PENDING_CONFIRMATION", autoPrepareAt: null })] });
  const r = await confirmOrderTx({ req: { models: w.models, db: w.db, user: ADMIN, headers: {} }, orderId: "o1" });
  assert.equal(r.order.status, "PREPARING");
  assert.equal(w.state.kots.length, 1);
});

await test("send: one transaction → PREPARING, stock deducted, one KOT; a second send is refused", async () => {
  const w = makeWorld({ orders: [pending()] });
  const r = await sendToKitchenTx({ models: w.models, db: w.db, orderId: "o1", actor: sys, role: "system" });
  assert.equal(r.order.status, "PREPARING");
  const o = w.state.orders[0];
  assert.equal(o.status, "PREPARING");
  assert.equal(o.autoPrepareAt, null);
  assert.equal(o.statusHistory.at(-1).status, "PREPARING");
  assert.equal(w.state.kots.length, 1);
  assert.equal(w.state.stock.bread, 8);
  await assert.rejects(sendToKitchenTx({ models: w.models, db: w.db, orderId: "o1", actor: sys, role: "system" }), (e) => e.statusCode === 400 || e.statusCode === 409);
  assert.equal(w.state.kots.length, 1);
});

await test("send: if the KOT write fails, nothing is committed (order still editable, stock untouched)", async () => {
  const w = makeWorld({ orders: [pending()], failKot: true });
  await assert.rejects(sendToKitchenTx({ models: w.models, db: w.db, orderId: "o1", actor: sys, role: "system" }));
  assert.equal(w.state.orders[0].status, "CONFIRMED");
  assert.equal(w.state.stock.bread, 10);
});

await test("chef/waiter \"Start preparing\" goes through the same step — the KOT prints", async () => {
  const w = makeWorld({ orders: [pending()] });
  const r = await transitionOrderStatusTx({ req: { models: w.models, db: w.db, user: { _id: "c1", role: "chef", name: "Chef" }, headers: {} }, orderId: "o1", toStatus: "PREPARING" });
  assert.equal(r.order.status, "PREPARING");
  assert.equal(r.kotCreated, true);
  assert.equal(w.state.kots.length, 1);
});

await test("roles: only admin/waiter accept; the timer can start preparing but never accept", () => {
  for (const r of ["admin", "waiter"]) assert.equal(validateTransition("PENDING_CONFIRMATION", "CONFIRMED", r).ok, true, r);
  for (const r of ["system", "customer", "chef"]) assert.equal(validateTransition("PENDING_CONFIRMATION", "CONFIRMED", r).ok, false, r);
  for (const r of ["system", "waiter", "chef", "admin"]) assert.equal(validateTransition("CONFIRMED", "PREPARING", r).ok, true, r);
  assert.equal(validateTransition("PENDING_CONFIRMATION", "PREPARING", "system").ok, false, "timer never skips acceptance");
});

// ── Timer ────────────────────────────────────────────────────────────────────
await test("timer: sends due orders only", async () => {
  const w = makeWorld({ orders: [
    pending({ _id: "due" }),
    pending({ _id: "later", autoPrepareAt: new Date(Date.now() + 60000) }),
    pending({ _id: "legacy", autoPrepareAt: null }),
    pending({ _id: "awaiting", status: "PENDING_CONFIRMATION" }),
  ] });
  const sent = [];
  const r = await autoSendDueOrders({ models: w.models, db: w.db, onSent: (x) => sent.push(x.order._id) });
  assert.deepEqual(r, { sent: 1, failed: 0 });
  assert.deepEqual(sent, ["due"]);
  const by = Object.fromEntries(w.state.orders.map((o) => [o._id, o.status]));
  assert.deepEqual(by, { due: "PREPARING", later: "CONFIRMED", legacy: "CONFIRMED", awaiting: "PENDING_CONFIRMATION" });
});

await test("timer: out of stock → parked with a reason for staff, not retried every tick", async () => {
  const w = makeWorld({ orders: [pending()], stock: { bread: 1 } });
  const flagged = [];
  let r = await autoSendDueOrders({ models: w.models, db: w.db, onFailed: (o) => flagged.push(o) });
  assert.deepEqual(r, { sent: 0, failed: 1 });
  const o = w.state.orders[0];
  assert.equal(o.status, "CONFIRMED");
  assert.match(o.sendError, /Insufficient stock/);
  assert.equal(o.autoPrepareAt, null);
  assert.equal(flagged.length, 1);
  r = await autoSendDueOrders({ models: w.models, db: w.db });
  assert.deepEqual(r, { sent: 0, failed: 0 }, "not retried");
});

// ── Editing ──────────────────────────────────────────────────────────────────
const edit = (w, user, { items, revision = 0, headers = {} }) =>
  modifyOrderItemsTx({ req: { models: w.models, db: w.db, user, headers }, orderId: "o1", items, revision });

await test("edit: waiter changes items → re-priced server-side, revision bumped", async () => {
  const w = makeWorld({ orders: [pending()] });
  const { order } = await edit(w, WAITER, { items: [{ menuItemId: "m1", qty: 3 }, { menuItemId: "m2", qty: 1, notes: "no onion" }] });
  assert.equal(order.total, 3 * 90 + 120);
  assert.equal(order.revision, 1);
  assert.equal(order.items.length, 2);
  assert.match(order.statusHistory.at(-1).note, /changed by Ravi/);
});

await test("edit: a stale revision is refused (someone else edited first)", async () => {
  const w = makeWorld({ orders: [pending({ revision: 2 })] });
  await assert.rejects(edit(w, WAITER, { items: [{ menuItemId: "m1", qty: 1 }], revision: 1 }), (e) => e.statusCode === 409 && /Someone else/.test(e.message));
});

await test("edit: only while Placed — not awaiting confirmation, not preparing, not after a KOT exists", async () => {
  for (const extra of [
    { status: "PENDING_CONFIRMATION" }, { status: "PREPARING" }, { status: "READY" }, { status: "AWAITING_PAYMENT" },
    { status: "CONFIRMED", stockDeducted: true }, // an admin moved a later order back to Placed
  ]) {
    const w = makeWorld({ orders: [pending(extra)] });
    await assert.rejects(edit(w, ADMIN, { items: [{ menuItemId: "m1", qty: 1 }] }), (e) => e.statusCode === 409, JSON.stringify(extra));
  }
});

await test("edit: customer owner / guest with token may; others may not; nobody may empty the order", async () => {
  let w = makeWorld({ orders: [pending({ user: "u1" })] });
  await edit(w, CUSTOMER, { items: [{ menuItemId: "m1", qty: 2 }] });
  await assert.rejects(edit(w, { _id: "u2", role: "customer" }, { items: [{ menuItemId: "m1", qty: 1 }], revision: 1 }), (e) => e.statusCode === 403);
  await assert.rejects(edit(w, { _id: "c1", role: "chef" }, { items: [{ menuItemId: "m1", qty: 1 }], revision: 1 }), (e) => e.statusCode === 403);
  await assert.rejects(edit(w, CUSTOMER, { items: [], revision: 1 }), (e) => e.statusCode === 400);
  await assert.rejects(edit(w, CUSTOMER, { items: [{ menuItemId: "m1", qty: 0 }], revision: 1 }), (e) => e.statusCode === 400);

  w = makeWorld({ orders: [pending({ user: null })] });
  await assert.rejects(edit(w, null, { items: [{ menuItemId: "m1", qty: 1 }] }), (e) => e.statusCode === 403, "guest without token");
  await edit(w, null, { items: [{ menuItemId: "m1", qty: 1 }], headers: { "x-guest-order-token": signGuestOrderToken("o1") } });
});

await test("edit: customer can't change an order paid online; staff can (and it's noted)", async () => {
  const w = makeWorld({ orders: [pending({ user: "u1", paymentStatus: "PAID" })] });
  await assert.rejects(edit(w, CUSTOMER, { items: [{ menuItemId: "m1", qty: 1 }] }), (e) => e.statusCode === 409 && /already paid/.test(e.message));
  const { order } = await edit(w, WAITER, { items: [{ menuItemId: "m1", qty: 1 }] });
  assert.match(order.statusHistory.at(-1).note, /after payment — paid ₹240, new total ₹90/);
});

await test("edit: adding more than stock allows is refused", async () => {
  const w = makeWorld({ orders: [pending()], stock: { bread: 2 } });
  await assert.rejects(edit(w, WAITER, { items: [{ menuItemId: "m2", qty: 5 }] }), (e) => e.statusCode === 409 && /Insufficient stock/.test(e.message));
});

// ── Pay-first ────────────────────────────────────────────────────────────────
await test("pay-first: once paid it waits for a waiter to accept it, like any customer order", async () => {
  const w = makeWorld({ orders: [pending({ status: "AWAITING_PAYMENT", paymentStatus: "PAID", autoPrepareAt: null })] });
  const r = await promotePaidOrder({ models: w.models, orderId: "o1" });
  assert.equal(r.promoted, true);
  assert.equal(w.state.orders[0].status, "PENDING_CONFIRMATION");
  assert.equal(w.state.orders[0].autoPrepareAt, null);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ALL TESTS PASSED");
