import test from "node:test";
import assert from "node:assert/strict";
import * as c from "../utils/inventoryV3Calculations.js";

test("decimal money rounds half away from zero without binary floating drift", () => {
  assert.equal(c.rupeesToPaise("1.005"), 101);
  assert.equal(c.rupeesToPaise("-1.005"), -101);
  assert.equal(c.rupeesToPaise("0.29"), 29);
  assert.equal(c.rupeesToPaise(0.29), 29);
  assert.equal(c.sumPaise([29, 101, -30]), 100);
});
test("rejects malformed, excessive-precision and unsafe values", () => {
  for (const value of [null, undefined, "", " 1", "1e3", true, {}, NaN, Infinity, "0.0000001", "9007199254740992"])
    assert.throws(() => c.rupeesToPaise(value));
  assert.throws(() => c.sumPaise([Number.MAX_SAFE_INTEGER, 1]), /safe/);
  assert.throws(() => c.sumPaise([1.5]));
});
test("unit conversion uses existing aliases and preserves fractional quantities", () => {
  assert.equal(c.convertedQuantityMicros("150", "g", "kg"), 150000);
  assert.equal(c.convertedQuantityMicros("0.5", "dozen", "pcs"), 6000000);
  assert.equal(c.convertedQuantityMicros("1", "pcs", "dozen"), 83333);
  assert.equal(c.convertedQuantityMicros("1", "litre", "ml"), 1000000000);
  assert.throws(() => c.convertedQuantityMicros("1", "kg", "l"));
  assert.throws(() => c.convertedQuantityMicros("1", "unknown", "unknown"));
  assert.equal(c.quantityMicros("-0.000001", true), -1);
  assert.throws(() => c.quantityMicros("-1"));
});
test("recipe lines retain sub-paisa rates and round only the final line", () => {
  assert.equal(c.lineAmountPaise({ quantity: "150", unit: "g", stockUnit: "kg", unitRateRupees: "240" }), 3600);
  assert.equal(c.lineAmountPaise({ quantity: "25", unit: "ml", stockUnit: "l", unitRateRupees: "145" }), 363);
  assert.equal(c.lineAmountPaise({ quantity: "150", unit: "g", unitRateRupees: "0.052" }), 780);
  assert.equal(c.lineAmountPaise({ quantity: "1", unit: "pcs", stockUnit: "dozen", unitRateRupees: "12" }), 100);
});
test("purchase totals sum independently rounded lines", () => {
  assert.deepEqual(c.purchaseTotals([
    { quantity: "5", unit: "kg", unitRateRupees: "200" },
    { quantity: "200", unit: "pcs", unitRateRupees: "3" },
  ]), { amountsPaise: [100000, 60000], totalPaise: 160000 });
  assert.equal(c.purchaseTotals(Array.from({ length: 3 }, () => ({ quantity: "0.5", unit: "kg", unitRateRupees: "0.01" }))).totalPaise, 3);
  assert.throws(() => c.purchaseTotals([]));
  assert.throws(() => c.purchaseTotals([{ quantity: "0", unit: "kg", unitRateRupees: "1" }]));
  assert.throws(() => c.purchaseTotals([{ quantity: "1", unit: "kg", unitRateRupees: "-1" }]));
});
test("stock valuation excludes inactive items and reports missing costs", () => {
  const result = c.stockValuation([
    { id: "rice", quantity: "2", unit: "kg", unitRateRupees: "95" },
    { id: "oil", quantity: "1", unit: "l", unitRateRupees: null },
    { id: "old", status: "Inactive", quantity: "1", unit: "pcs", unitRateRupees: "99" },
  ]);
  assert.equal(result.totalPaise, null);
  assert.equal(result.knownValuePaise, 19000);
  assert.deepEqual(result.missing, ["oil"]);
  assert.equal(c.stockValuation([]).totalPaise, 0);
});
test("recipe cost supports custom ingredients and distinguishes zero from unknown", () => {
  const lines = [{ sourceType: "STOCK", quantity: "100", unit: "ml", stockUnit: "l", unitRateRupees: "60" }, { sourceType: "CUSTOM", costPaise: 50 }];
  assert.equal(c.recipeCost(lines).totalPaise, 650);
  assert.equal(c.recipeCost([{ sourceType: "CUSTOM", costPaise: 0 }]).complete, true);
  assert.equal(c.recipeCost([...lines, { quantity: "1", unit: "pcs" }]).totalPaise, null);
  assert.equal(c.recipeCost([]).complete, false);
  assert.throws(() => c.recipeCost([{ sourceType: "INVALID" }]));
});
test("actual revenue subtracts discounts/write-offs once and includes service charge", () => {
  assert.equal(c.actualRevenue({ subtotalPaise: 500000, discountPaise: 20000, serviceChargePaise: 10000, writeOffPaise: 1000 }), 489000);
  assert.throws(() => c.actualRevenue({ subtotalPaise: 1, discountPaise: -1 }));
});
test("food-cost target colour boundaries use exact ratios", () => {
  const status = (foodCostPaise) => c.foodCostStatus({ foodCostPaise, revenuePaise: 100000 });
  assert.equal(status(35000).tone, "green");
  assert.equal(status(35001).tone, "amber"); // display still rounds to 35.00
  assert.equal(status(40000).tone, "amber");
  assert.equal(status(40001).tone, "red");
  assert.equal(status(39000).differenceBps, 400);
  assert.equal(status(30000).differenceBps, -500);
  for (const revenuePaise of [0, -1]) assert.equal(c.foodCostStatus({ foodCostPaise: 10, revenuePaise }).tone, "unavailable");
  assert.equal(c.foodCostStatus({ foodCostPaise: null, revenuePaise: 100 }).percentBps, null);
  assert.equal(c.foodCostStatus({ foodCostPaise: 10, revenuePaise: 100, complete: false }).percentBps, null);
  assert.throws(() => c.foodCostStatus({ foodCostPaise: 10, revenuePaise: 100, targetBps: 0 }));
});
test("actual COGS is count valuation plus purchases less closing stock", () => {
  assert.deepEqual(c.actualFoodCost({ openingValuePaise: 100000, purchasesPaise: 50000, closingValuePaise: 70000, adjustmentsPaise: -5000 }), { amountPaise: 75000, complete: true, reason: null });
  assert.equal(c.actualFoodCost({ openingValuePaise: null, purchasesPaise: 0, closingValuePaise: 0 }).complete, false);
  assert.equal(c.actualFoodCost({ openingValuePaise: 0, purchasesPaise: 0, closingValuePaise: 100 }).reason, "NEGATIVE_CONSUMPTION");
});
test("count reconciliation separates known loss, unexplained shortage and gains", () => {
  const base = { openingQty: "10", purchasedQty: "4", reversalQty: "1", recipeQty: "5", knownLossQty: "1", countedQty: "8", unitRateRupees: "60", unit: "kg" };
  assert.deepEqual(c.reconcileCount(base), { actualUsedMicros: 7000000, expectedUsedMicros: 6000000, varianceMicros: 1000000, lossPaise: 6000, gainPaise: 0, complete: true });
  assert.equal(c.reconcileCount({ ...base, countedQty: "9" }).lossPaise, 0);
  assert.equal(c.reconcileCount({ ...base, countedQty: "10" }).gainPaise, 6000);
  assert.equal(c.reconcileCount({ ...base, complete: false }).lossPaise, null);
  assert.equal(c.reconcileCount({ ...base, unitRateRupees: null }).complete, false);
  assert.equal(c.reconcileCount({ ...base, countedQty: "20" }).varianceMicros, null);
});
test("supplier due excludes owner loans and already settled bills", () => {
  assert.equal(c.supplierDues([{ to: "SUPPLIER", amountPaise: 1000 }, { to: "OWNER", amountPaise: 2000 }, { to: "SUPPLIER", amountPaise: 3000, settledAt: "2026-10-24" }]), 1000);
});
test("days remaining uses observed consumption and never divides by zero", () => {
  assert.equal(c.stockDays({ stockQty: "3", consumedQty: "7", observedDays: 14 }), 6);
  assert.equal(c.stockDays({ stockQty: "0", consumedQty: "7", observedDays: 14 }), 0);
  assert.equal(c.stockDays({ stockQty: "3", consumedQty: "0", observedDays: 14 }), null);
  assert.equal(c.stockDays({ stockQty: "3", consumedQty: "7", observedDays: 0 }), null);
  assert.equal(c.stockDays({ stockQty: "3", consumedQty: "7", observedDays: 14, complete: false }), null);
});
test("books checks count unavailable evidence as incomplete", () => {
  assert.deepEqual(c.booksComplete([{ status: "complete" }, { status: "missing" }, { status: "unavailable" }, { applicable: false, status: "missing" }]), { done: 1, total: 3, percentBps: 3333 });
  assert.equal(c.booksComplete([]).percentBps, null);
});
test("group totals preserve the purchase sum and missing classifications", () => {
  assert.deepEqual(c.groupedSpend([{ group: "Dairy", amountPaise: 6000 }, { group: "Dairy", amountPaise: 500 }, { amountPaise: 200 }]), { groups: [{ group: "Dairy", amountPaise: 6500 }, { group: "Uncategorised", amountPaise: 200 }], totalPaise: 6700 });
});
test("annual expense and depreciation schedules preserve every paisa", () => {
  assert.deepEqual(c.allocateCost({ basisPaise: 100, periods: 3 }), [34, 33, 33]);
  assert.deepEqual(c.allocateCost({ basisPaise: 100, residualPaise: 10, periods: 3 }), [30, 30, 30]);
  assert.equal(c.allocateCost({ basisPaise: 3000000, periods: 60 })[0], 50000);
  for (let n = 1; n <= 60; n++) assert.equal(c.sumPaise(c.allocateCost({ basisPaise: 10001, periods: n })), 10001);
  assert.throws(() => c.allocateCost({ basisPaise: 1, periods: 0 }));
  assert.throws(() => c.allocateCost({ basisPaise: 1, residualPaise: 2, periods: 12 }));
});
test("dish allocation calculates overhead, plate profit, period profit and margin", () => {
  assert.deepEqual(c.dishProfit({ pricePaise: 14000, recipeCostPaise: 6200, runningCostsPaise: 32800, revenuePaise: 100000, soldQty: "3" }), { overheadPaise: 4592, profitPerPlatePaise: 3208, periodProfitPaise: 9624, marginBps: 2291, complete: true });
  assert.equal(c.dishProfit({ pricePaise: 100, recipeCostPaise: 150, runningCostsPaise: 0, revenuePaise: 100 }).profitPerPlatePaise, -50);
  assert.equal(c.dishProfit({ pricePaise: 100, recipeCostPaise: null, runningCostsPaise: 0, revenuePaise: 100 }).complete, false);
  assert.equal(c.dishProfit({ pricePaise: 100, recipeCostPaise: 1, runningCostsPaise: 0, revenuePaise: 0 }).overheadPaise, null);
});
test("target price rounds UP so the proposed price meets the target", () => {
  assert.equal(c.targetPrice({ recipeCostPaise: 6200 }), 17715);
  assert.equal(c.targetPrice({ recipeCostPaise: 6200, incrementPaise: 500 }), 18000);
  assert.equal(c.targetPrice({ recipeCostPaise: 0 }), 0);
  assert.throws(() => c.targetPrice({ recipeCostPaise: 6200, targetBps: 0 }));
});
test("earnings deducts below-line costs only after EBITDA", () => {
  assert.deepEqual(c.earnings({ revenuePaise: 100000, foodCostPaise: 35000, operatingCostsPaise: 20000, otherIncomePaise: 1000, depreciationPaise: 500, amortisationPaise: 100, interestPaise: 200, taxPaise: 300 }), { grossProfitPaise: 65000, ebitdaPaise: 46000, netProfitPaise: 44900, marginBps: 4600, complete: true });
  assert.equal(c.earnings({ revenuePaise: 0, foodCostPaise: 100, operatingCostsPaise: 0 }).marginBps, null);
  assert.equal(c.earnings({ revenuePaise: 100, foodCostPaise: null, operatingCostsPaise: 0 }).ebitdaPaise, null);
});
test("entered recurring bill replaces scheduled cost in either input order", () => {
  const scheduled = { occurrenceKey: "rent:1:2026-10", source: "REPEATS", treatment: "OPERATING_EXPENSE", amountPaise: 1000 };
  const bill = { ...scheduled, source: "MANUAL", amountPaise: 1200 };
  assert.equal(c.runningCosts([scheduled, bill]), 1200);
  assert.equal(c.runningCosts([bill, scheduled]), 1200);
  assert.throws(() => c.runningCosts([bill, bill]), /Duplicate/);
});
test("drawings, supplier settlements, advances, capital and interest are not operating costs", () => {
  assert.equal(c.runningCosts(["DRAWING", "SETTLEMENT", "ADVANCE", "CAPITAL", "INTEREST", "TAX"].map((treatment) => ({ treatment, amountPaise: 1000 }))), 0);
  assert.equal(c.runningCosts([{ treatment: "OPERATING_EXPENSE", amountPaise: 1000 }, { treatment: "OPERATING_EXPENSE", amountPaise: -1000 }]), 0);
});
test("staff expense uses gross salary once, not advance plus gross", () => {
  assert.deepEqual(c.payrollExpense([{ type: "ADVANCE", grossPaise: 5000 }, { type: "SALARY", grossPaise: 20000, amountPaise: 15000 }]), { amountPaise: 20000, complete: true });
  assert.equal(c.payrollExpense([{ type: "SALARY", amountPaise: 15000 }]).amountPaise, null);
});
test("total leaks is informational and refuses a fabricated missing write-off total", () => {
  const input = { wastePaise: 230000, freeMealsPaise: 180000, unexplainedPaise: 340000, discountsPaise: 320000, writeOffPaise: 13100 };
  assert.equal(c.totalLeaks(input), 1083100);
  assert.equal(c.totalLeaks({ ...input, writeOffPaise: null }), null);
});
