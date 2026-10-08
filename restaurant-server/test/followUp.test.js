// test/followUp.test.js — KH-07 / KH-13 / KH-03: adding items to a running
// order after its KOT = a linked follow-up order; billed together.
// No DB — fakes.  node test/followUp.test.js
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const { placeOrderTx, resolveFollowUpParent } = await import("../services/orderService.js");
const {
  parseSelection, ineligibleReason, groupRootId, resolveSelection, orderGroup, markSelectedPaid, combinedPrintPayload,
} = await import("../services/combinedBillService.js");

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.stack || err.message}`); }
};

const ID = (n) => `aaaaaaaaaaaaaaaaaaaaaa${String(n).padStart(2, "0")}`;
const WAITER = { _id: "w1", role: "waiter", name: "Rahul" };
const MENU = [{ _id: "m1", name: "Chicken Biryani", price: 100, isAvailable: true }];

// Minimal in-memory Order model: findById, find ($or / $in / $nin), findOneAndUpdate, create.
const makeOrders = (seed = []) => {
  const rows = seed.map((o) => ({ ...o }));
  const match = (o, q) => Object.entries(q).every(([k, v]) => {
    if (k === "$or") return v.some((sub) => match(o, sub));
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
      if ("$in" in v) return v.$in.map(String).includes(String(o[k]));
      if ("$nin" in v) return !v.$nin.map(String).includes(String(o[k]));
      if ("$ne" in v) return String(o[k]) !== String(v.$ne);
    }
    return String(o[k] ?? "") === String(v ?? "");
  });
  const chain = (list) => {
    const c = { sort: () => c, populate: () => c, select: () => c, lean: async () => list.map((o) => ({ ...o })), then: (r, j) => Promise.resolve(list).then(r, j) };
    return c;
  };
  return {
    rows,
    findById: (id) => {
      const found = rows.find((o) => String(o._id) === String(id)) || null;
      const p = Promise.resolve(found);
      p.select = () => ({ lean: async () => (found ? { ...found } : null) });
      p.lean = async () => (found ? { ...found } : null);
      return p;
    },
    find: (q) => chain(rows.filter((o) => match(o, q))),
    findOne: async () => null,
    findOneAndUpdate: async (q, u) => {
      const o = rows.find((r) => match(r, q));
      if (!o) return null;
      Object.assign(o, u.$set || {});
      return { ...o };
    },
    create: async (payload) => { const o = { _id: ID(rows.length + 50), orderId: `ORD000${rows.length + 50}`, ...payload, createdAt: new Date() }; rows.push(o); return o; },
  };
};

const reqWith = (Order, user = WAITER) => ({
  db: {}, user,
  models: {
    Order,
    MenuItem: { findById: async (id) => MENU.find((m) => m._id === id) || null },
    RestaurantProfile: { findOne: async () => ({ gstRate: 0, serviceCharge: 0, editWindowMinutes: 3 }) },
    Category: { find: () => ({ select: () => ({ lean: async () => [] }) }) },
    Recipe: { find: async () => [] }, InventoryItem: {}, KOTJob: {},
    Table: { findOne: async ({ tableNo }) => ({ _id: `t${tableNo}`, tableNo, status: "Active" }), updateOne: async () => ({}) },
    TableSession: { findOne: async () => ({ _id: "ts1" }), findByIdAndUpdate: async () => ({}), updateOne: async () => ({}) },
  },
});

const root = (over = {}) => ({
  _id: ID(1), orderId: "ORD00142", orderType: "TAKEAWAY", tableNo: null, diningArea: "",
  status: "PREPARING", billStatus: "OPEN", paymentStatus: "PENDING_VERIFICATION", guestName: "Priya", guestPhone: "9800000000",
  items: [{ name: "Chicken Biryani", qty: 1, price: 100 }], subtotal: 100, tax: 0, serviceCharge: 0, discount: 0, total: 100,
  createdAt: new Date(Date.now() - 600000), ...over,
});

await test("takeaway follow-up: new order linked to the original, inherits type/customer, new KOT path (CONFIRMED)", async () => {
  const Order = makeOrders([root()]);
  const { order } = await placeOrderTx({ req: reqWith(Order), body: { parentOrder: ID(1), items: [{ menuItemId: "m1", qty: 2 }] } });
  assert.equal(String(order.parentOrder), ID(1));
  assert.equal(order.parentOrderNo, "ORD00142");
  assert.equal(order.orderType, "TAKEAWAY");
  assert.equal(order.guestName, "Priya");
  assert.equal(order.status, "CONFIRMED", "own edit window → own sendToKitchenTx → own KOT + stock");
  assert.notEqual(String(order._id), ID(1), "a separate order — the original is untouched");
  assert.equal(Order.rows[0].items.length, 1);
});

await test("table follow-up: table / AC Room come from the original, never from the client", async () => {
  const Order = makeOrders([root({ orderType: "DINE_IN", tableNo: 12, diningArea: "AC_ROOM" })]);
  const { order } = await placeOrderTx({ req: reqWith(Order), body: {
    parentOrder: ID(1), items: [{ menuItemId: "m1", qty: 1 }], orderType: "TAKEAWAY", tableNo: 99, diningArea: "GARDEN", customerName: "Someone else",
  } });
  assert.equal(order.orderType, "DINE_IN");
  assert.equal(order.tableNo, 12);
  assert.equal(order.diningArea, "AC_ROOM");
  assert.equal(order.guestName, "Priya");
});

await test("a follow-up of a follow-up links to the ROOT (one group, no chains)", async () => {
  const Order = makeOrders([root(), { ...root({ _id: ID(2), orderId: "ORD00143" }), parentOrder: ID(1) }]);
  const r = await resolveFollowUpParent({ Order, parentId: ID(2), user: WAITER });
  assert.equal(String(r.rootId), ID(1));
  assert.equal(r.rootOrderNo, "ORD00142");
});

await test("refused: customers, cancelled / completed / settled originals, bad ids", async () => {
  const Order = makeOrders([
    root(), root({ _id: ID(3), status: "CANCELLED" }), root({ _id: ID(4), status: "COMPLETED", billStatus: "SETTLED" }),
    root({ _id: ID(5), status: "DELIVERED", billStatus: "SETTLED" }),
  ]);
  await assert.rejects(resolveFollowUpParent({ Order, parentId: ID(1), user: null }), (e) => e.statusCode === 403);
  await assert.rejects(resolveFollowUpParent({ Order, parentId: ID(3), user: WAITER }), (e) => e.statusCode === 409);
  await assert.rejects(resolveFollowUpParent({ Order, parentId: ID(4), user: WAITER }), (e) => e.statusCode === 409);
  await assert.rejects(resolveFollowUpParent({ Order, parentId: ID(5), user: WAITER }), (e) => e.statusCode === 409);
  await assert.rejects(resolveFollowUpParent({ Order, parentId: "nope", user: WAITER }), (e) => e.statusCode === 400);
  await assert.rejects(resolveFollowUpParent({ Order, parentId: ID(9), user: WAITER }), (e) => e.statusCode === 404);
});

await test("a normal order (no parentOrder) is unchanged: no link", async () => {
  const Order = makeOrders([]);
  const { order } = await placeOrderTx({ req: reqWith(Order), body: { items: [{ menuItemId: "m1", qty: 1 }], orderType: "TAKEAWAY" } });
  assert.equal(order.parentOrder, null);
  assert.equal(order.parentOrderNo, "");
});

// ── group billing ──
const group = () => makeOrders([
  root(),
  { ...root({ _id: ID(2), orderId: "ORD00143", items: [{ name: "Raita", qty: 2, price: 30 }], subtotal: 60, total: 60, createdAt: new Date() }), parentOrder: ID(1) },
  root({ _id: ID(6), orderId: "ORD00150", guestName: "Other customer" }), // unrelated takeaway
  { ...root({ _id: ID(7), status: "CANCELLED" }), parentOrder: ID(1) },   // cancelled follow-up
]);

await test("parseSelection: group mode by groupOf; table mode shape unchanged", () => {
  assert.deepEqual(parseSelection({ groupOf: ID(1), orderIds: [ID(1), ID(2)] }), { tableNo: null, groupOf: ID(1), ids: [ID(1), ID(2)] });
  assert.deepEqual(parseSelection({ tableNo: 5, orderIds: [ID(1)] }), { tableNo: 5, ids: [ID(1)] });
  assert.throws(() => parseSelection({ groupOf: "x", orderIds: [ID(1)] }), /Invalid/);
});

await test("ineligibleReason: group membership by root; table mode untouched", () => {
  assert.equal(groupRootId({ _id: ID(2), parentOrder: ID(1) }), ID(1));
  assert.equal(ineligibleReason({ _id: ID(2), parentOrder: ID(1), status: "PREPARING" }, { rootId: ID(1) }), null);
  assert.equal(ineligibleReason({ _id: ID(6), status: "PREPARING" }, { rootId: ID(1) }), "Not part of this order");
  assert.equal(ineligibleReason({ orderType: "DINE_IN", tableNo: 5, status: "READY" }, 5), null);
});

await test("orderGroup: original + live follow-ups, oldest first; cancelled one left out", async () => {
  const { rootId, orders } = await orderGroup({ models: { Order: group() }, id: ID(2) });
  assert.equal(rootId, ID(1));
  assert.deepEqual(orders.map((o) => o.orderId), ["ORD00142", "ORD00143"]);
});

await test("group bill: every item from both orders once, one grand total, takeaway type", async () => {
  const Order = group();
  const { orders, rejected } = await resolveSelection({ models: { Order }, body: { groupOf: ID(2), orderIds: [ID(1), ID(2), ID(6)] } });
  assert.deepEqual(orders.map((o) => o.orderId), ["ORD00142", "ORD00143"]);
  assert.deepEqual(rejected.map((r) => r.reason), ["Not part of this order"], "an unrelated order can't sneak in");
  const p = combinedPrintPayload({ tableNo: null, orders });
  assert.equal(p.orderType, "TAKEAWAY");
  assert.equal(p.total, 160);
  assert.deepEqual(p.items.map((i) => `${i.name}x${i.qty}`), ["Chicken Biryanix1", "Raitax2"], "no item lost or duplicated");
});

await test("group pay: marks each order of the group PAID once; outsider untouched; retry is a no-op", async () => {
  const Order = group();
  const body = { groupOf: ID(1), orderIds: [ID(1), ID(2)], paymentMethod: "Cash" };
  const r1 = await markSelectedPaid({ models: { Order }, body, canPay: true });
  assert.deepEqual(r1.paid, ["ORD00142", "ORD00143"]);
  assert.equal(Order.rows.find((o) => o._id === ID(6)).paymentStatus, "PENDING_VERIFICATION");
  const r2 = await markSelectedPaid({ models: { Order }, body, canPay: true });
  assert.deepEqual(r2.paid, []);
  assert.deepEqual(r2.alreadyPaid, ["ORD00142", "ORD00143"]);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ALL TESTS PASSED");
