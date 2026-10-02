// test/recipeCosting.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Stock → recipe → making cost → order → consumption → stock → alert → revenue.
// Unit conversion (utils/units.js), recipe cost (utils/recipeCost.js), the
// unit-aware deduction + cost snapshot (inventoryService.deductStockForOrder),
// recipe save validation (inventoryService.saveRecipe) and the Insights sales
// breakdown (insightsService). In-memory model stubs — no MongoDB needed.
//   node test/recipeCosting.test.js
// ─────────────────────────────────────────────────────────────────────────────
import assert from "node:assert/strict";
import {
  convertQuantity, conversionFactor, toBaseUnit, normalizeUnit, areUnitsCompatible, compatibleUnits,
} from "../utils/units.js";
import { computeIngredientCost, computeRecipeCost } from "../utils/recipeCost.js";
import {
  deductStockForOrder, reverseStockForOrder, consumptionFromRecipes, saveRecipe,
  computeStockStatusForMenuItems,
} from "../services/inventoryService.js";
import { buildSalesBreakdown, revenueOrderMatch } from "../services/insightsService.js";
import { classifyStockLevel } from "../utils/inventoryConstants.js";

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.message}`); }
};

// ── in-memory stubs ─────────────────────────────────────────────────────────
class Q {
  constructor(exec) { this._exec = exec; }
  session() { return this; }
  lean() { return this; }
  select() { return this; }
  populate() { return this; }
  then(res, rej) { return this._exec().then(res, rej); }
}
const idsOf = (f) => (f?._id?.$in || []).map(String);

const makeInventory = (seed) => {
  const docs = new Map(seed.map((d) => [d._id, { status: "Active", reorderLevel: 0, criticalLevel: 0, ...d }]));
  const apply = (doc, update) => {
    if (update.$inc?.currentStock != null) doc.currentStock += update.$inc.currentStock;
    if (update.$set) Object.assign(doc, update.$set);
    return { ...doc };
  };
  return {
    _docs: docs,
    find(filter = {}) {
      return new Q(async () => [...docs.values()]
        .filter((d) => (filter._id ? idsOf(filter).includes(String(d._id)) : true))
        .filter((d) => (filter.status ? d.status === filter.status : true))
        .map((d) => ({ ...d })));
    },
    async findOneAndUpdate(filter, update) {
      const doc = docs.get(filter._id);
      if (!doc) return null;
      if (filter.currentStock?.$gte != null && doc.currentStock < filter.currentStock.$gte) return null;
      return apply(doc, update);
    },
    async findByIdAndUpdate(id, update) {
      const doc = docs.get(String(id));
      return doc ? apply(doc, update) : null;
    },
  };
};

const makeOrderModel = (seed) => {
  const doc = { stockDeducted: false, stockReversed: false, stockDeductions: [], ...seed };
  const setPath = (path, value) => {
    const parts = path.split(".");
    let cur = doc;
    for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
    cur[parts.at(-1)] = value;
  };
  return {
    _doc: doc,
    async findOneAndUpdate(filter, update) {
      if ("stockDeducted" in filter && doc.stockDeducted !== filter.stockDeducted) return null;
      if ("stockReversed" in filter && doc.stockReversed !== filter.stockReversed) return null;
      Object.entries(update.$set || {}).forEach(([k, v]) => setPath(k, v));
      return { ...doc };
    },
    async findByIdAndUpdate(_id, update) {
      Object.entries(update.$set || {}).forEach(([k, v]) => setPath(k, v));
      return { ...doc };
    },
  };
};

const makeRecipeModel = (recipes) => ({
  find: (filter) => new Q(async () => recipes.filter((r) =>
    (filter.menuItem?.$in || []).map(String).includes(String(r.menuItem)) && r.status === filter.status)),
});

const ledger = () => { const entries = []; return { entries, create: async (a) => { entries.push(...a); return a; } }; };
const NO_BATCH = { find: () => new Q(async () => []) };
const ADMIN = { id: null, role: "ADMIN", name: "Test" };

// The spec's acceptance-test stock: Milk 1 l ₹60, Tea Powder 1 kg ₹400, Sugar 1 kg ₹50.
const teaStock = () => makeInventory([
  { _id: "milk",  name: "Milk",       unit: "l",  currentStock: 1, costPrice: 60,  reorderLevel: 0.25 },
  { _id: "tea",   name: "Tea Powder", unit: "kg", currentStock: 1, costPrice: 400, reorderLevel: 0.1 },
  { _id: "sugar", name: "Sugar",      unit: "kg", currentStock: 1, costPrice: 50,  reorderLevel: 0.1 },
]);
const TEA_RECIPE = {
  menuItem: "menu-tea", status: "Active",
  ingredients: [
    { sourceType: "STOCK", inventoryItem: "milk",  quantity: 100, unit: "ml" },
    { sourceType: "STOCK", inventoryItem: "tea",   quantity: 5,   unit: "g" },
    { sourceType: "STOCK", inventoryItem: "sugar", quantity: 10,  unit: "g" },
  ],
};
const sellTea = async ({ InventoryItem, qty, recipes = [TEA_RECIPE], orderId = "o-1" }) => {
  const Order = makeOrderModel({ _id: orderId, orderId: "ORD1", items: [{ menuItem: "menu-tea", name: "Tea", price: 15, qty }] });
  const StockLedger = ledger();
  const models = { Order, Recipe: makeRecipeModel(recipes), InventoryItem, StockLedger, InventoryBatch: NO_BATCH };
  const result = await deductStockForOrder({ models, order: Order._doc, actor: ADMIN });
  return { result, Order, StockLedger, models };
};
const stockOf = (Inv, id) => Inv._docs.get(id).currentStock;

const run = async () => {
  console.log("── units ───────────────────────────────────────");

  await test("ml ↔ l and g ↔ kg convert by 1000", () => {
    assert.equal(convertQuantity(100, "ml", "l"), 0.1);
    assert.equal(convertQuantity(0.25, "l", "ml"), 250);
    assert.equal(convertQuantity(10, "g", "kg"), 0.01);
    assert.equal(convertQuantity(1.5, "kg", "g"), 1500);
    assert.equal(convertQuantity(2, "dozen", "pcs"), 24);
  });
  await test("aliases normalise (Litre, gm, pc) — no string-equality on units", () => {
    assert.equal(normalizeUnit("Litre"), "l");
    assert.equal(normalizeUnit(" GM "), "g");
    assert.equal(normalizeUnit("pc"), "pcs");
    assert.equal(convertQuantity(500, "ML", "Ltr"), 0.5);
  });
  await test("different dimensions refuse to convert (400, UNIT_MISMATCH)", () => {
    assert.throws(() => convertQuantity(5, "g", "ml"), (e) => e.statusCode === 400 && e.code === "UNIT_MISMATCH");
    assert.throws(() => convertQuantity(1, "packet", "box"));
    assert.equal(areUnitsCompatible("kg", "g"), true);
    assert.equal(areUnitsCompatible("kg", "l"), false);
    assert.deepEqual(compatibleUnits("l").sort(), ["l", "ml"]);
  });
  await test("decimal quantities keep precision (0.1 l × 3 = 0.3 l, no float residue)", () => {
    assert.equal(convertQuantity(300, "ml", "l"), 0.3);
    assert.deepEqual(toBaseUnit(0.25, "l"), { qty: 250, unit: "ml" });
    assert.equal(conversionFactor("ml", "l"), 0.001);
  });

  console.log("── ingredient + recipe cost ─────────────────────");

  await test("Milk ₹60/l: 100 ml → ₹6, 250 ml → ₹15, 500 ml → ₹30; unit cost ₹0.06/ml", () => {
    const milk = { name: "Milk", unit: "l", costPrice: 60 };
    assert.equal(computeIngredientCost({ quantity: 100, unit: "ml" }, milk).cost, 6);
    assert.equal(computeIngredientCost({ quantity: 250, unit: "ml" }, milk).cost, 15);
    assert.equal(computeIngredientCost({ quantity: 500, unit: "ml" }, milk).cost, 30);
    assert.equal(computeIngredientCost({ quantity: 100, unit: "ml" }, milk).unitCost, 0.06);
  });
  await test("Sugar ₹50/kg: 10 g → ₹0.50; same-unit quantity (1 kg) → ₹50", () => {
    const sugar = { name: "Sugar", unit: "kg", costPrice: 50 };
    assert.equal(computeIngredientCost({ quantity: 10, unit: "g" }, sugar).cost, 0.5);
    assert.equal(computeIngredientCost({ quantity: 1, unit: "kg" }, sugar).cost, 50);
    assert.equal(computeIngredientCost({ quantity: 0.25, unit: "kg" }, sugar).cost, 12.5);
  });
  await test("ACCEPTANCE: Tea making cost = ₹6 + ₹2 + ₹0.50 = ₹8.50", () => {
    const byId = new Map([...teaStock()._docs.values()].map((d) => [d._id, d]));
    const { lines, totalCost, incomplete } = computeRecipeCost(TEA_RECIPE.ingredients, byId);
    assert.deepEqual(lines.map((l) => l.cost), [6, 2, 0.5]);
    assert.equal(totalCost, 8.5);
    assert.equal(incomplete, false);
  });
  await test("stock + custom ingredients: Tea + Cardamom ₹1.50 → ₹10.00", () => {
    const byId = new Map([...teaStock()._docs.values()].map((d) => [d._id, d]));
    const ings = [...TEA_RECIPE.ingredients, { sourceType: "CUSTOM", name: "Cardamom", quantity: 2, unit: "g", cost: 1.5 }];
    const { lines, totalCost } = computeRecipeCost(ings, byId);
    assert.equal(lines[3].cost, 1.5);
    assert.equal(lines[3].unitCost, 0.75);
    assert.equal(totalCost, 10);
  });
  await test("only custom ingredients cost without any stock lookup", () => {
    const { totalCost, incomplete } = computeRecipeCost([
      { sourceType: "CUSTOM", name: "Cardamom", quantity: 1, unit: "g", cost: 0.3 },
      { sourceType: "CUSTOM", name: "Water", quantity: 200, unit: "ml", cost: 0 },
    ]);
    assert.equal(totalCost, 0.3);
    assert.equal(incomplete, false);
  });
  await test("stock item without a cost price is flagged, never silently ₹0", () => {
    const r = computeIngredientCost({ quantity: 5, unit: "g" }, { name: "Salt", unit: "kg", costPrice: 0 });
    assert.equal(r.cost, null);
    assert.equal(r.costMissing, true);
    assert.match(r.error, /No cost price/);
    const { incomplete } = computeRecipeCost([{ inventoryItem: "salt", quantity: 5, unit: "g" }], new Map([["salt", { name: "Salt", unit: "kg", costPrice: 0 }]]));
    assert.equal(incomplete, true);
  });
  await test("incompatible unit is a cost error, not a guess", () => {
    const r = computeIngredientCost({ quantity: 5, unit: "ml" }, { name: "Sugar", unit: "kg", costPrice: 50 });
    assert.equal(r.costMissing, true);
    assert.match(r.error, /Cannot convert/);
  });

  console.log("── consumption + deduction ──────────────────────");

  await test("ACCEPTANCE: 10 Teas consume 1000 ml / 50 g / 100 g → Milk 0, Tea 950 g, Sugar 900 g", async () => {
    const Inv = teaStock();
    const { result, Order, StockLedger } = await sellTea({ InventoryItem: Inv, qty: 10 });
    assert.equal(result.deducted, true);
    assert.equal(stockOf(Inv, "milk"), 0);
    assert.equal(convertQuantity(stockOf(Inv, "tea"), "kg", "g"), 950);
    assert.equal(convertQuantity(stockOf(Inv, "sugar"), "kg", "g"), 900);
    // Ledger + reversal records are in the stock item's own unit.
    assert.deepEqual(StockLedger.entries.map((e) => [e.type, e.quantity]), [
      ["SALE_DEDUCTION", -1], ["SALE_DEDUCTION", -0.05], ["SALE_DEDUCTION", -0.1],
    ]);
    assert.deepEqual(Order._doc.stockDeductions.map((d) => d.unit), ["l", "kg", "kg"]);
    // Making cost snapshot for COGS: ₹8.50 per Tea.
    assert.equal(Order._doc.items[0].makingCost, 8.5);
    // Milk hit 0 → OUT_OF_STOCK alert raised from the sale itself.
    assert.ok(result.alerts.some((a) => a.item.name === "Milk" && a.level === "OUT_OF_STOCK"));
  });
  await test("1 Tea and 5 Teas scale linearly (100 ml / 500 ml of Milk)", async () => {
    let Inv = teaStock();
    await sellTea({ InventoryItem: Inv, qty: 1 });
    assert.equal(stockOf(Inv, "milk"), 0.9);
    Inv = teaStock();
    await sellTea({ InventoryItem: Inv, qty: 5 });
    assert.equal(stockOf(Inv, "milk"), 0.5);
    assert.equal(convertQuantity(stockOf(Inv, "tea"), "kg", "g"), 975);
  });
  await test("Dashboard example: 500 ml Milk, 3 Teas → 200 ml left, below 250 ml threshold → LOW", async () => {
    const Inv = makeInventory([
      { _id: "milk", name: "Milk", unit: "l", currentStock: 0.5, costPrice: 60, reorderLevel: 0.25 },
      { _id: "tea", name: "Tea Powder", unit: "kg", currentStock: 1, costPrice: 400 },
      { _id: "sugar", name: "Sugar", unit: "kg", currentStock: 1, costPrice: 50 },
    ]);
    const { result } = await sellTea({ InventoryItem: Inv, qty: 3 });
    assert.equal(stockOf(Inv, "milk"), 0.2); // exactly — no 0.19999… residue
    assert.equal(convertQuantity(stockOf(Inv, "milk"), "l", "ml"), 200);
    const milk = Inv._docs.get("milk");
    assert.equal(classifyStockLevel(milk.currentStock, milk.reorderLevel, milk.criticalLevel), "LOW");
    assert.ok(result.alerts.some((a) => a.item.name === "Milk" && a.level === "LOW"));
  });
  await test("decimal quantity: 0.25 l per serving × 3 = 0.75 l", async () => {
    const Inv = makeInventory([{ _id: "milk", name: "Milk", unit: "l", currentStock: 1, costPrice: 60 }]);
    const recipe = { menuItem: "menu-tea", status: "Active", ingredients: [{ inventoryItem: "milk", quantity: 0.25, unit: "l" }] };
    const { Order } = await sellTea({ InventoryItem: Inv, qty: 3, recipes: [recipe] });
    assert.equal(stockOf(Inv, "milk"), 0.25);
    assert.equal(Order._doc.items[0].makingCost, 15);
  });
  await test("one stock item in different units across two recipes sums correctly", () => {
    const recipes = [
      { menuItem: "tea", ingredients: [{ inventoryItem: "milk", quantity: 100, unit: "ml" }] },
      { menuItem: "shake", ingredients: [{ inventoryItem: "milk", quantity: 0.3, unit: "l" }] },
    ];
    const c = consumptionFromRecipes(recipes, [{ menuItem: "tea", qty: 2 }, { menuItem: "shake", qty: 1 }]);
    assert.deepEqual(c, [{ inventoryItem: "milk", unit: "ml", qty: 500 }]);
  });
  await test("custom ingredients are never deducted; custom-only recipes still snapshot cost", async () => {
    const Inv = teaStock();
    const recipe = { menuItem: "menu-tea", status: "Active", ingredients: [{ sourceType: "CUSTOM", name: "Cardamom", quantity: 1, unit: "g", cost: 0.3 }] };
    const { result, Order, StockLedger } = await sellTea({ InventoryItem: Inv, qty: 4, recipes: [recipe] });
    assert.equal(result.deductions.length, 0);
    assert.equal(StockLedger.entries.length, 0);
    assert.equal(stockOf(Inv, "milk"), 1);
    assert.equal(Order._doc.items[0].makingCost, 0.3);
  });
  await test("out of stock: an order needing more than is left is refused, nothing moves", async () => {
    const Inv = teaStock();
    await assert.rejects(() => sellTea({ InventoryItem: Inv, qty: 11 }), (e) => e.statusCode === 409 && /Milk/.test(e.message));
    assert.equal(stockOf(Inv, "milk"), 1);
    assert.equal(stockOf(Inv, "tea"), 1);
  });
  await test("duplicate processing: deducting the same order twice deducts once", async () => {
    const Inv = teaStock();
    const { Order, models } = await sellTea({ InventoryItem: Inv, qty: 2 });
    const second = await deductStockForOrder({ models, order: Order._doc, actor: ADMIN });
    assert.equal(second.deducted, false);
    assert.equal(stockOf(Inv, "milk"), 0.8);
  });
  await test("cancellation reverses exactly what was deducted, once", async () => {
    const Inv = teaStock();
    const { Order, models } = await sellTea({ InventoryItem: Inv, qty: 3 });
    assert.equal(stockOf(Inv, "milk"), 0.7);
    await reverseStockForOrder({ models, order: { ...Order._doc }, actor: ADMIN });
    await reverseStockForOrder({ models, order: { ...Order._doc }, actor: ADMIN });
    assert.equal(stockOf(Inv, "milk"), 1);
    assert.equal(stockOf(Inv, "sugar"), 1);
  });
  await test("price change after a sale does not change that sale's snapshot cost", async () => {
    const Inv = teaStock();
    const { Order } = await sellTea({ InventoryItem: Inv, qty: 1 });
    Inv._docs.get("milk").costPrice = 120; // milk price doubles later
    assert.equal(Order._doc.items[0].makingCost, 8.5);
    const byId = new Map([...Inv._docs.values()].map((d) => [d._id, d]));
    assert.equal(computeRecipeCost(TEA_RECIPE.ingredients, byId).totalCost, 14.5); // live cost moves
  });
  await test("legacy recipe (no sourceType, same unit as stock) still deducts", async () => {
    const Inv = makeInventory([{ _id: "rice", name: "Rice", unit: "g", currentStock: 1000, costPrice: 0.1 }]);
    const recipe = { menuItem: "menu-tea", status: "Active", ingredients: [{ inventoryItem: "rice", quantity: 250, unit: "g" }] };
    await sellTea({ InventoryItem: Inv, qty: 2, recipes: [recipe] });
    assert.equal(stockOf(Inv, "rice"), 500);
  });
  await test("menu stock status converts units (1 Tea needs 100 ml of the 50 ml left → out)", async () => {
    const Inv = makeInventory([{ _id: "milk", name: "Milk", unit: "l", currentStock: 0.05, costPrice: 60 }]);
    const recipe = { menuItem: "menu-tea", status: "Active", ingredients: [{ inventoryItem: "milk", quantity: 100, unit: "ml" }] };
    const Recipe = { find: () => new Q(async () => [recipe]) };
    const status = await computeStockStatusForMenuItems({ models: { Recipe, InventoryItem: Inv }, menuItemIds: ["menu-tea"] });
    assert.equal(status.get("menu-tea").inStock, false);
    Inv._docs.get("milk").currentStock = 0.1;
    const again = await computeStockStatusForMenuItems({ models: { Recipe, InventoryItem: Inv }, menuItemIds: ["menu-tea"] });
    assert.equal(again.get("menu-tea").inStock, true);
  });

  console.log("── saveRecipe validation ────────────────────────");

  const saveModels = () => {
    const Inv = teaStock();
    let saved = null;
    return {
      get saved() { return saved; },
      models: {
        InventoryItem: Inv,
        MenuItem: { findById: (id) => new Q(async () => (id === "menu-tea" ? { _id: "menu-tea", name: "Tea", price: 15 } : null)) },
        Recipe: { findOneAndUpdate: async (_f, doc) => { saved = doc; return doc; } },
      },
    };
  };
  const save = (ctx, ingredients) => saveRecipe({ models: ctx.models, body: { menuItem: "menu-tea", ingredients } });

  await test("saves stock + custom lines with a server-derived cost snapshot (₹8.50 + ₹1.50)", async () => {
    const ctx = saveModels();
    await save(ctx, [
      { sourceType: "STOCK", inventoryItem: "milk", quantity: 100, unit: "ml", cost: 9999 }, // client cost ignored
      { sourceType: "STOCK", inventoryItem: "tea", quantity: 5, unit: "g" },
      { sourceType: "STOCK", inventoryItem: "sugar", quantity: 10, unit: "g" },
      { sourceType: "CUSTOM", name: "Cardamom", quantity: 2, unit: "g", cost: 1.5 },
    ]);
    assert.equal(ctx.saved.totalCost, 10);
    assert.deepEqual(ctx.saved.ingredients.map((i) => i.cost), [6, 2, 0.5, 1.5]);
    assert.equal(ctx.saved.ingredients[0].name, "Milk");
    assert.equal(ctx.saved.ingredients[3].inventoryItem, null);
  });
  await test("rejects zero/negative quantity and negative price", async () => {
    await assert.rejects(() => save(saveModels(), [{ inventoryItem: "milk", quantity: 0, unit: "ml" }]), /greater than 0/);
    await assert.rejects(() => save(saveModels(), [{ inventoryItem: "milk", quantity: -5, unit: "ml" }]), /greater than 0/);
    await assert.rejects(() => save(saveModels(), [{ sourceType: "CUSTOM", name: "X", quantity: 1, unit: "g", cost: -1 }]), /price/);
    await assert.rejects(() => save(saveModels(), [{ sourceType: "CUSTOM", name: "X", quantity: 1, unit: "g", cost: "" }]), /price/);
  });
  await test("rejects a unit that can't convert to the stock unit (Milk in g)", async () => {
    await assert.rejects(() => save(saveModels(), [{ inventoryItem: "milk", quantity: 100, unit: "g" }]), /stocked in l/);
  });
  await test("rejects duplicate stock lines and duplicate custom names", async () => {
    await assert.rejects(() => save(saveModels(), [
      { inventoryItem: "milk", quantity: 100, unit: "ml" }, { inventoryItem: "milk", quantity: 0.1, unit: "l" },
    ]), /listed twice/);
    await assert.rejects(() => save(saveModels(), [
      { sourceType: "CUSTOM", name: "Cardamom", quantity: 1, unit: "g", cost: 1 },
      { sourceType: "CUSTOM", name: "cardamom ", quantity: 1, unit: "g", cost: 1 },
    ]), /listed twice/);
  });
  await test("rejects a custom ingredient named like an existing stock item", async () => {
    await assert.rejects(() => save(saveModels(), [{ sourceType: "CUSTOM", name: "milk", quantity: 1, unit: "ml", cost: 1 }]), /is a stock item/);
  });
  await test("rejects unknown menu item and empty ingredient list", async () => {
    const ctx = saveModels();
    await assert.rejects(() => saveRecipe({ models: ctx.models, body: { menuItem: "nope", ingredients: [{ inventoryItem: "milk", quantity: 1, unit: "ml" }] } }), /Menu item not found/);
    await assert.rejects(() => save(ctx, []), /at least one/);
  });

  console.log("── Insights sales breakdown ─────────────────────");

  await test("revenue counts only PAID, non-cancelled orders", () => {
    const m = revenueOrderMatch({ from: new Date("2026-01-01"), to: new Date("2026-01-31") });
    assert.deepEqual(m.status, { $ne: "CANCELLED" });
    assert.equal(m.paymentStatus, "PAID");
    assert.ok(m.createdAt.$gte && m.createdAt.$lte);
  });

  const menuById = new Map([
    ["tea", { name: "Tea", category: "Beverages" }],
    ["coffee", { name: "Coffee", category: "Beverages" }],
    ["burger", { name: "Burger", category: "Food" }],
    ["cake", { name: "Cake", category: "Desserts" }],
  ]);

  await test("ACCEPTANCE: 10 Teas at ₹15 → ₹150 revenue, ₹85 cost, ₹65 profit, under Beverages", () => {
    const rows = [{ _id: "tea", name: "Tea", qty: 10, revenue: 150, costedQty: 10, snapshotCost: 85 }];
    const b = buildSalesBreakdown({ rows, menuById, liveCostByMenuItem: new Map() });
    assert.deepEqual(
      { revenue: b.items[0].revenue, makingCost: b.items[0].makingCost, grossProfit: b.items[0].grossProfit, category: b.items[0].category },
      { revenue: 150, makingCost: 85, grossProfit: 65, category: "Beverages" },
    );
    assert.deepEqual(b.categories, [{ category: "Beverages", qty: 10, items: 1, revenue: 150, makingCost: 85, grossProfit: 65 }]);
    assert.equal(b.totals.grossMarginPct, 43.3);
  });
  await test("category totals equal item totals across multiple categories", () => {
    const rows = [
      { _id: "tea", qty: 100, revenue: 1500, costedQty: 100, snapshotCost: 850 },
      { _id: "coffee", qty: 50, revenue: 1250, costedQty: 0, snapshotCost: 0 },
      { _id: "burger", qty: 20, revenue: 2400, costedQty: 20, snapshotCost: 1000 },
      { _id: "cake", qty: 5, revenue: 500, costedQty: 0, snapshotCost: 0 },
      { _id: "gone", name: "Old special", qty: 2, revenue: 100, costedQty: 0, snapshotCost: 0 },
    ];
    const b = buildSalesBreakdown({ rows, menuById, liveCostByMenuItem: new Map([["coffee", 10]]) });
    const itemSum = b.items.reduce((s, i) => s + i.revenue, 0);
    const catSum = b.categories.reduce((s, c) => s + c.revenue, 0);
    assert.equal(itemSum, catSum);
    assert.equal(itemSum, b.totals.revenue);
    assert.deepEqual(b.categories.map((c) => c.category), ["Beverages", "Food", "Desserts", "Uncategorised"]);
    assert.equal(b.categories[0].revenue, 2750);
    // Coffee had no snapshot → estimated from today's recipe cost.
    const coffee = b.items.find((i) => i.name === "Coffee");
    assert.equal(coffee.makingCost, 500);
    assert.equal(coffee.costEstimated, true);
    // Cake has no recipe → no cost (null, not ₹0), counted as uncosted.
    const cake = b.items.find((i) => i.name === "Cake");
    assert.equal(cake.makingCost, null);
    assert.equal(cake.grossProfit, null);
    assert.equal(b.totals.itemsWithoutCost, 2);
    // Profit only over revenue whose cost is known: 1500+1250+2400 − (850+500+1000).
    assert.equal(b.totals.grossProfit, 2800);
  });
  await test("recipe edited after earlier sales: old snapshots kept, only uncosted units estimated", () => {
    const rows = [{ _id: "tea", qty: 10, revenue: 150, costedQty: 6, snapshotCost: 6 * 8.5 }];
    const b = buildSalesBreakdown({ rows, menuById, liveCostByMenuItem: new Map([["tea", 12]]) });
    assert.equal(b.items[0].makingCost, 51 + 4 * 12);
    assert.equal(b.items[0].costEstimated, true);
  });
  await test("many items: every sold item is returned, sorted by revenue", () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ _id: `m${i}`, name: `Item ${i}`, qty: 1, revenue: i, costedQty: 0, snapshotCost: 0 }));
    const b = buildSalesBreakdown({ rows, menuById: new Map(), liveCostByMenuItem: new Map() });
    assert.equal(b.items.length, 250);
    assert.equal(b.items[0].revenue, 249);
    assert.equal(b.categories.length, 1);
  });

  console.log("──────────────────────────────────────────────");
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) { console.error("SOME TESTS FAILED"); process.exit(1); }
  console.log("ALL TESTS PASSED");
};

run();
