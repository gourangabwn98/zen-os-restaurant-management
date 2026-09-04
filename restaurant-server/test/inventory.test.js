// test/inventory.test.js
// ─────────────────────────────────────────────────────────────────────────────
// node test/inventory.test.js
// Two layers:
//  1. Pure-function tests for classifyStockLevel (no DB).
//  2. A functional test of deductStockForOrder / reverseStockForOrder against
//     a minimal in-memory fake of the Mongoose API surface they use
//     (findOneAndUpdate with a filter guard, create, findById, etc.), since a
//     real MongoDB replica set isn't reachable from this environment. This
//     exercises the actual idempotency/negative-stock logic, not just syntax.
// ─────────────────────────────────────────────────────────────────────────────

import assert from "node:assert/strict";
import { classifyStockLevel } from "../utils/inventoryConstants.js";
import { deductStockForOrder, reverseStockForOrder } from "../services/inventoryService.js";

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL - ${name}`);
    console.error(`         ${err.stack || err.message}`);
  }
};

console.log("── classifyStockLevel ──────────────────────────");

await test("0 stock is OUT_OF_STOCK regardless of levels", () => {
  assert.equal(classifyStockLevel(0, 10, 5), "OUT_OF_STOCK");
});
await test("at/below criticalLevel is CRITICAL", () => {
  assert.equal(classifyStockLevel(5, 10, 5), "CRITICAL");
  assert.equal(classifyStockLevel(3, 10, 5), "CRITICAL");
});
await test("at/below reorderLevel (but above critical) is LOW", () => {
  assert.equal(classifyStockLevel(8, 10, 5), "LOW");
});
await test("above reorderLevel is OK", () => {
  assert.equal(classifyStockLevel(20, 10, 5), "OK");
});

console.log("── deductStockForOrder / reverseStockForOrder (fake DB) ──");

// ── Minimal fake Mongoose collection ────────────────────────────────────────
const makeFakeCollection = (seedDocs) => {
  const docs = new Map(seedDocs.map((d) => [String(d._id), { ...d }]));
  let n = 0;
  const nextId = () => `fake_${++n}`;

  const applyUpdate = (doc, update) => {
    if (update.$set) Object.assign(doc, update.$set);
    if (update.$inc) for (const [k, v] of Object.entries(update.$inc)) doc[k] = (doc[k] || 0) + v;
    if (update.$push) for (const [k, v] of Object.entries(update.$push)) doc[k] = [...(doc[k] || []), v];
    return doc;
  };

  const matches = (doc, filter) => {
    for (const [k, v] of Object.entries(filter)) {
      if (v && typeof v === "object" && "$gte" in v) { if (!(doc[k] >= v.$gte)) return false; }
      else if (v && typeof v === "object" && "$in" in v) { if (!v.$in.map(String).includes(String(doc[k]))) return false; }
      else if (String(doc[k]) !== String(v)) return false;
    }
    return true;
  };

  const makeQuery = (results) => {
    const query = {
      sort: () => query,
      limit: () => query,
      skip: () => query,
      populate: () => query,
      lean: () => query,
      session: () => query,
      select: () => query,
      then: (resolve, reject) => Promise.resolve(results).then(resolve, reject),
      catch: (reject) => Promise.resolve(results).catch(reject),
    };
    return query;
  };

  return {
    _docs: docs,
    findById: async (id) => {
      const d = docs.get(String(id));
      return d ? { ...d, toObject: () => ({ ...d }) } : null;
    },
    findOneAndUpdate: async (filter, update) => {
      for (const doc of docs.values()) {
        if (matches(doc, filter)) {
          applyUpdate(doc, update);
          return { ...doc };
        }
      }
      return null;
    },
    findByIdAndUpdate: async (id, update) => {
      const doc = docs.get(String(id));
      if (!doc) return null;
      applyUpdate(doc, update);
      return { ...doc };
    },
    find: (filter = {}) => makeQuery([...docs.values()].filter((d) => matches(d, filter))),
    create: async (arr) => {
      const created = arr.map((d) => {
        const doc = { _id: nextId(), ...d };
        docs.set(String(doc._id), doc);
        return doc;
      });
      return created;
    },
  };
};

const buildFakeModels = ({ menuItemId, inventoryItemId, currentStock, recipeQtyPerUnit }) => {
  const InventoryItem = makeFakeCollection([
    { _id: inventoryItemId, name: "Rice", unit: "g", currentStock, status: "Active" },
  ]);
  const Recipe = {
    find: async () => [{
      menuItem: menuItemId,
      status: "Active",
      ingredients: [{ inventoryItem: inventoryItemId, unit: "g", quantity: recipeQtyPerUnit }],
    }],
  };
  const StockLedger = makeFakeCollection([]);
  const InventoryBatch = makeFakeCollection([]);
  const Order = makeFakeCollection([]); // populated per-test with the order doc
  return { Order, Recipe, InventoryItem, StockLedger, InventoryBatch };
};

await test("deductStockForOrder deducts exactly the recipe quantity × ordered qty", async () => {
  const menuItemId = "menu1", inventoryItemId = "inv1";
  const models = buildFakeModels({ menuItemId, inventoryItemId, currentStock: 1000, recipeQtyPerUnit: 250 });
  const order = { _id: "order1", orderId: "ORD00001", items: [{ menuItem: menuItemId, qty: 2 }], stockDeducted: false };
  models.Order._docs.set(order._id, order);

  const result = await deductStockForOrder({ models, order, actor: { role: "ADMIN" } });
  assert.equal(result.deducted, true);
  assert.equal(result.deductions.length, 1);
  assert.equal(result.deductions[0].qty, 500); // 250g * 2

  const item = await models.InventoryItem.findById(inventoryItemId);
  assert.equal(item.currentStock, 500); // 1000 - 500
});

await test("deductStockForOrder is idempotent — a second call is a no-op", async () => {
  const menuItemId = "menu1", inventoryItemId = "inv1";
  const models = buildFakeModels({ menuItemId, inventoryItemId, currentStock: 1000, recipeQtyPerUnit: 250 });
  const order = { _id: "order1", orderId: "ORD00001", items: [{ menuItem: menuItemId, qty: 2 }], stockDeducted: false };
  models.Order._docs.set(order._id, order);

  await deductStockForOrder({ models, order, actor: { role: "ADMIN" } });
  const second = await deductStockForOrder({ models, order, actor: { role: "ADMIN" } });
  assert.equal(second.deducted, false);

  const item = await models.InventoryItem.findById(inventoryItemId);
  assert.equal(item.currentStock, 500); // unchanged by the second call — NOT double-deducted
});

await test("deductStockForOrder throws (does not go negative) when stock is insufficient", async () => {
  const menuItemId = "menu1", inventoryItemId = "inv1";
  const models = buildFakeModels({ menuItemId, inventoryItemId, currentStock: 100, recipeQtyPerUnit: 250 });
  const order = { _id: "order1", orderId: "ORD00001", items: [{ menuItem: menuItemId, qty: 2 }], stockDeducted: false };
  models.Order._docs.set(order._id, order);

  await assert.rejects(
    () => deductStockForOrder({ models, order, actor: { role: "ADMIN" } }),
    /Insufficient stock/
  );

  const item = await models.InventoryItem.findById(inventoryItemId);
  assert.equal(item.currentStock, 100); // untouched, never went negative
});

await test("reverseStockForOrder credits stock back exactly once", async () => {
  const menuItemId = "menu1", inventoryItemId = "inv1";
  const models = buildFakeModels({ menuItemId, inventoryItemId, currentStock: 1000, recipeQtyPerUnit: 250 });
  const order = {
    _id: "order1", orderId: "ORD00001", items: [{ menuItem: menuItemId, qty: 2 }],
    stockDeducted: false, stockReversed: false, // real Mongoose schema defaults both to false
  };
  models.Order._docs.set(order._id, order);

  await deductStockForOrder({ models, order, actor: { role: "ADMIN" } });
  const afterDeduct = await models.Order.findById(order._id);

  const r1 = await reverseStockForOrder({ models, order: afterDeduct, actor: { role: "ADMIN" } });
  assert.equal(r1.reversed, true);
  const itemAfterReversal = await models.InventoryItem.findById(inventoryItemId);
  assert.equal(itemAfterReversal.currentStock, 1000); // fully credited back

  const afterReverse = await models.Order.findById(order._id);
  const r2 = await reverseStockForOrder({ models, order: afterReverse, actor: { role: "ADMIN" } });
  assert.equal(r2.reversed, false); // idempotent — second reversal is a no-op

  const itemAfterSecondReversal = await models.InventoryItem.findById(inventoryItemId);
  assert.equal(itemAfterSecondReversal.currentStock, 1000); // not double-credited
});

await test("reverseStockForOrder is a safe no-op for an order that was never deducted", async () => {
  const models = buildFakeModels({ menuItemId: "menu1", inventoryItemId: "inv1", currentStock: 1000, recipeQtyPerUnit: 250 });
  const order = { _id: "order2", orderId: "ORD00002", items: [], stockDeducted: false };
  const result = await reverseStockForOrder({ models, order, actor: { role: "ADMIN" } });
  assert.equal(result.reversed, false);
});

await test("menu items with no recipe are skipped — nothing deducted, no error", async () => {
  const models = buildFakeModels({ menuItemId: "menu1", inventoryItemId: "inv1", currentStock: 1000, recipeQtyPerUnit: 250 });
  const order = { _id: "order3", orderId: "ORD00003", items: [{ menuItem: "menu_untracked", qty: 5 }], stockDeducted: false };
  models.Order._docs.set(order._id, order);
  const result = await deductStockForOrder({ models, order, actor: { role: "ADMIN" } });
  assert.equal(result.deducted, true);
  assert.equal(result.deductions.length, 0);
});

console.log("──────────────────────────────────────────────");
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) { console.error("SOME TESTS FAILED"); process.exit(1); }
console.log("ALL TESTS PASSED");
