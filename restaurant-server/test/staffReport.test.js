// test/staffReport.test.js — Staff performance & payment collections.
// Every activity is credited to the person who actually did it, read from the
// order's own server-written actor fields; money to whoever RECORDED the Paid.
// Drives the real write paths (PATCH payment, settle, combined-bill pay,
// PhonePe apply, "Served", admin "Complete") against an in-memory fake, then
// reads them back through the report. No DB.
//   node test/staffReport.test.js
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const {
  buildStaffReport, getStaffReport, getMyStaffStats, collectionParts, collectorOf, assertReportRange, ROW_KINDS,
} = await import("../services/staffReportService.js");
const { settleBills } = await import("../services/billingService.js");
const { updateOrderPayment } = await import("../controllers/adminController.js");
const { getStaffReportCtl, getMyActivity } = await import("../controllers/employeeController.js");
const { markSelectedPaid } = await import("../services/combinedBillService.js");
const { applyPhonePeResult } = await import("../services/paymentService.js");
const { transitionOrderStatusTx, buildActor } = await import("../services/orderService.js");
const { requireManagement, requireEmployee } = await import("../middleware/rbac.js");
const { default: mongoose } = await import("mongoose");
const { getModels } = await import("../config/getModels.js");

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.stack || err.message}`); }
};
const oid = (n) => String(n).padStart(24, "0");

// ── Fake Mongo: the filter operators these paths use, dotted paths included ──
const get = (d, path) => path.split(".").reduce((v, k) => (v == null ? undefined : v[k]), d);
const eq = (a, b) => (a instanceof Date || b instanceof Date ? +new Date(a) === +new Date(b) : String(a) === String(b));
const matchOne = (v, c) => {
  if (c === null) return v === null || v === undefined;
  if (c instanceof Date || typeof c !== "object") return v !== undefined && v !== null && eq(v, c);
  return Object.entries(c).every(([op, x]) => {
    switch (op) {
      case "$eq": return v != null && eq(v, x);
      case "$ne": return x === null ? v != null : !(v != null && eq(v, x));
      case "$in": return x.some((y) => v != null && eq(v, y));
      case "$nin": return !x.some((y) => v != null && eq(v, y));
      case "$exists": return x ? v !== undefined : v === undefined;
      case "$gte": return v != null && +new Date(v) >= +new Date(x);
      case "$lte": return v != null && +new Date(v) <= +new Date(x);
      default: throw new Error(`fake: unsupported operator ${op}`);
    }
  });
};
const matches = (d, f) => Object.entries(f).every(([k, c]) => (k === "$or" ? c.some((x) => matches(d, x)) : matchOne(get(d, k), c)));
const copy = (row) => (row ? structuredClone(row) : null);
const chain = (fn) => {
  const p = Promise.resolve().then(fn);
  return Object.assign(p, { select: () => chain(fn), lean: () => p, sort: () => chain(fn), limit: () => chain(fn), populate: () => chain(fn) });
};
const makeModel = (seed) => {
  const rows = seed.map((o) => ({ statusHistory: [], ...o }));
  return {
    rows,
    find: (f = {}) => chain(() => rows.filter((o) => matches(o, f)).map(copy)),
    findOne: (f = {}) => chain(() => copy(rows.find((o) => matches(o, f)))),
    findById: (id) => chain(() => copy(rows.find((o) => eq(o._id, id)))),
    findOneAndUpdate: async (f, u) => {
      const row = rows.find((o) => matches(o, f));
      if (!row) return null;
      for (const [path, v] of Object.entries(structuredClone(u.$set || {}))) { // dotted paths too
        const keys = path.split(".");
        const leaf = keys.pop();
        keys.reduce((o, k) => (o[k] ??= {}), row)[leaf] = v;
      }
      if (u.$push?.statusHistory) row.statusHistory.push(u.$push.statusHistory);
      return copy(row);
    },
    aggregate: async () => [],
    countDocuments: async (f) => rows.filter((o) => matches(o, f)).length,
  };
};
const world = (orders, users = STAFF) => {
  const Order = makeModel(orders);
  const User = makeModel(users);
  const models = {
    Order, User,
    RestaurantProfile: { findOne: () => chain(() => ({ timezone: "Asia/Kolkata" })) },
    AttendanceSession: { find: () => chain(() => []) },
    TableSession: { findOne: async () => null }, Table: {}, WaitlistEntry: {},
  };
  return { Order, User, models };
};

// ── People ──
const OWNER = { _id: oid("a1"), name: "Owner", role: "admin", isAdmin: true, status: "Active" };
const MANAGER = { _id: oid("b1"), name: "Mona Manager", role: "manager", status: "Active" };
const X = { _id: oid("c1"), name: "Waiter X", role: "waiter", status: "Active" };
const Y = { _id: oid("c2"), name: "Waiter Y", role: "waiter", status: "Active" };
const Z = { _id: oid("c3"), name: "Waiter Z", role: "waiter", status: "Active" };
const CHEF = { _id: oid("d1"), name: "Chef C", role: "chef", status: "Active" };
const STAFF = [OWNER, MANAGER, X, Y, Z, CHEF];
const actor = (u) => buildActor(u);

// The day under test (restaurant timezone Asia/Kolkata): 2026-10-12.
const DAY = "2026-10-12";
const at = (hhmm, day = DAY) => new Date(`${day}T${hhmm}:00+05:30`);
const RANGE = { start: at("00:00"), end: new Date(+at("00:00", "2026-10-13") - 1) };

const order = (n, extra = {}) => ({
  _id: oid(n), orderId: `ORD${n}`, total: 1000, status: "DELIVERED", paymentStatus: "PENDING_VERIFICATION",
  paymentMethod: "Cash", paymentSplit: null, billStatus: "OPEN", orderType: "DINE_IN", tableNo: 1,
  createdAt: at("12:00"), payment: { provider: "NONE", state: "CREATED" },
  confirmedBy: actor(X), confirmedAt: at("12:00"),
  ...extra,
});

const call = (handler, req) => new Promise((resolve) => {
  let code = 200;
  handler({ tenantKey: "t", params: {}, query: {}, body: {}, ...req },
    { status(c) { code = c; return this; }, json: (b) => resolve({ code, body: b }) });
});
const patchPayment = (models, user, id, body) => call(updateOrderPayment, { models, user, params: { id }, body });
const rowOf = (report, user) => report.rows.find((r) => r.employeeId === String(user._id));

console.log("── Staff performance & collections ─────────────────────────");

await test("schema: Order carries paidBy / paidAt (null by default) and indexes the activity times", () => {
  const { Order } = getModels(mongoose.createConnection());
  assert.ok(Order.schema.path("paidBy"), "paidBy");
  assert.ok(Order.schema.path("paidAt"), "paidAt");
  const doc = new Order({ subtotal: 1, tax: 0, total: 1 });
  assert.equal(doc.paidBy, null);
  assert.equal(doc.paidAt, null);
  const keys = Order.schema.indexes().map(([k]) => Object.keys(k).join(","));
  for (const f of ["confirmedAt", "deliveredAt", "completedAt", "paidAt"]) assert.ok(keys.includes(f), `index on ${f}`);
});

await test("1. orders taken: credited to who placed/accepted it (confirmedBy), not who served or collected", async () => {
  const { models } = world([
    order(1, { confirmedBy: actor(X), deliveredBy: actor(Y), deliveredAt: at("12:30") }),
    order(2, { confirmedBy: actor(X) }),
    order(3, { confirmedBy: actor(Y) }), // a customer order Y accepted
  ]);
  const r = await getStaffReport({ models, ...RANGE });
  assert.equal(rowOf(r, X).taken, 2);
  assert.equal(rowOf(r, Y).taken, 1);
  assert.equal(rowOf(r, Y).served, 1, "Y served X's order");
  assert.equal(rowOf(r, X).served, 0, "serving does not move to the taker");
  assert.equal(r.summary.taken, 3);
});

await test("2. served: the authenticated user who taps Served, via the real transition", async () => {
  const { Order, models } = world([order(1, { status: "READY", confirmedBy: actor(X) })]);
  // A client trying to name someone else is ignored — identity comes from req.user.
  await transitionOrderStatusTx({ req: { models, user: Y, body: { deliveredBy: { id: X._id } } }, orderId: oid(1), toStatus: "DELIVERED" });
  const row = Order.rows[0];
  assert.equal(String(row.deliveredBy.id), Y._id);
  row.deliveredAt = at("13:00"); // pin the time into the day under test
  const r = await getStaffReport({ models, ...RANGE });
  assert.equal(rowOf(r, Y).served, 1);
  assert.equal(rowOf(r, X).served, 0);
  assert.equal(rowOf(r, X).taken, 1, "taking stays with X");
});

await test("3. completed: whoever's action completes it (settle by Z / admin Complete), never assumed from the taker", async () => {
  const { Order, models } = world([
    order(1, { confirmedBy: actor(X), deliveredBy: actor(Y), deliveredAt: at("12:30") }),
    order(2, { status: "READY", confirmedBy: actor(X), paymentStatus: "PAID", paidBy: actor(Z), paidAt: at("12:40") }),
  ]);
  const s = await settleBills({ models, orderIds: [oid(1)], paymentMethod: "Cash", actor: actor(Z), role: "waiter", now: at("13:00") });
  assert.deepEqual(s.settled, ["ORD1"]);
  assert.equal(Order.rows[0].status, "COMPLETED");
  await transitionOrderStatusTx({ req: { models, user: MANAGER }, orderId: oid(2), toStatus: "COMPLETED" });
  Order.rows[1].completedAt = at("13:10"); Order.rows[1].deliveredAt = at("13:10");
  const r = await getStaffReport({ models, ...RANGE });
  assert.equal(rowOf(r, Z).completed, 1);
  assert.equal(rowOf(r, MANAGER).completed, 1);
  assert.equal(rowOf(r, X).completed, 0, "X only took them");
  assert.equal(rowOf(r, MANAGER).role, "manager", "a manager is shown as manager, not admin");
});

await test("4. the spec's example: X takes, Y serves, Z records ₹1,000 Paid → Z is credited", async () => {
  const { Order, models } = world([order(1001, { confirmedBy: actor(X), deliveredBy: actor(Y), deliveredAt: at("12:30") })]);
  const res = await patchPayment(models, Z, oid(1001), { paymentStatus: "PAID", paymentMethod: "Cash", paidBy: { id: X._id } });
  assert.equal(res.code, 200);
  assert.equal(String(Order.rows[0].paidBy.id), Z._id, "client-sent paidBy ignored");
  Order.rows[0].paidAt = at("13:00");
  const r = await getStaffReport({ models, ...RANGE });
  assert.deepEqual([rowOf(r, X).collected, rowOf(r, Y).collected, rowOf(r, Z).collected], [0, 0, 1000]);
  assert.deepEqual([rowOf(r, X).taken, rowOf(r, Y).served], [1, 1]);
  assert.equal(r.payments.length, 1);
  assert.deepEqual(
    { orderId: r.payments[0].orderId, name: r.payments[0].collector.name, role: r.payments[0].collector.role, method: r.payments[0].method, amount: r.payments[0].amount },
    { orderId: "ORD1001", name: "Waiter Z", role: "waiter", method: "Cash", amount: 1000 },
  );
  assert.equal(r.payments[0].guestPhone, undefined, "no customer PII in the payment list");
});

await test("4b. admin / manager recording a payment are credited and shown with their own role", async () => {
  const { Order, models } = world([order(1), order(2)]);
  await patchPayment(models, OWNER, oid(1), { paymentStatus: "PAID", paymentMethod: "Online" });
  await patchPayment(models, MANAGER, oid(2), { paymentStatus: "PAID", paymentMethod: "Cash" });
  for (const row of Order.rows) row.paidAt = at("14:00");
  const r = await getStaffReport({ models, ...RANGE });
  assert.deepEqual([rowOf(r, OWNER).online, rowOf(r, OWNER).role], [1000, "admin"]);
  assert.deepEqual([rowOf(r, MANAGER).cash, rowOf(r, MANAGER).role], [1000, "manager"]);
});

await test("5. cash and online are summed separately; total = cash + online", async () => {
  const { Order, models } = world([order(1, { total: 300 }), order(2, { total: 450.5 }), order(3, { total: 200 })]);
  await patchPayment(models, Z, oid(1), { paymentStatus: "PAID", paymentMethod: "Cash" });
  await patchPayment(models, Z, oid(2), { paymentStatus: "PAID", paymentMethod: "Online" });
  const combined = await markSelectedPaid({ models, body: { tableNo: 1, orderIds: [oid(3)], paymentMethod: "Cash" }, canPay: true, actor: actor(Z) });
  assert.deepEqual(combined.paid, ["ORD3"]);
  for (const row of Order.rows) row.paidAt = at("15:00");
  const r = await getStaffReport({ models, ...RANGE });
  assert.deepEqual([rowOf(r, Z).cash, rowOf(r, Z).online, rowOf(r, Z).collected], [500, 450.5, 950.5]);
  assert.deepEqual([r.summary.cash, r.summary.online, r.summary.collected], [500, 450.5, 950.5]);
});

await test("5b. combined-bill 'Mark paid' credits the person who pressed it", async () => {
  const { Order, models } = world([order(1, { status: "DELIVERED" })]);
  const out = await markSelectedPaid({ models, body: { tableNo: 1, orderIds: [oid(1)], paymentMethod: "Online" }, canPay: true, actor: actor(Y) });
  assert.deepEqual(out.paid, ["ORD1"]);
  assert.equal(String(Order.rows[0].paidBy.id), Y._id);
  assert.ok(Order.rows[0].paidAt instanceof Date);
});

await test("6. split payment: ₹500 cash + ₹500 online → ₹500 Cash, ₹500 Online, ₹1,000 total for the recorder", async () => {
  const { Order, models } = world([order(1)]);
  const s = await settleBills({ models, orderIds: [oid(1)], paymentMethod: "Both", paymentSplit: { cash: 500, online: 500 }, actor: actor(Y), role: "waiter", now: at("16:00") });
  assert.deepEqual(s.settled, ["ORD1"]);
  assert.equal(String(Order.rows[0].paidBy.id), Y._id);
  const r = await getStaffReport({ models, ...RANGE });
  assert.deepEqual([rowOf(r, Y).cash, rowOf(r, Y).online, rowOf(r, Y).collected], [500, 500, 1000]);
  assert.deepEqual([r.payments[0].method, r.payments[0].cash, r.payments[0].online, r.payments[0].amount], ["Both", 500, 500, 1000]);
  assert.deepEqual(collectionParts({ paymentMethod: "Both", paymentSplit: { cash: 300.1, online: 0.2 }, total: 300.3 }), { cash: 300.1, online: 0.2 });
});

await test("7. pending, failed, cancelled and merely-served/completed-unpaid orders add no collection", async () => {
  const { Order, models } = world([
    order(1), // created + served, never paid
    order(2, { paymentStatus: "FAILED" }),
    order(3, { paymentStatus: "PAID", status: "CANCELLED", paidBy: actor(Z), paidAt: at("12:30") }),
    order(4, { payment: { provider: "PHONEPE", state: "PENDING", merchantTransactionId: "M4" } }),
  ]);
  // A failed gateway attempt leaves the order unpaid and credits nobody.
  await applyPhonePeResult({ models, orderId: oid(4), merchantTransactionId: "M4", result: { state: "FAILED", code: "PAYMENT_ERROR" } });
  assert.equal(Order.rows[3].paymentStatus, "PENDING_VERIFICATION");
  assert.equal(Order.rows[3].paidAt ?? null, null);
  // A Paid on a cancelled order is refused, as before, and credits nobody.
  const refused = await patchPayment(models, X, oid(3), { paymentStatus: "PAID" });
  assert.equal(refused.code, 409);
  assert.equal(String(Order.rows[2].paidBy.id), Z._id);
  const r = await getStaffReport({ models, ...RANGE });
  assert.equal(r.summary.collected, 0);
  assert.equal(r.summary.payments, 0);
  assert.equal(r.payments.length, 0);
});

await test("8. duplicate / retried / second-person Paid requests never double-count or re-credit", async () => {
  const { Order, models } = world([order(1)]);
  await patchPayment(models, Z, oid(1), { paymentStatus: "PAID", paymentMethod: "Cash" });
  const first = structuredClone(Order.rows[0].paidAt);
  await patchPayment(models, Z, oid(1), { paymentStatus: "PAID", paymentMethod: "Cash" }); // retry
  await patchPayment(models, X, oid(1), { paymentStatus: "PAID", paymentMethod: "Cash" }); // someone else taps it too
  await settleBills({ models, orderIds: [oid(1)], paymentMethod: "Online", actor: actor(Y), role: "waiter" }); // settle an already-paid bill
  assert.equal(String(Order.rows[0].paidBy.id), Z._id, "still Z");
  assert.equal(+Order.rows[0].paidAt, +first, "paid time unchanged");
  assert.equal(Order.rows[0].paymentMethod, "Cash", "settling a paid bill does not relabel it");
  Order.rows[0].paidAt = at("13:00");
  const r = await getStaffReport({ models, ...RANGE });
  assert.equal(r.summary.collected, 1000);
  assert.equal(r.payments.length, 1);
  assert.deepEqual([rowOf(r, X).collected, rowOf(r, Y).collected], [0, 0]);
  // PhonePe callback + poll racing: one success applied once.
  const g = world([order(2, { payment: { provider: "PHONEPE", state: "PENDING", merchantTransactionId: "M2" } })]);
  const ok = { state: "SUCCESS", code: "PAYMENT_SUCCESS", phonepeTransactionId: "T2" };
  const a = await applyPhonePeResult({ models: g.models, orderId: oid(2), merchantTransactionId: "M2", result: ok });
  const b = await applyPhonePeResult({ models: g.models, orderId: oid(2), merchantTransactionId: "M2", result: ok });
  assert.deepEqual([a.changed, b.changed], [true, false]);
  g.Order.rows[0].paidAt = at("13:30");
  const gr = await getStaffReport({ models: g.models, ...RANGE });
  const gw = gr.rows.find((x) => x.kind === ROW_KINDS.GATEWAY);
  assert.deepEqual([gw.online, gw.payments, gr.summary.collected], [1000, 1, 1000], "credited to the gateway, not an employee");
});

await test("8b. an admin undoing a Paid takes the collection back off; re-marking credits the new recorder", async () => {
  const { Order, models } = world([order(1)]);
  await patchPayment(models, X, oid(1), { paymentStatus: "PAID", paymentMethod: "Cash" });
  const undo = await patchPayment(models, OWNER, oid(1), { paymentStatus: "PENDING_VERIFICATION" });
  assert.equal(undo.code, 200);
  assert.equal(Order.rows[0].paidBy, null);
  assert.equal(Order.rows[0].paidAt, null);
  let r = await getStaffReport({ models, ...RANGE });
  assert.equal(r.summary.collected, 0);
  await patchPayment(models, Y, oid(1), { paymentStatus: "PAID", paymentMethod: "Online" });
  Order.rows[0].paidAt = at("15:00");
  r = await getStaffReport({ models, ...RANGE });
  assert.deepEqual([rowOf(r, X).collected, rowOf(r, Y).online], [0, 1000]);
});

await test("9. admin and manager may open the staff report; it lists every collector", async () => {
  for (const user of [OWNER, MANAGER]) {
    let allowed = false;
    requireManagement({ user }, { status: () => ({ json: () => {} }) }, () => { allowed = true; });
    assert.ok(allowed, `${user.role} allowed`);
  }
  const { models } = world([order(1, { paymentStatus: "PAID", paidBy: actor(Z), paidAt: at("12:00") })]);
  const res = await call(getStaffReportCtl, { models, user: MANAGER, query: { from: DAY, to: DAY } });
  assert.equal(res.code, 200);
  assert.equal(rowOf(res.body, Z).collected, 1000);
  assert.ok(rowOf(res.body, X), "active waiters with no activity are listed at ₹0");
  assert.equal(rowOf(res.body, X).collected, 0);
});

await test("10. waiters: refused the staff report; own stats only, query params can't switch identity", async () => {
  let code = 0;
  requireManagement({ user: X }, { status: (c) => { code = c; return { json: () => {} }; } }, () => { code = 200; });
  assert.equal(code, 403, "a waiter cannot open the staff report");
  let ok = false;
  requireEmployee({ user: X }, {}, () => { ok = true; });
  assert.ok(ok);
  const { models } = world([
    order(1, { confirmedBy: actor(X), paymentStatus: "PAID", paidBy: actor(Z), paidAt: at("12:00") }),
    order(2, { confirmedBy: actor(Z), deliveredBy: actor(X), deliveredAt: at("12:10"), paymentStatus: "PAID", paymentMethod: "Online", paidBy: actor(X), paidAt: at("12:20") }),
  ]);
  const res = await call(getMyActivity, { models, user: X, query: { from: DAY, to: DAY, employeeId: Z._id } });
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.performance, { taken: 1, served: 1, completed: 0, collected: 1000, cash: 0, online: 1000, payments: 1 },
    "X: took order 1, served + collected order 2 (online) — order 1's money is Z's");
  const z = await getMyStaffStats({ models, employeeId: Z._id, ...RANGE });
  assert.deepEqual([z.taken, z.cash, z.online], [1, 1000, 0]);
});

await test("11. date filters: each activity is placed on the day it happened, consistently", async () => {
  const D1 = "2026-10-11";
  const { models } = world([
    // Taken on the 11th, served + paid (by Z) on the 12th.
    order(1, { confirmedAt: at("23:50", D1), createdAt: at("23:50", D1), deliveredBy: actor(Y), deliveredAt: at("00:20"), paymentStatus: "PAID", paidBy: actor(Z), paidAt: at("00:30") }),
    // 23:59 IST on the 12th — still the 12th in the restaurant's timezone.
    order(2, { confirmedAt: at("23:59"), paymentStatus: "PAID", paidBy: actor(Z), paidAt: at("23:59") }),
  ]);
  const day11 = await getStaffReport({ models, start: at("00:00", D1), end: new Date(+at("00:00") - 1) });
  const day12 = await getStaffReport({ models, ...RANGE });
  const both = await getStaffReport({ models, start: at("00:00", D1), end: RANGE.end });
  assert.deepEqual([day11.summary.taken, day11.summary.served, day11.summary.collected], [1, 0, 0]);
  assert.deepEqual([day12.summary.taken, day12.summary.served, day12.summary.collected], [1, 1, 2000]);
  for (const k of ["taken", "served", "completed", "collected", "cash", "online"]) {
    assert.equal(both.summary[k], day11.summary[k] + day12.summary[k], `${k}: two single days add up to the range`);
  }
  // The HTTP layer turns ?from=&to= into restaurant-day bounds the same way.
  const res = await call(getStaffReportCtl, { models, user: OWNER, query: { from: DAY, to: DAY } });
  assert.deepEqual(res.body.summary, day12.summary);
  assert.throws(() => assertReportRange({ start: RANGE.end, end: RANGE.start }), /on or before/);
  const back = await call(getStaffReportCtl, { models, user: OWNER, query: { from: DAY, to: "2026-10-01" } });
  assert.equal(back.code, 400);
});

await test("12. historical orders with no recorded collector stay Unattributed — never given to the taker", async () => {
  const { models } = world([
    // Paid before paidBy/paidAt existed: no paidBy, no paidAt — placed by createdAt.
    order(1, { confirmedBy: actor(X), paymentStatus: "PAID", paymentMethod: "Cash", billSettledBy: actor(X) }),
    // Old order with no actor at all on its stages.
    order(2, { confirmedBy: { id: null, role: null, name: "System" }, deliveredBy: null, deliveredAt: at("12:30") }),
  ]);
  const r = await getStaffReport({ models, ...RANGE });
  assert.equal(rowOf(r, X).collected, 0, "not credited to who took it");
  const un = r.rows.find((x) => x.kind === ROW_KINDS.UNATTRIBUTED);
  assert.deepEqual([un.collected, un.taken, un.served], [1000, 1, 1]);
  assert.equal(r.payments[0].legacy, true);
  assert.equal(r.payments[0].collector.kind, ROW_KINDS.UNATTRIBUTED);
  assert.equal(collectorOf({ paymentStatus: "PAID", paidBy: { id: oid("e1"), role: "CUSTOMER" } }).kind, ROW_KINDS.UNATTRIBUTED, "a customer is never an employee");
  // A waiter's own figures never pick up unattributed money.
  const mine = await getMyStaffStats({ models, employeeId: X._id, ...RANGE });
  assert.equal(mine.collected, 0);
  // Rows + unattributed always add up to the summary.
  const sum = (k) => r.rows.reduce((s, x) => s + x[k], 0);
  for (const k of ["taken", "served", "completed", "collected"]) assert.equal(sum(k), r.summary[k], k);
});

await test("13. existing behaviour unchanged: payment status/method/split, refusals and the waiter's role limits", async () => {
  const { Order, models } = world([order(1, { status: "CANCELLED" }), order(2, { total: 512.5 })]);
  const cancelled = await patchPayment(models, Z, oid(1), { paymentStatus: "PAID" });
  assert.equal(cancelled.code, 409);
  assert.equal(Order.rows[0].paymentStatus, "PENDING_VERIFICATION");
  assert.equal(Order.rows[0].paidBy ?? null, null, "a refused Paid credits nobody");
  const notAllowed = await patchPayment(models, Z, oid(2), { paymentStatus: "PENDING_VERIFICATION" });
  assert.equal(notAllowed.code, 403, "waiters still can't undo a Paid");
  const badSplit = await patchPayment(models, Z, oid(2), { paymentStatus: "PAID", paymentMethod: "Both", paymentSplit: { cash: 100, online: 100 } });
  assert.equal(badSplit.code, 400);
  assert.equal(Order.rows[1].paymentStatus, "PENDING_VERIFICATION");
  const good = await patchPayment(models, Z, oid(2), { paymentStatus: "PAID", paymentMethod: "Both", paymentSplit: { cash: 300, online: 212.5 } });
  assert.equal(good.code, 200);
  assert.deepEqual([Order.rows[1].paymentStatus, Order.rows[1].paymentMethod, Order.rows[1].paymentSplit], ["PAID", "Both", { cash: 300, online: 212.5 }]);
  assert.equal(good.body.order.paymentStatus, "PAID");
  // buildStaffReport is pure: no input → empty, zero summary.
  const empty = buildStaffReport({ users: [], listAll: false });
  assert.deepEqual(empty.summary, { taken: 0, served: 0, completed: 0, collected: 0, cash: 0, online: 0, payments: 0 });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
