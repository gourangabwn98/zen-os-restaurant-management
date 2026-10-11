// test/splitPayment.test.js — "Both" (part cash, part online) payments, plus
// the "Others" food type. The server must refuse a split that doesn't add up
// to the bill total, store both parts when it does, and count each part under
// its own method in reports and on the printed bill. No DB — fakes.
//   node test/splitPayment.test.js
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const { parsePaymentSplit, paymentMethodLabel, COLLECT_METHODS, PAYMENT_METHODS, resolveCustomerPaymentMethod } = await import("../utils/paymentMode.js");
const { settleBills } = await import("../services/billingService.js");
const { updateOrderPayment } = await import("../controllers/adminController.js");
const { combinedPrintPayload, markSelectedPaid } = await import("../services/combinedBillService.js");
const { FOOD_TYPES } = await import("../utils/foodTypes.js");
const { default: mongoose } = await import("mongoose");
const { getModels } = await import("../config/getModels.js");

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.stack || err.message}`); }
};
const oid = (n) => String(n).padStart(24, "0");

// Tiny fake honouring the equality / $ne / $or filters these paths use.
const matchOne = (v, c) => (c && typeof c === "object"
  ? Object.entries(c).every(([op, x]) => (op === "$ne" ? String(v) !== String(x) : op === "$in" ? x.map(String).includes(String(v)) : op === "$exists" ? (x ? v !== undefined : v === undefined) : false))
  : String(v) === String(c));
const matches = (d, f) => Object.entries(f).every(([k, c]) => (k === "$or" ? c.some((x) => matches(d, x)) : matchOne(d[k], c)));
const world = (orders) => {
  const rows = orders.map((o) => ({ statusHistory: [], ...o }));
  const one = (row) => (row ? { ...row } : null);
  const Order = {
    rows,
    find: (f) => ({ lean: async () => rows.filter((o) => matches(o, f._id ? { _id: f._id } : f)).map(one) }),
    findById: (id) => {
      const row = () => rows.find((o) => String(o._id) === String(id));
      return Object.assign(Promise.resolve(one(row())), { select: () => ({ lean: async () => one(row()) }), lean: async () => one(row()) });
    },
    findOneAndUpdate: async (f, u) => {
      const row = rows.find((o) => matches(o, f));
      if (!row) return null;
      Object.assign(row, u.$set || {});
      if (u.$push?.statusHistory) row.statusHistory.push(u.$push.statusHistory);
      return one(row);
    },
  };
  return { Order, models: { Order, TableSession: { findOne: async () => null }, Table: {}, WaitlistEntry: {} } };
};
const ADMIN = { _id: "a1", role: "admin", name: "Owner" };
const callPatch = (models, id, body) => new Promise((resolve) => {
  let code = 200;
  updateOrderPayment({ models, params: { id }, body, user: ADMIN, tenantKey: "t" },
    { status(c) { code = c; return this; }, json: (b) => resolve({ code, body: b }) });
});

await test("parsePaymentSplit: must add up to the total exactly, both parts > 0", () => {
  assert.deepEqual(parsePaymentSplit({ cash: 300, online: 212.5 }, 512.5), { cash: 300, online: 212.5 });
  assert.deepEqual(parsePaymentSplit({ cash: "100.10", online: "0.2" }, 100.3), { cash: 100.1, online: 0.2 }, "paisa-exact, no float drift");
  const refuse = (s, total, re) => assert.throws(() => parsePaymentSplit(s, total), (e) => e.statusCode === 400 && re.test(e.message));
  refuse({ cash: 300, online: 200 }, 512.5, /bill total is ₹512.5/);
  refuse({ cash: 600, online: 0 }, 600, /more than ₹0/);
  refuse({ cash: -100, online: 700 }, 600, /more than ₹0/);
  refuse({ cash: "abc", online: 1 }, 1, /Enter both/);
  refuse(undefined, 100, /Enter both/);
});

await test("labels: Cash / Online unchanged, split shows both parts", () => {
  assert.equal(paymentMethodLabel({ paymentMethod: "Cash" }), "Cash");
  assert.equal(paymentMethodLabel({}), "Cash");
  assert.equal(paymentMethodLabel({ paymentMethod: "Online" }), "Online");
  assert.equal(paymentMethodLabel({ paymentMethod: "Both", paymentSplit: { cash: 300, online: 200 } }, ""), "Cash 300 + Online 200");
  assert.deepEqual(COLLECT_METHODS, ["Cash", "Online", "Both"]);
  assert.deepEqual(PAYMENT_METHODS, ["Cash", "Online"], "customers still choose only Cash / Online");
  assert.throws(() => resolveCustomerPaymentMethod({ requested: "Both", mode: "BOTH", phonePeEnabled: false }), /must be one of/);
});

await test("schema: Order accepts Both + paymentSplit; MenuItem accepts Others", () => {
  const conn = mongoose.createConnection();
  const { Order, MenuItem } = getModels(conn);
  assert.deepEqual(Order.schema.path("paymentMethod").enumValues, ["Cash", "Online", "Both"]);
  assert.ok(Order.schema.path("paymentSplit"), "paymentSplit stored on the order");
  assert.deepEqual(MenuItem.schema.path("tag").enumValues, FOOD_TYPES);
  assert.ok(FOOD_TYPES.includes("Others"));
  const bad = new MenuItem({ name: "x", price: 1, category: "c", tag: "Snacks" }).validateSync();
  assert.ok(bad?.errors?.tag, "an unknown food type is still refused");
  assert.equal(new MenuItem({ name: "Coke", price: 40, category: "Drinks", tag: "Others" }).validateSync()?.errors?.tag, undefined);
});

await test("settle with Both: records both parts, settles; wrong sum refused with nothing written", async () => {
  const { Order, models } = world([{ _id: oid(1), orderId: "ORD1", status: "CONFIRMED", paymentStatus: "PENDING_VERIFICATION", total: 512.5, billStatus: "OPEN" }]);
  await assert.rejects(settleBills({ models, orderIds: [oid(1)], paymentMethod: "Both", paymentSplit: { cash: 300, online: 200 }, actor: ADMIN, role: "admin" }),
    (e) => e.statusCode === 400 && /bill total/.test(e.message));
  assert.equal(Order.rows[0].paymentStatus, "PENDING_VERIFICATION", "nothing recorded");
  assert.equal(Order.rows[0].billStatus, "OPEN");

  const r = await settleBills({ models, orderIds: [oid(1)], paymentMethod: "Both", paymentSplit: { cash: 300, online: 212.5 }, actor: ADMIN, role: "admin" });
  assert.deepEqual(r.settled, ["ORD1"]);
  const o = Order.rows[0];
  assert.equal(o.paymentStatus, "PAID");
  assert.equal(o.paymentMethod, "Both");
  assert.deepEqual(o.paymentSplit, { cash: 300, online: 212.5 });
  assert.equal(o.billStatus, "SETTLED");
  assert.match(o.statusHistory.at(-1).note, /Cash ₹300 \+ Online ₹212.5/);
});

await test("settle with Cash after nothing: split stays empty; Both for many bills at once is refused", async () => {
  const { Order, models } = world([
    { _id: oid(1), orderId: "ORD1", status: "CONFIRMED", paymentStatus: "PENDING_VERIFICATION", total: 100, billStatus: "OPEN" },
    { _id: oid(2), orderId: "ORD2", status: "CONFIRMED", paymentStatus: "PENDING_VERIFICATION", total: 50, billStatus: "OPEN" },
  ]);
  await assert.rejects(settleBills({ models, orderIds: [oid(1), oid(2)], paymentMethod: "Both", paymentSplit: { cash: 100, online: 50 }, actor: ADMIN, role: "admin" }),
    /one bill at a time/);
  assert.ok(Order.rows.every((o) => o.paymentStatus !== "PAID"));
  await settleBills({ models, orderIds: [oid(1)], paymentMethod: "Cash", actor: ADMIN, role: "admin" });
  assert.equal(Order.rows[0].paymentMethod, "Cash");
  assert.equal(Order.rows[0].paymentSplit, null);
  await assert.rejects(markSelectedPaid({ models, body: { paymentMethod: "Both", tableNo: 4, orderIds: [oid(2)] }, canPay: true }), /one bill at a time/);
});

await test("PATCH payment with Both: validated against the order's own total; Cash/Online clears the split", async () => {
  const { Order, models } = world([{ _id: oid(3), orderId: "ORD3", status: "PREPARING", paymentStatus: "PENDING_VERIFICATION", total: 400, billStatus: "OPEN" }]);
  let r = await callPatch(models, oid(3), { paymentStatus: "PAID", paymentMethod: "Both", paymentSplit: { cash: 100, online: 100 } });
  assert.equal(r.code, 400);
  assert.equal(Order.rows[0].paymentStatus, "PENDING_VERIFICATION", "refused → nothing written");
  r = await callPatch(models, oid(3), { paymentStatus: "PAID", paymentMethod: "Both" });
  assert.equal(r.code, 400, "Both without amounts is refused");

  r = await callPatch(models, oid(3), { paymentStatus: "PAID", paymentMethod: "Both", paymentSplit: { cash: 150, online: 250 } });
  assert.equal(r.code, 200);
  assert.deepEqual(Order.rows[0].paymentSplit, { cash: 150, online: 250 });
  assert.equal(Order.rows[0].paymentMethod, "Both");

  r = await callPatch(models, oid(3), { paymentMethod: "Online" });
  assert.equal(r.code, 200);
  assert.equal(Order.rows[0].paymentSplit, null, "no stale split left behind");
  r = await callPatch(models, oid(3), { paymentMethod: "Card" });
  assert.equal(r.code, 400, "unknown methods still refused");
});

await test("PATCH payment with Both: total changed in between → 409, nothing written", async () => {
  const { Order, models } = world([{ _id: oid(4), orderId: "ORD4", status: "PREPARING", paymentStatus: "PENDING_VERIFICATION", total: 400, billStatus: "OPEN" }]);
  const realUpdate = Order.findOneAndUpdate;
  Order.findOneAndUpdate = async (f, u) => { Order.rows[0].total = 450; return realUpdate(f, u); }; // an item edit lands first
  const r = await callPatch(models, oid(4), { paymentStatus: "PAID", paymentMethod: "Both", paymentSplit: { cash: 200, online: 200 } });
  assert.equal(r.code, 409);
  assert.match(r.body.message, /total just changed/);
  assert.equal(Order.rows[0].paymentStatus, "PENDING_VERIFICATION");
});

await test("combined bill print: a split order counts as Cash + Online", () => {
  const p = combinedPrintPayload({
    tableNo: 4, restaurant: {},
    orders: [
      { orderId: "A", total: 100, paymentStatus: "PAID", paymentMethod: "Both", paymentSplit: { cash: 40, online: 60 }, items: [] },
      { orderId: "B", total: 50, paymentStatus: "PAID", paymentMethod: "Cash", items: [] },
    ],
  });
  assert.equal(p.paymentMethod, "Cash + Online");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ALL TESTS PASSED");
process.exit(0);
