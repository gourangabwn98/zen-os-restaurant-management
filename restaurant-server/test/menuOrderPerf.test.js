// test/menuOrderPerf.test.js — the speed-ups in GET /api/menu and
// placeOrderTx (independent reads run together) give the SAME results, and
// nothing is written before every check has passed. No DB — fakes with a
// delay per call, so the number of round trips in a row is measurable.
//   node test/menuOrderPerf.test.js
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const { computeStockStatusForMenuItems, computeStockStatusForActiveRecipes } = await import("../services/inventoryService.js");
const { getMenu } = await import("../controllers/menuController.js");
const { placeOrderTx } = await import("../services/orderService.js");

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.stack || err.message}`); }
};

const RTT = Number(process.env.RTT || 100); // ms per fake DB call
const later = (v) => new Promise((r) => setTimeout(() => r(typeof v === "function" ? v() : v), RTT));
const q = (data) => { const self = { select: () => self, sort: () => self, lean: () => self, session: () => self, then: (a, b) => later(data).then(a, b) }; return self; };

const recipes = [
  { menuItem: "m1", status: "Active", ingredients: [{ sourceType: "STOCK", inventoryItem: "rice", quantity: 1, unit: "pcs" }] },
  { menuItem: "m2", status: "Active", ingredients: [{ sourceType: "STOCK", inventoryItem: "milk", quantity: 2, unit: "pcs" }] },
  { menuItem: "m3", status: "Active", ingredients: [{ sourceType: "CUSTOM", name: "Garnish", quantity: 1, unit: "pcs", cost: 2 }] }, // not stock-tracked
  { menuItem: "m9", status: "Active", ingredients: [{ sourceType: "STOCK", inventoryItem: "rice", quantity: 1, unit: "pcs" }] },  // not on the menu
];
const inventory = [
  { _id: "rice", name: "Rice", unit: "pcs", currentStock: 5, status: "Active" },
  { _id: "milk", name: "Milk", unit: "pcs", currentStock: 1, status: "Active" }, // short for m2 (needs 2)
];
const matchRecipes = (f) => recipes.filter((r) => r.status === f.status && (!f.menuItem || f.menuItem.$in.map(String).includes(r.menuItem)));
const stockModels = () => ({ Recipe: { find: (f) => q(() => matchRecipes(f)) }, InventoryItem: { find: () => q(inventory) } });

await test("stock status for all active recipes = per-item stock status, item by item", async () => {
  const ids = ["m1", "m2", "m3", "m4"];
  const perItem = await computeStockStatusForMenuItems({ models: stockModels(), menuItemIds: ids });
  const all = await computeStockStatusForActiveRecipes({ models: stockModels() });
  for (const id of ids) assert.deepEqual(all.get(id), perItem.get(id), id);
  assert.deepEqual(all.get("m1"), { tracked: true, inStock: true });
  assert.deepEqual(all.get("m2"), { tracked: true, inStock: false });
  assert.equal(all.get("m3"), undefined, "no stock ingredients → not tracked, as before");
  assert.equal((await computeStockStatusForMenuItems({ models: stockModels(), menuItemIds: [] })).size, 0, "no ids → empty, as before");
});

const MENU = [
  { _id: "m1", name: "Biryani", category: "Mains", categories: [], price: 200, isAvailable: true },
  { _id: "m2", name: "Tea", category: "Drinks", categories: [], price: 20, isAvailable: true },
  { _id: "m4", name: "Thali", category: "Thali", categories: [], price: 150, isAvailable: true },
];
const menuModels = ({ thaliFlagged = true, failRecipes = false } = {}) => ({
  ...stockModels(),
  ...(failRecipes && { Recipe: { find: () => ({ lean: () => Promise.reject(new Error("db down")) }) } }),
  MenuItem: { updateMany: () => later({ modifiedCount: 0 }), find: () => q(MENU) },
  RestaurantProfile: { findOne: () => q({ timezone: "Asia/Kolkata" }) },
  Category: {
    find: (f = {}) => q(f.notShareable ? (thaliFlagged ? [{ name: "Thali" }] : []) : []), findOne: () => q({ _id: "c" }),
    create: () => later({}), updateOne: () => later({}), // one-time section setup (warm-up call)
  },
  Order: { aggregate: () => later([]), find: () => q([]) },
  StaffReview: { find: () => q([]) },
});
const callMenu = (models, query = {}) => new Promise((resolve) => {
  let code = 200;
  getMenu({ models, query, user: { role: "waiter" } }, { status(c) { code = c; return this; }, json: (body) => resolve({ code, body }) });
});

await test("GET /menu: stock flags and the not-shareable note are the same, in about 2 round trips (was ~5)", async () => {
  await callMenu(menuModels()); // warm the one-time smart-category setup / 5-min cache
  const t0 = Date.now();
  const { code, body } = await callMenu(menuModels());
  const trips = (Date.now() - t0) / RTT;
  assert.equal(code, 200);
  const by = Object.fromEntries(body.map((i) => [i._id, i]));
  assert.deepEqual([by.m1.stockTracked, by.m1.stockAvailable], [true, true]);
  assert.deepEqual([by.m2.stockTracked, by.m2.stockAvailable], [true, false], "short on milk → shown out of stock");
  assert.deepEqual([by.m4.stockTracked, by.m4.stockAvailable], [false, true], "no recipe → in stock, as before");
  assert.equal(by.m4.notShareableCategory, "Thali");
  assert.equal("notShareableCategory" in by.m1, false);
  assert.ok(trips < 3.5, `~${trips.toFixed(1)} round trips in a row`);
});

await test("GET /menu: a failing read is still answered with an error (no unhandled rejection)", async () => {
  const { code, body } = await callMenu(menuModels({ failRecipes: true }));
  assert.equal(code, 500);
  assert.match(body.message, /db down/);
});

// ── placeOrderTx ────────────────────────────────────────────────────────────
const placeModels = ({ stock = 10, existing = null } = {}) => {
  const writes = [];
  const w = (name, v) => () => { writes.push(name); return later(v); };
  return {
    writes,
    models: {
      MenuItem: { findById: (id) => later(MENU.find((m) => m._id === id) || null), updateMany: () => later({ modifiedCount: 0 }) },
      RestaurantProfile: { findOne: () => q({ gstRate: 0, serviceCharge: 0, editWindowMinutes: 3, timezone: "Asia/Kolkata" }) },
      Category: { find: () => q([]) },
      Recipe: { find: () => q(recipes.filter((r) => r.menuItem === "m1")) },
      InventoryItem: { find: () => q([{ ...inventory[0], currentStock: stock }]) },
      Table: { findOne: ({ tableNo }) => later({ _id: `t${tableNo}`, tableNo, displayNo: 2, status: "Active", diningArea: "GARDEN" }), updateOne: w("Table.updateOne", {}) },
      TableSession: { findOne: () => q(null), create: (d) => { writes.push("TableSession.create"); return later({ _id: "ts1", ...d }); }, findByIdAndUpdate: w("TableSession.addOrder", {}) },
      Order: {
        findOne: () => q(existing),
        create: (p) => { writes.push("Order.create"); return later({ _id: "o1", orderId: "ORD1", ...p }); },
      },
      KOTJob: {},
    },
  };
};
const WAITER = { _id: "w1", role: "waiter", name: "Rahul" };
const body = { items: [{ menuItemId: "m1", qty: 2 }], orderType: "DINE_IN", tableNo: 20, idempotencyKey: "k1" };

await test("place order: same order, fewer round trips; idempotent replay still answered first, nothing written", async () => {
  const world = placeModels();
  const t0 = Date.now();
  const { order } = await placeOrderTx({ req: { models: world.models, db: {}, user: WAITER }, body });
  const trips = (Date.now() - t0) / RTT;
  assert.equal(order.total, 400);
  assert.equal(order.diningArea, "GARDEN");
  assert.equal(order.tableDisplayNo, 2);
  assert.equal(order.status, "CONFIRMED");
  assert.deepEqual(world.writes, ["TableSession.create", "Table.updateOne", "Order.create", "TableSession.addOrder"]);
  assert.ok(trips < 11.5, `~${trips.toFixed(1)} round trips in a row (was ~12.5)`);

  const replay = placeModels({ existing: { _id: "o0", orderId: "ORD0" } });
  const r = await placeOrderTx({ req: { models: replay.models, db: {}, user: WAITER }, body });
  assert.equal(r.alreadyExisted, true);
  assert.equal(r.order.orderId, "ORD0");
  assert.deepEqual(replay.writes, [], "a double click / retry writes nothing");
});

await test("place order: not enough stock → refused BEFORE the table is marked occupied", async () => {
  const world = placeModels({ stock: 1 }); // 2 biryani need 2 rice
  await assert.rejects(placeOrderTx({ req: { models: world.models, db: {}, user: WAITER }, body }), (e) => e.statusCode === 409 && /Insufficient stock/.test(e.message));
  assert.deepEqual(world.writes, [], "no session opened, no table occupied, no order");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ALL TESTS PASSED");
process.exit(0);
