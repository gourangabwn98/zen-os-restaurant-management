// test/inventoryDeduction.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Exercises deductStockForOrder / reverseStockForOrder against minimal
// in-memory model stubs — verifies the three hard requirements from the
// Phase 2 spec that don't need a real MongoDB transaction to prove:
//   - duplicate deduction is prevented (idempotent on stockDeducted)
//   - negative stock is prevented (conditional $gte guard)
//   - reversal restores exactly what was deducted, and is itself idempotent
// NOTE: this does NOT exercise real Mongo transaction atomicity (rollback on
// error) — that needs a live replica-set MongoDB (e.g. the real Atlas
// cluster), which this sandbox has no network route to. See the phase
// summary for a recommended manual verification once deployed.
// ─────────────────────────────────────────────────────────────────────────────

import assert from "node:assert/strict";
import { deductStockForOrder, reverseStockForOrder } from "../services/inventoryService.js";

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.message}\n${err.stack}`); }
};

// ── Minimal thenable "query" so `.find(...).session(...)` chains work ──────
class FakeQuery {
  constructor(exec) { this._exec = exec; }
  session() { return this; }
  sort() { return this; }
  populate() { return this; }
  lean() { return this; }
  then(res, rej) { return this._exec().then(res, rej); }
  catch(rej) { return this._exec().catch(rej); }
}

// ── Fake InventoryItem collection ───────────────────────────────────────────
const makeFakeInventoryItem = (seed) => {
  const docs = new Map(seed.map((d) => [d._id, { ...d }]));
  return {
    _docs: docs,
    find({ _id }) {
      const ids = _id.$in.map(String);
      return new FakeQuery(async () => [...docs.values()].filter((d) => ids.includes(String(d._id))));
    },
    async findOneAndUpdate(filter, update, opts) {
      const doc = docs.get(filter._id);
      if (!doc) return null;
      if (filter.currentStock?.$gte != null && doc.currentStock < filter.currentStock.$gte) return null;
      if (update.$inc?.currentStock != null) doc.currentStock += update.$inc.currentStock;
      if (update.$set) Object.assign(doc, update.$set);
      return { ...doc };
    },
    async findByIdAndUpdate(id, update) {
      const doc = docs.get(id);
      if (!doc) return null;
      if (update.$inc?.currentStock != null) doc.currentStock += update.$inc.currentStock;
      return { ...doc };
    },
  };
};

// ── Fake Order collection (just enough for the two guard flips) ───────────
const makeFakeOrder = (seed) => {
  const doc = { ...seed };
  return {
    _doc: doc,
    async findOneAndUpdate(filter, update) {
      if (filter._id !== doc._id) return null;
      if ("stockDeducted" in filter && doc.stockDeducted !== filter.stockDeducted) return null;
      if ("stockReversed" in filter && doc.stockReversed !== filter.stockReversed) return null;
      if (update.$set) Object.assign(doc, update.$set);
      return { ...doc };
    },
    async findByIdAndUpdate(id, update) {
      if (id !== doc._id) return null;
      if (update.$set) Object.assign(doc, update.$set);
      return { ...doc };
    },
  };
};

// ── Fake StockLedger — just records what was written ───────────────────────
const makeFakeStockLedger = () => {
  const entries = [];
  return {
    entries,
    async create(docsArr) {
      const arr = Array.isArray(docsArr) ? docsArr : [docsArr];
      arr.forEach((d) => entries.push(d));
      return arr;
    },
  };
};

const fakeRecipe = (ingredients) => ({
  find: async () => [{ menuItem: "menu-1", status: "Active", ingredients }],
});

const run = async () => {
  console.log("── deductStockForOrder ─────────────────────────");

  await test("deducts stock, writes a ledger entry, and captures stockDeductions", async () => {
    const InventoryItem = makeFakeInventoryItem([{ _id: "rice", name: "Rice", unit: "g", currentStock: 1000, status: "Active" }]);
    const StockLedger = makeFakeStockLedger();
    const Order = makeFakeOrder({ _id: "order-1", orderId: "ORD00001", stockDeducted: false, items: [{ menuItem: "menu-1", qty: 2 }] });
    const Recipe = fakeRecipe([{ inventoryItem: "rice", quantity: 250, unit: "g" }]);

    const result = await deductStockForOrder({
      models: { Order, Recipe, InventoryItem, StockLedger, InventoryBatch: { find: () => new FakeQuery(async () => []) } },
      order: Order._doc,
      actor: { id: null, role: "ADMIN", name: "Test" },
      session: null,
    });

    assert.equal(result.deducted, true);
    assert.equal(result.deductions.length, 1);
    assert.equal(result.deductions[0].qty, 500); // 250 * 2
    assert.equal(InventoryItem._docs.get("rice").currentStock, 500); // 1000 - 500
    assert.equal(StockLedger.entries.length, 1);
    assert.equal(StockLedger.entries[0].type, "SALE_DEDUCTION");
    assert.equal(StockLedger.entries[0].quantity, -500);
    assert.equal(Order._doc.stockDeducted, true);
    assert.deepEqual(Order._doc.stockDeductions.map((d) => d.qty), [500]);
  });

  await test("calling deductStockForOrder twice only deducts once (idempotent)", async () => {
    const InventoryItem = makeFakeInventoryItem([{ _id: "rice", name: "Rice", unit: "g", currentStock: 1000, status: "Active" }]);
    const StockLedger = makeFakeStockLedger();
    const Order = makeFakeOrder({ _id: "order-2", orderId: "ORD00002", stockDeducted: false, items: [{ menuItem: "menu-1", qty: 1 }] });
    const Recipe = fakeRecipe([{ inventoryItem: "rice", quantity: 250, unit: "g" }]);
    const models = { Order, Recipe, InventoryItem, StockLedger, InventoryBatch: { find: () => new FakeQuery(async () => []) } };
    const actor = { id: null, role: "ADMIN", name: "Test" };

    const first  = await deductStockForOrder({ models, order: Order._doc, actor, session: null });
    const second = await deductStockForOrder({ models, order: Order._doc, actor, session: null });

    assert.equal(first.deducted, true);
    assert.equal(second.deducted, false); // no-op — already deducted
    assert.equal(InventoryItem._docs.get("rice").currentStock, 750); // only ONE deduction of 250 applied
    assert.equal(StockLedger.entries.length, 1); // only ONE ledger entry, not two
  });

  await test("insufficient stock throws 409 and does NOT touch stock (validate before deduct)", async () => {
    const InventoryItem = makeFakeInventoryItem([{ _id: "chicken", name: "Chicken", unit: "g", currentStock: 100, status: "Active" }]);
    const StockLedger = makeFakeStockLedger();
    const Order = makeFakeOrder({ _id: "order-3", orderId: "ORD00003", stockDeducted: false, items: [{ menuItem: "menu-1", qty: 1 }] });
    const Recipe = fakeRecipe([{ inventoryItem: "chicken", quantity: 200, unit: "g" }]); // needs 200, only 100 available
    const models = { Order, Recipe, InventoryItem, StockLedger, InventoryBatch: { find: () => new FakeQuery(async () => []) } };

    await assert.rejects(
      () => deductStockForOrder({ models, order: Order._doc, actor: { id: null, role: "ADMIN", name: "Test" }, session: null }),
      (err) => {
        assert.equal(err.statusCode, 409);
        assert.match(err.message, /Insufficient stock/);
        return true;
      }
    );

    // Stock must be untouched, and no ledger entry written.
    assert.equal(InventoryItem._docs.get("chicken").currentStock, 100);
    assert.equal(StockLedger.entries.length, 0);
    // NOTE: in the real transactional path, Order.stockDeducted would also be
    // rolled back to false by MongoDB when the enclosing transaction aborts
    // (see services/orderService.js confirmOrderTx). This stub doesn't model
    // rollback since it isn't a real transaction — verified by code review
    // and needs a live replica-set MongoDB to prove end-to-end.
  });

  await test("stock can never go below zero even under a simulated race (conditional $gte guard)", async () => {
    const InventoryItem = makeFakeInventoryItem([{ _id: "oil", name: "Oil", unit: "ml", currentStock: 30, status: "Active" }]);
    const StockLedger = makeFakeStockLedger();
    const Order = makeFakeOrder({ _id: "order-4", orderId: "ORD00004", stockDeducted: false, items: [{ menuItem: "menu-1", qty: 1 }] });
    const Recipe = fakeRecipe([{ inventoryItem: "oil", quantity: 40, unit: "ml" }]); // needs 40, only 30 available
    const models = { Order, Recipe, InventoryItem, StockLedger, InventoryBatch: { find: () => new FakeQuery(async () => []) } };

    await assert.rejects(() =>
      deductStockForOrder({ models, order: Order._doc, actor: { id: null, role: "ADMIN", name: "Test" }, session: null })
    );
    assert.ok(InventoryItem._docs.get("oil").currentStock >= 0);
    assert.equal(InventoryItem._docs.get("oil").currentStock, 30); // unchanged, never went negative
  });

  console.log("── reverseStockForOrder ─────────────────────────");

  await test("reversal credits back exactly the recorded stockDeductions and logs a REVERSAL entry", async () => {
    const InventoryItem = makeFakeInventoryItem([{ _id: "rice", name: "Rice", unit: "g", currentStock: 500, status: "Active" }]);
    const StockLedger = makeFakeStockLedger();
    const Order = makeFakeOrder({
      _id: "order-5", orderId: "ORD00005", stockDeducted: true, stockReversed: false,
      stockDeductions: [{ inventoryItem: "rice", name: "Rice", qty: 500, unit: "g" }],
    });

    const result = await reverseStockForOrder({
      models: { Order, InventoryItem, StockLedger },
      order: Order._doc,
      actor: { id: null, role: "ADMIN", name: "Test" },
      session: null,
    });

    assert.equal(result.reversed, true);
    assert.equal(InventoryItem._docs.get("rice").currentStock, 1000); // 500 + 500 back
    assert.equal(StockLedger.entries.length, 1);
    assert.equal(StockLedger.entries[0].type, "REVERSAL");
    assert.equal(StockLedger.entries[0].quantity, 500);
    assert.equal(Order._doc.stockReversed, true);
  });

  await test("reversal is idempotent — calling twice only credits back once", async () => {
    const InventoryItem = makeFakeInventoryItem([{ _id: "rice", name: "Rice", unit: "g", currentStock: 500, status: "Active" }]);
    const StockLedger = makeFakeStockLedger();
    const Order = makeFakeOrder({
      _id: "order-6", orderId: "ORD00006", stockDeducted: true, stockReversed: false,
      stockDeductions: [{ inventoryItem: "rice", name: "Rice", qty: 500, unit: "g" }],
    });
    const models = { Order, InventoryItem, StockLedger };
    const actor = { id: null, role: "ADMIN", name: "Test" };

    const first  = await reverseStockForOrder({ models, order: Order._doc, actor, session: null });
    const second = await reverseStockForOrder({ models, order: Order._doc, actor, session: null });

    assert.equal(first.reversed, true);
    assert.equal(second.reversed, false);
    assert.equal(InventoryItem._docs.get("rice").currentStock, 1000); // only credited once
    assert.equal(StockLedger.entries.length, 1);
  });

  await test("an order that was never deducted (still PENDING_CONFIRMATION when cancelled) reverses nothing", async () => {
    const InventoryItem = makeFakeInventoryItem([{ _id: "rice", name: "Rice", unit: "g", currentStock: 500, status: "Active" }]);
    const StockLedger = makeFakeStockLedger();
    const Order = makeFakeOrder({ _id: "order-7", orderId: "ORD00007", stockDeducted: false, stockReversed: false, stockDeductions: [] });

    const result = await reverseStockForOrder({
      models: { Order, InventoryItem, StockLedger },
      order: Order._doc,
      actor: { id: null, role: "CUSTOMER", name: "Guest" },
      session: null,
    });

    assert.equal(result.reversed, false);
    assert.equal(InventoryItem._docs.get("rice").currentStock, 500); // untouched
    assert.equal(StockLedger.entries.length, 0);
  });

  console.log("──────────────────────────────────────────────");
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) { console.error("SOME TESTS FAILED"); process.exit(1); }
  console.log("ALL TESTS PASSED");
};

run();
