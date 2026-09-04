// test/inventoryLogic.test.js
// ─────────────────────────────────────────────────────────────────────────────
// DB-independent tests for inventory logic: recipe→ingredient aggregation
// (calculateRecipeConsumption) and stock-level classification. Run with:
//   node test/inventoryLogic.test.js
// ─────────────────────────────────────────────────────────────────────────────

import assert from "node:assert/strict";
import { classifyStockLevel } from "../utils/inventoryConstants.js";
import { calculateRecipeConsumption } from "../services/inventoryService.js";

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.message}`); }
};

const run = async () => {
  console.log("── classifyStockLevel ──────────────────────────");

  await test("above reorder level is OK", () => {
    assert.equal(classifyStockLevel(50, 10, 5), "OK");
  });
  await test("at/below reorder but above critical is LOW", () => {
    assert.equal(classifyStockLevel(10, 10, 5), "LOW");
    assert.equal(classifyStockLevel(6, 10, 5), "LOW");
  });
  await test("at/below critical is CRITICAL", () => {
    assert.equal(classifyStockLevel(5, 10, 5), "CRITICAL");
    assert.equal(classifyStockLevel(1, 10, 5), "CRITICAL");
  });
  await test("zero or negative is OUT_OF_STOCK, takes priority over everything", () => {
    assert.equal(classifyStockLevel(0, 10, 5), "OUT_OF_STOCK");
    assert.equal(classifyStockLevel(-2, 10, 5), "OUT_OF_STOCK");
  });
  await test("null thresholds don't misclassify", () => {
    assert.equal(classifyStockLevel(50, null, null), "OK");
  });

  console.log("── calculateRecipeConsumption ──────────────────");

  // Fake Recipe model — mimics Mongoose's find() returning plain-ish docs.
  const chickenBiryaniId = "menu-chicken-biryani";
  const coldCoffeeId = "menu-cold-coffee";
  const noRecipeMenuItemId = "menu-plain-water";

  const fakeRecipes = [
    {
      menuItem: chickenBiryaniId,
      status: "Active",
      ingredients: [
        { inventoryItem: "inv-rice",    quantity: 250, unit: "g" },
        { inventoryItem: "inv-chicken", quantity: 200, unit: "g" },
        { inventoryItem: "inv-oil",     quantity: 30,  unit: "ml" },
        { inventoryItem: "inv-spices",  quantity: 20,  unit: "g" },
      ],
    },
    {
      menuItem: coldCoffeeId,
      status: "Active",
      ingredients: [
        { inventoryItem: "inv-milk",   quantity: 150, unit: "ml" },
        { inventoryItem: "inv-coffee", quantity: 10,  unit: "g" },
      ],
    },
  ];

  const Recipe = {
    find: async ({ menuItem, status }) => {
      const ids = menuItem.$in.map(String);
      return fakeRecipes.filter((r) => ids.includes(String(r.menuItem)) && r.status === status);
    },
  };

  await test("aggregates a single menu item's ingredients scaled by qty", async () => {
    const order = { items: [{ menuItem: chickenBiryaniId, qty: 2 }] };
    const consumption = await calculateRecipeConsumption({ Recipe, order });
    const byId = Object.fromEntries(consumption.map((c) => [String(c.inventoryItem), c.qty]));
    assert.equal(byId["inv-rice"], 500);     // 250 * 2
    assert.equal(byId["inv-chicken"], 400);  // 200 * 2
    assert.equal(byId["inv-oil"], 60);       // 30 * 2
    assert.equal(byId["inv-spices"], 40);    // 20 * 2
    assert.equal(consumption.length, 4);
  });

  await test("sums a shared ingredient across two different order lines", async () => {
    // Both dishes could plausibly share an ingredient id in a real menu;
    // simulate that directly to test the aggregation-by-key logic.
    const sharedRecipes = [
      { menuItem: "a", status: "Active", ingredients: [{ inventoryItem: "inv-rice", quantity: 100, unit: "g" }] },
      { menuItem: "b", status: "Active", ingredients: [{ inventoryItem: "inv-rice", quantity: 50,  unit: "g" }] },
    ];
    const SharedRecipe = {
      find: async ({ menuItem, status }) => {
        const ids = menuItem.$in.map(String);
        return sharedRecipes.filter((r) => ids.includes(r.menuItem) && r.status === status);
      },
    };
    const order = { items: [{ menuItem: "a", qty: 3 }, { menuItem: "b", qty: 1 }] };
    const consumption = await calculateRecipeConsumption({ Recipe: SharedRecipe, order });
    assert.equal(consumption.length, 1);
    assert.equal(consumption[0].qty, 100 * 3 + 50 * 1); // 350
  });

  await test("menu items with no active recipe are skipped, not errored", async () => {
    const order = { items: [{ menuItem: noRecipeMenuItemId, qty: 5 }] };
    const consumption = await calculateRecipeConsumption({ Recipe, order });
    assert.equal(consumption.length, 0);
  });

  await test("mixed order: recipe-tracked + non-tracked items in one order", async () => {
    const order = { items: [
      { menuItem: chickenBiryaniId, qty: 1 },
      { menuItem: noRecipeMenuItemId, qty: 2 },
      { menuItem: coldCoffeeId, qty: 1 },
    ] };
    const consumption = await calculateRecipeConsumption({ Recipe, order });
    // 4 biryani ingredients + 2 cold-coffee ingredients = 6, water contributes 0
    assert.equal(consumption.length, 6);
  });

  console.log("──────────────────────────────────────────────");
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) { console.error("SOME TESTS FAILED"); process.exit(1); }
  console.log("ALL TESTS PASSED");
};

run();
