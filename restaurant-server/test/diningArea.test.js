// test/diningArea.test.js — table areas (Indoor / AC Room / Garden).
// The admin sets a table's area; every dine-in order on that table takes its
// area from the table (server-side). Also the one table ordering used by
// every table map, and the "in use" guard. No DB — fakes.
//   node test/diningArea.test.js
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const { placeOrderTx } = await import("../services/orderService.js");
const {
  normalizeDiningArea, DINING_AREAS, TABLE_AREAS, normalizeTableArea, sortTablesByArea, tableDisplayName, tableDisplayNo,
} = await import("../utils/diningArea.js");
const { createKotJobForOrder } = await import("../services/kotService.js");
const { combinedPrintPayload } = await import("../services/combinedBillService.js");
const { assertTableFree } = await import("../controllers/tableController.js");

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.stack || err.message}`); }
};

const MENU = [{ _id: "m1", name: "Cold Coffee", price: 90, isAvailable: true }];
// Tables as the admin configured them: 1–4 Indoor, 11 AC Room, 20 Garden.
const AREA_OF = { 11: "AC_ROOM", 20: "GARDEN" };
const makeReq = (user) => {
  const created = [];
  const models = {
    MenuItem: { findById: async (id) => MENU.find((m) => m._id === id) || null },
    RestaurantProfile: { findOne: async () => ({ gstRate: 0, serviceCharge: 0, editWindowMinutes: 3 }) },
    Category: { find: () => ({ select: () => ({ lean: async () => [] }) }) },
    Recipe: { find: async () => [] },
    InventoryItem: {},
    Table: {
      findOne: async ({ tableNo }) => ({ _id: `t${tableNo}`, tableNo, status: "Active", ...(AREA_OF[tableNo] && { diningArea: AREA_OF[tableNo] }) }),
      updateOne: async () => ({}),
    },
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
  assert.deepEqual(DINING_AREAS, ["AC_ROOM", "GARDEN", "GAZEBO"]);
  assert.equal(normalizeDiningArea("GAZEBO", "DINE_IN"), "GAZEBO");
  assert.equal(normalizeDiningArea("AC_ROOM", "DINE_IN"), "AC_ROOM");
  assert.equal(normalizeDiningArea("GARDEN", "DINE_IN"), "GARDEN");
  assert.equal(normalizeDiningArea("AC_ROOM", "TAKEAWAY"), "");
  assert.equal(normalizeDiningArea("ROOFTOP", "DINE_IN"), "");
  assert.equal(normalizeDiningArea(undefined, "DINE_IN"), "");
});

await test("table area input: Indoor / AC Room / Garden only; unknown refused", () => {
  assert.deepEqual(TABLE_AREAS, ["", "AC_ROOM", "GARDEN", "GAZEBO"]);
  assert.equal(normalizeTableArea("GAZEBO"), "GAZEBO");
  assert.equal(normalizeTableArea(undefined), undefined, "not sent → unchanged");
  assert.equal(normalizeTableArea(""), "");
  assert.equal(normalizeTableArea(null), "");
  assert.equal(normalizeTableArea("GARDEN"), "GARDEN");
  for (const bad of ["Rooftop", "garden", { $ne: "" }]) assert.throws(() => normalizeTableArea(bad), (e) => e.statusCode === 400);
});

await test("order on an AC Room table is AC Room — from the TABLE, whatever the client sends", async () => {
  const { req } = makeReq(WAITER);
  assert.equal((await placeOrderTx({ req, body: body({ tableNo: 11, guests: 2 }) })).order.diningArea, "AC_ROOM");
  assert.equal((await placeOrderTx({ req, body: body({ tableNo: 11, guests: 2, diningArea: "GARDEN" }) })).order.diningArea, "AC_ROOM");
  assert.equal((await placeOrderTx({ req, body: body({ tableNo: 20 }) })).order.diningArea, "GARDEN");
  assert.equal((await placeOrderTx({ req, body: body({ tableNo: 3, diningArea: "AC_ROOM" }) })).order.diningArea, "", "Indoor table stays Indoor");
});

await test("a customer QR order at an AC Room table is AC Room too (area belongs to the table)", async () => {
  const { req } = makeReq({ _id: "cust1", role: "customer", name: "Priya" }); // logged-in customer
  assert.equal((await placeOrderTx({ req, body: body({ tableNo: 11 }) })).order.diningArea, "AC_ROOM");
});

await test("takeaway never gets an area; dine-in still needs a table", async () => {
  const { req } = makeReq(WAITER);
  assert.equal((await placeOrderTx({ req, body: body({ orderType: "TAKEAWAY", tableNo: undefined, diningArea: "AC_ROOM" }) })).order.diningArea, "");
  await assert.rejects(placeOrderTx({ req, body: body({ tableNo: undefined }) }), (e) => e.statusCode === 400);
});

await test("KH-11: staff Indoor-AC order needs the guest count; guests × ₹20 is in the subtotal", async () => {
  const { req } = makeReq(WAITER);
  await assert.rejects(placeOrderTx({ req, body: body({ tableNo: 11 }) }), (e) => e.statusCode === 400 && /guests/i.test(e.message));
  const { order } = await placeOrderTx({ req, body: body({ tableNo: 11, guests: 4 }) });
  assert.equal(order.guests, 4);
  assert.equal(order.acServiceRate, 20);
  assert.equal(order.acServiceCharge, 80);
  assert.equal(order.subtotal, 90 + 80);
  assert.equal(order.total, 90 + 80);
  const garden = (await placeOrderTx({ req, body: body({ tableNo: 20 }) })).order;
  assert.equal(garden.acServiceCharge, undefined, "Garden: no guests asked, no charge");
  assert.equal(garden.subtotal, 90);
});

await test("KH-11: a second order while the AC table's guests are already counted is not charged again", async () => {
  const { req } = makeReq(WAITER);
  req.models.Order.findOne = async (q) => (q?.tableSession ? { _id: "earlier", guests: 4 } : null);
  const { order } = await placeOrderTx({ req, body: body({ tableNo: 11 }) });
  assert.equal(order.acServiceCharge, undefined);
  assert.equal(order.subtotal, 90);
});

await test("one table ordering for every map: Indoor → Indoor-AC → Garden → Gazebo, then number in area", () => {
  const name = (t) => tableDisplayName(t.diningArea, t.displayNo ?? t.tableNo);
  const tables = [
    { tableNo: 30, displayNo: 2, diningArea: "GAZEBO" }, { tableNo: 21, displayNo: 1, diningArea: "GARDEN" },
    { tableNo: 2 }, { tableNo: 11, displayNo: 1, diningArea: "AC_ROOM" }, { tableNo: 1, diningArea: "" },
    { tableNo: 29, displayNo: 1, diningArea: "GAZEBO" }, { tableNo: 12, displayNo: 2, diningArea: "AC_ROOM" },
  ];
  assert.deepEqual(sortTablesByArea(tables).map(name),
    ["Indoor 1", "Indoor 2", "Indoor-AC 1", "Indoor-AC 2", "Garden 1", "Gazebo 1", "Gazebo 2"]);
  assert.equal(tableDisplayNo({ tableNo: 7 }), 7, "older table: its number is its tableNo");
  assert.equal(tableDisplayNo({ tableNo: 40, displayNo: 3 }), 3);
});

await test("the order remembers the table as people know it (Indoor-AC 1), for screens / KOT / bill", async () => {
  const { req } = makeReq(WAITER);
  const { order } = await placeOrderTx({ req, body: body({ tableNo: 11, guests: 2 }) });
  assert.equal(order.tableName, "Indoor-AC 11", "fixture table 11 has no per-area number → 11");
  assert.equal(order.tableDisplayNo, 11);
  const take = (await placeOrderTx({ req, body: body({ orderType: "TAKEAWAY", tableNo: undefined }) })).order;
  assert.equal(take.tableName, "");
});

await test("a table in use can't be disabled or deleted (open session or running order)", async () => {
  const models = (session, order) => ({
    TableSession: { findOne: () => ({ select: () => ({ lean: async () => session }) }) },
    Order: { findOne: () => ({ select: () => ({ lean: async () => order }) }) },
  });
  await assert.rejects(assertTableFree(models({ _id: "s" }, null), "5", "deleted"), (e) => e.statusCode === 409 && /Table 5 is in use/.test(e.message));
  await assert.rejects(assertTableFree(models(null, { _id: "o" }), "5", "disabled"), (e) => e.statusCode === 409);
  await assertTableFree(models(null, null), "5", "deleted"); // free → allowed
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
