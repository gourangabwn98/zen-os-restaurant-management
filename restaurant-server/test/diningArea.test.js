// test/diningArea.test.js — KH-10: AC Room / Garden on dine-in orders.
// No DB — fakes (same harness style as placeOrderIdempotency.test.js).
//   node test/diningArea.test.js
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const { placeOrderTx } = await import("../services/orderService.js");
const { normalizeDiningArea, DINING_AREAS } = await import("../utils/diningArea.js");
const { createKotJobForOrder } = await import("../services/kotService.js");
const { combinedPrintPayload } = await import("../services/combinedBillService.js");

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.stack || err.message}`); }
};

const MENU = [{ _id: "m1", name: "Cold Coffee", price: 90, isAvailable: true }];
const makeReq = (user) => {
  const created = [];
  const models = {
    MenuItem: { findById: async (id) => MENU.find((m) => m._id === id) || null },
    RestaurantProfile: { findOne: async () => ({ gstRate: 0, serviceCharge: 0, editWindowMinutes: 3 }) },
    Category: { find: () => ({ select: () => ({ lean: async () => [] }) }) },
    Recipe: { find: async () => [] },
    InventoryItem: {},
    Table: { findOne: async ({ tableNo }) => ({ _id: `t${tableNo}`, tableNo, status: "Active" }), updateOne: async () => ({}) },
    TableSession: { findOne: async () => ({ _id: "ts1" }), findByIdAndUpdate: async () => ({}), updateOne: async () => ({}) },
    KOTJob: {},
    Order: {
      findOne: async () => null,
      create: async (payload) => { const o = { _id: `o${created.length + 1}`, orderId: `ORD0000${created.length + 1}`, ...payload }; created.push(o); return o; },
    },
  };
  return { req: { models, db: {}, user }, created };
};
const WAITER = { _id: "w1", role: "waiter", name: "Rahul" };
const body = (over) => ({ items: [{ menuItemId: "m1", qty: 1 }], orderType: "DINE_IN", tableNo: 12, ...over });

await test("normalizeDiningArea: only known areas, only on DINE_IN", () => {
  assert.deepEqual(DINING_AREAS, ["AC_ROOM", "GARDEN"]);
  assert.equal(normalizeDiningArea("AC_ROOM", "DINE_IN"), "AC_ROOM");
  assert.equal(normalizeDiningArea("GARDEN", "DINE_IN"), "GARDEN");
  assert.equal(normalizeDiningArea("AC_ROOM", "TAKEAWAY"), "");
  assert.equal(normalizeDiningArea("ROOFTOP", "DINE_IN"), "");
  assert.equal(normalizeDiningArea(undefined, "DINE_IN"), "");
  assert.equal(normalizeDiningArea({ $ne: "" }, "DINE_IN"), "");
});

await test("waiter places an AC Room order: dine-in, table required, area stored", async () => {
  const { req } = makeReq(WAITER);
  const { order } = await placeOrderTx({ req, body: body({ diningArea: "AC_ROOM" }) });
  assert.equal(order.orderType, "DINE_IN");
  assert.equal(order.tableNo, 12);
  assert.equal(order.diningArea, "AC_ROOM");
});

await test("AC Room / Garden still need a table (same dine-in rule)", async () => {
  const { req } = makeReq(WAITER);
  await assert.rejects(placeOrderTx({ req, body: body({ diningArea: "GARDEN", tableNo: undefined }) }), (e) => e.statusCode === 400);
});

await test("old behaviour: no area → \"\" (normal hall); takeaway never gets an area", async () => {
  const { req } = makeReq(WAITER);
  assert.equal((await placeOrderTx({ req, body: body({}) })).order.diningArea, "");
  assert.equal((await placeOrderTx({ req, body: body({ orderType: "TAKEAWAY", tableNo: undefined, diningArea: "AC_ROOM" }) })).order.diningArea, "");
});

await test("a customer can't set an area (staff only)", async () => {
  const { req } = makeReq(null);
  const { order } = await placeOrderTx({ req, body: body({ diningArea: "AC_ROOM" }) });
  assert.equal(order.diningArea, "");
});

await test("the area is copied onto the KOT job and the combined bill payload", async () => {
  const rows = [];
  const KOTJob = { create: async ([d]) => { rows.push(d); return [d]; } };
  await createKotJobForOrder({ KOTJob, order: { _id: "o1", orderId: "ORD1", items: [], diningArea: "GARDEN" }, actor: {} });
  assert.equal(rows[0].diningArea, "GARDEN");
  const both = combinedPrintPayload({ tableNo: 12, orders: [{ diningArea: "AC_ROOM", items: [] }, { diningArea: "AC_ROOM", items: [] }] });
  assert.equal(both.diningArea, "AC_ROOM");
  const mixed = combinedPrintPayload({ tableNo: 12, orders: [{ diningArea: "AC_ROOM", items: [] }, { items: [] }] });
  assert.equal(mixed.diningArea, "", "mixed areas → plain Dine In");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ALL TESTS PASSED");
