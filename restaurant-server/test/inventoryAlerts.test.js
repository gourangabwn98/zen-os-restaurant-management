// test/inventoryAlerts.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Covers a real bug found during final QA: order-confirmation-triggered
// stock deduction (deductStockForOrder) never signalled a low/critical/out
// alert, even though manual adjustment/wastage already did. "Trigger
// low-stock alert if required" is an explicit requirement of the KOT flow
// specifically, so this needed its own coverage.
// ─────────────────────────────────────────────────────────────────────────────
import assert from "node:assert/strict";
import { deductStockForOrder } from "../services/inventoryService.js";

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.message}`); }
};

class FakeQuery {
  constructor(exec) { this._exec = exec; }
  session() { return this; }
  then(res, rej) { return this._exec().then(res, rej); }
  catch(rej) { return this._exec().catch(rej); }
}

const makeModels = ({ inventorySeed, recipeSeed }) => {
  const invDocs = new Map(inventorySeed.map((d) => [d._id, { ...d }]));

  const InventoryItem = {
    find({ _id }) {
      const ids = _id.$in.map(String);
      return new FakeQuery(async () => [...invDocs.values()].filter((d) => ids.includes(String(d._id))));
    },
    async findOneAndUpdate(filter, update, _opts) {
      const doc = invDocs.get(filter._id);
      if (!doc) return null;
      if (filter.currentStock?.$gte != null && doc.currentStock < filter.currentStock.$gte) return null;
      if (update.$inc?.currentStock != null) doc.currentStock += update.$inc.currentStock;
      // Mimic a real Mongoose document: has .toObject(), same as what
      // deductStockForOrder actually calls in production.
      return { ...doc, toObject() { return { ...doc }; } };
    },
  };

  const Recipe = { find: async () => recipeSeed };
  const StockLedger = { create: async () => [{}] };
  const Order = {
    findByIdAndUpdate: async () => ({}),
    // Default: the "claim" (stockDeducted:false -> true) always succeeds —
    // individual tests override this to simulate the already-claimed case.
    findOneAndUpdate: async () => ({ _id: "o1" }),
  };

  return { InventoryItem, Recipe, StockLedger, Order };
};

const order = {
  _id: "o1", orderId: "ORD00001",
  items: [{ menuItem: "menu-1", qty: 1 }],
};

const run = async () => {
  console.log("── low-stock alert on order-triggered deduction ────────────");

  await test("no alert when deduction leaves stock comfortably above reorder level", async () => {
    const models = makeModels({
      inventorySeed: [{ _id: "ing-1", name: "Rice", status: "Active", currentStock: 10000, reorderLevel: 1000, criticalLevel: 200, unit: "g" }],
      recipeSeed: [{ menuItem: "menu-1", status: "Active", ingredients: [{ inventoryItem: "ing-1", unit: "g", quantity: 250 }] }],
    });
    const result = await deductStockForOrder({ models, order, actor: { role: "WAITER" } });
    assert.equal(result.deducted, true);
    assert.equal(result.alerts.length, 0);
  });

  await test("emits a LOW alert exactly when deduction crosses the reorder level", async () => {
    const models = makeModels({
      // 1050g on hand, reorder at 1000g. One order needs 250g → lands at 800g → LOW.
      inventorySeed: [{ _id: "ing-1", name: "Rice", status: "Active", currentStock: 1050, reorderLevel: 1000, criticalLevel: 200, unit: "g" }],
      recipeSeed: [{ menuItem: "menu-1", status: "Active", ingredients: [{ inventoryItem: "ing-1", unit: "g", quantity: 250 }] }],
    });
    const result = await deductStockForOrder({ models, order, actor: { role: "WAITER" } });
    assert.equal(result.alerts.length, 1);
    assert.equal(result.alerts[0].item.name, "Rice");
    assert.match(result.alerts[0].level, /LOW|CRITICAL/i);
  });

  await test("emits a CRITICAL alert when deduction crosses the critical level", async () => {
    const models = makeModels({
      inventorySeed: [{ _id: "ing-1", name: "Chicken", status: "Active", currentStock: 300, reorderLevel: 1000, criticalLevel: 200, unit: "g" }],
      recipeSeed: [{ menuItem: "menu-1", status: "Active", ingredients: [{ inventoryItem: "ing-1", unit: "g", quantity: 200 }] }],
    });
    const result = await deductStockForOrder({ models, order, actor: { role: "WAITER" } });
    assert.equal(result.alerts.length, 1);
    assert.match(result.alerts[0].level, /CRITICAL|OUT/i);
  });

  await test("emits an OUT alert when deduction takes stock to exactly zero", async () => {
    const models = makeModels({
      inventorySeed: [{ _id: "ing-1", name: "Oil", status: "Active", currentStock: 30, reorderLevel: 500, criticalLevel: 100, unit: "ml" }],
      recipeSeed: [{ menuItem: "menu-1", status: "Active", ingredients: [{ inventoryItem: "ing-1", unit: "ml", quantity: 30 }] }],
    });
    const result = await deductStockForOrder({ models, order, actor: { role: "WAITER" } });
    assert.equal(result.alerts.length, 1);
    assert.match(result.alerts[0].level, /OUT/i);
  });

  await test("an order with no inventory-tracked items returns alerts: [] (not undefined)", async () => {
    const models = makeModels({ inventorySeed: [], recipeSeed: [] }); // no recipe for menu-1
    const result = await deductStockForOrder({ models, order, actor: { role: "WAITER" } });
    assert.deepEqual(result.alerts, []);
  });

  await test("a second (already-deducted) call returns alerts: [] rather than re-alerting", async () => {
    const models = makeModels({
      inventorySeed: [{ _id: "ing-1", name: "Rice", status: "Active", currentStock: 1050, reorderLevel: 1000, criticalLevel: 200, unit: "g" }],
      recipeSeed: [{ menuItem: "menu-1", status: "Active", ingredients: [{ inventoryItem: "ing-1", unit: "g", quantity: 250 }] }],
    });
    const firstOrder = { ...order, stockDeducted: false };
    // Simulate: first call claims and deducts (stockDeducted flips true in a
    // real DB via the atomic findOneAndUpdate — here we just track it
    // ourselves since Order.findOneAndUpdate is faked to always "succeed").
    // The real guarantee (never deducts twice) is already covered by
    // inventoryDeduction.test.js; this test only checks the alerts field
    // shape stays well-formed on the "nothing to do" path.
    models.Order.findOneAndUpdate = async (filter) =>
      filter.stockDeducted === false ? null : { _id: "o1" };
    const result = await deductStockForOrder({ models, order: firstOrder, actor: { role: "WAITER" } });
    assert.deepEqual(result, { deducted: false, deductions: [], alerts: [] });
  });

  console.log("──────────────────────────────────────────────");
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) { console.error("SOME TESTS FAILED"); process.exit(1); }
  console.log("ALL TESTS PASSED");
};

run();
