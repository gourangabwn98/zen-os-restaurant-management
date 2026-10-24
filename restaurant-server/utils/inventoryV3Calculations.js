// V3 money contract: integer paise at API/storage boundaries; exact decimal
// arithmetic internally. No database, clock, environment or UI dependencies.
// Legacy billing, order deductions and their rupee fields remain unchanged.
import { normalizeUnit, areUnitsCompatible, conversionFactor } from "./units.js";

export const CALCULATION_VERSION = 1;
const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const bad = (message) => Object.assign(new Error(message), { statusCode: 400, code: "INVALID_CALCULATION_INPUT" });
const integer = (value, name = "amountPaise", signed = false) => {
  if (!Number.isSafeInteger(value) || (!signed && value < 0)) throw bad(`${name} must be a ${signed ? "" : "non-negative "}safe integer`);
  return BigInt(value);
};
const safe = (value) => {
  if (value > MAX || value < -MAX) throw bad("Calculation exceeds safe monetary limits");
  return Number(value);
};

// Up to six decimal places, sufficient for the existing quantity precision.
// Decimal strings are preferred. Reject exponent notation, blanks, Infinity,
// coercible objects and excessive precision rather than silently rounding inputs.
const decimal = (value, name = "quantity", signed = false) => {
  if (typeof value !== "string" && typeof value !== "number") throw bad(`${name} must be a decimal`);
  if (typeof value === "number" && !Number.isFinite(value)) throw bad(`${name} must be finite`);
  const str = String(value);
  if (!/^-?\d{1,16}(?:\.\d{1,6})?$/.test(str)) throw bad(`${name} must have at most six decimal places`);
  const negative = str.startsWith("-");
  const [whole, fraction = ""] = (negative ? str.slice(1) : str).split(".");
  const n = BigInt(whole + fraction) * (negative ? -1n : 1n);
  if ((!signed && n < 0n) || n > MAX || n < -MAX) throw bad(`${name} is outside the supported range`);
  return { n, d: 10n ** BigInt(fraction.length) };
};
const rounded = (n, d) => {
  if (d <= 0n) throw bad("Divisor must be positive");
  const sign = n < 0n ? -1n : 1n;
  const abs = n < 0n ? -n : n;
  return sign * ((abs + d / 2n) / d); // halves away from zero
};
const ratio = (n, d) => d > 0n ? safe(rounded(n * 10000n, d)) : null;
const list = (values, name = "lines") => {
  if (!Array.isArray(values) || values.length > 10000) throw bad(`${name} must be an array of at most 10000 entries`);
  return values;
};
const factor = (from, to) => {
  const f = normalizeUnit(from), t = normalizeUnit(to);
  if (!f || !t || !areUnitsCompatible(f, t)) throw bad(`Cannot convert ${from} to ${to}`);
  // Existing unit definitions remain the authority. Relative to each dimension's
  // smallest unit these factors are integers, so no floating division is used.
  const base = { kg: "g", g: "g", l: "ml", ml: "ml", dozen: "pcs", pcs: "pcs", packet: "packet", box: "box" }[f];
  return { n: BigInt(conversionFactor(f, base)), d: BigInt(conversionFactor(t, base)) };
};

export const rupeesToPaise = (value) => {
  const v = decimal(value, "rupees", true);
  return safe(rounded(v.n * 100n, v.d));
};
export const sumPaise = (values) => safe(list(values).reduce((s, v) => s + integer(v, "amountPaise", true), 0n));
export const quantityMicros = (value, signed = false) => {
  const v = decimal(value, "quantity", signed);
  return safe(v.n * 1000000n / v.d);
};
export const convertedQuantityMicros = (quantity, from, to) => {
  const q = decimal(quantity), f = factor(from, to);
  return safe(rounded(q.n * f.n * 1000000n, q.d * f.d));
};

// unitRateRupees supports sub-paisa rates, e.g. an item stocked in grams.
export const lineAmountPaise = ({ quantity, unitRateRupees, unit, stockUnit = unit }) => {
  const q = decimal(quantity), r = decimal(unitRateRupees, "unitRateRupees");
  const f = factor(unit, stockUnit);
  return safe(rounded(q.n * r.n * f.n * 100n, q.d * r.d * f.d));
};
export const purchaseTotals = (lines) => {
  list(lines);
  if (!lines.length || lines.length > 200) throw bad("A purchase needs 1–200 lines");
  const amountsPaise = lines.map((line) => {
    if (decimal(line.quantity).n <= 0n) throw bad("Purchase quantity must be positive");
    return lineAmountPaise(line);
  });
  return { amountsPaise, totalPaise: sumPaise(amountsPaise) };
};
export const stockValuation = (items) => {
  const lines = list(items).filter((i) => i.status !== "Inactive").map((i) => ({
    id: i.id,
    valuePaise: i.unitRateRupees == null ? null : lineAmountPaise(i),
  }));
  const missing = lines.filter((l) => l.valuePaise == null).map((l) => l.id);
  const knownValuePaise = sumPaise(lines.map((l) => l.valuePaise ?? 0));
  return { lines, knownValuePaise, totalPaise: missing.length ? null : knownValuePaise, missing, complete: !missing.length };
};
export const recipeCost = (ingredients) => {
  const lines = list(ingredients).map((i) => {
    if (i.sourceType === "CUSTOM") return i.costPaise == null ? null : safe(integer(i.costPaise));
    if (i.sourceType != null && i.sourceType !== "STOCK") throw bad("Unknown ingredient source");
    return i.unitRateRupees == null ? null : lineAmountPaise(i);
  });
  const knownCostPaise = sumPaise(lines.map((v) => v ?? 0));
  const complete = lines.length > 0 && lines.every((v) => v != null);
  return { linesPaise: lines, knownCostPaise, totalPaise: complete ? knownCostPaise : null, complete };
};

export const actualRevenue = ({ subtotalPaise, discountPaise = 0, serviceChargePaise = 0, writeOffPaise = 0 }) => {
  // Inputs must be from the SAME eligible set. Never subtract excluded cancelled
  // orders again as write-offs. GST is deliberately not an input.
  return safe(integer(subtotalPaise) - integer(discountPaise) + integer(serviceChargePaise) - integer(writeOffPaise));
};
export const foodCostStatus = ({ foodCostPaise, revenuePaise, targetBps = 3500, complete = true }) => {
  const target = integer(targetBps, "targetBps");
  if (target < 1n || target > 10000n) throw bad("Target must be between 0.01% and 100%");
  const revenue = integer(revenuePaise, "revenuePaise", true);
  const food = foodCostPaise == null ? null : integer(foodCostPaise);
  if (!complete || food == null || revenue <= 0n) return { percentBps: null, differenceBps: null, tone: "unavailable" };
  const percentBps = ratio(food, revenue);
  // Compare exact ratios so display rounding cannot change a threshold colour.
  return { percentBps, differenceBps: safe(BigInt(percentBps) - target),
    tone: food * 10000n <= revenue * target ? "green" : food * 10000n <= revenue * (target + 500n) ? "amber" : "red" };
};

export const actualFoodCost = ({ openingValuePaise, purchasesPaise, closingValuePaise, adjustmentsPaise = 0, complete = true }) => {
  const values = [openingValuePaise, purchasesPaise, closingValuePaise];
  if (!complete || values.some((v) => v == null)) return { amountPaise: null, complete: false, reason: "MISSING_VALUATION" };
  const cost = integer(openingValuePaise) + integer(purchasesPaise) + integer(adjustmentsPaise, "adjustmentsPaise", true) - integer(closingValuePaise);
  if (cost < 0n) return { amountPaise: null, complete: false, reason: "NEGATIVE_CONSUMPTION" };
  return { amountPaise: safe(cost), complete: true, reason: null };
};
export const reconcileCount = ({ openingQty, purchasedQty = "0", reversalQty = "0", adjustmentQty = "0", recipeQty = "0", knownLossQty = "0", countedQty, unitRateRupees, unit, complete = true }) => {
  const q = (v, signed = false) => BigInt(quantityMicros(v, signed));
  const actual = q(openingQty) + q(purchasedQty) + q(reversalQty) + q(adjustmentQty, true) - q(countedQty);
  const expected = q(recipeQty) + q(knownLossQty);
  const variance = actual - expected;
  const valid = complete && actual >= 0n;
  const value = (micros) => {
    if (!valid || unitRateRupees == null) return null;
    const r = decimal(unitRateRupees, "unitRateRupees");
    if (!normalizeUnit(unit)) throw bad("Unknown unit");
    return safe(rounded(micros * r.n * 100n, 1000000n * r.d));
  };
  return { actualUsedMicros: safe(actual), expectedUsedMicros: safe(expected), varianceMicros: valid ? safe(variance) : null,
    lossPaise: value(variance > 0n ? variance : 0n), gainPaise: value(variance < 0n ? -variance : 0n), complete: valid && unitRateRupees != null };
};

export const supplierDues = (payables) => sumPaise(list(payables).filter((p) => p.to === "SUPPLIER" && !p.settledAt).map((p) => safe(integer(p.amountPaise))));
export const stockDays = ({ stockQty, consumedQty, observedDays, complete = true }) => {
  const stock = BigInt(quantityMicros(stockQty)), consumed = BigInt(quantityMicros(consumedQty));
  const days = integer(observedDays, "observedDays");
  if (!complete || days === 0n || consumed === 0n) return null;
  return safe(rounded(stock * days * 10n, consumed)) / 10;
};
export const booksComplete = (checks) => {
  const applicable = list(checks).filter((c) => c.applicable !== false);
  const done = applicable.filter((c) => c.status === "complete").length;
  return { done, total: applicable.length, percentBps: applicable.length ? ratio(BigInt(done), BigInt(applicable.length)) : null };
};
export const groupedSpend = (lines) => {
  const groups = new Map();
  for (const line of list(lines)) {
    const group = typeof line.group === "string" && line.group ? line.group : "Uncategorised";
    groups.set(group, (groups.get(group) || 0n) + integer(line.amountPaise));
  }
  const rows = [...groups].map(([group, amount]) => ({ group, amountPaise: safe(amount) }));
  return { groups: rows, totalPaise: sumPaise(rows.map((r) => r.amountPaise)) };
};

// Exact allocation; remainder paise go to the earliest periods. Sum always
// equals the original basis. Used for annual licences and equipment lives.
export const allocateCost = ({ basisPaise, periods, residualPaise = 0 }) => {
  const basis = integer(basisPaise), residual = integer(residualPaise);
  const count = integer(periods, "periods");
  if (count < 1n || count > 1200n || residual > basis) throw bad("Invalid allocation schedule");
  const amount = basis - residual, base = amount / count, remainder = amount % count;
  return Array.from({ length: periods }, (_, i) => safe(base + (BigInt(i) < remainder ? 1n : 0n)));
};
export const dishProfit = ({ pricePaise, recipeCostPaise, runningCostsPaise, revenuePaise, soldQty = "0", complete = true }) => {
  const price = integer(pricePaise), running = integer(runningCostsPaise), revenue = integer(revenuePaise, "revenuePaise", true);
  const qty = decimal(soldQty);
  if (!complete || recipeCostPaise == null || revenue <= 0n) return { overheadPaise: null, profitPerPlatePaise: null, periodProfitPaise: null, marginBps: null, complete: false };
  const food = integer(recipeCostPaise);
  const overhead = rounded(price * running, revenue);
  const profit = price - food - overhead;
  return { overheadPaise: safe(overhead), profitPerPlatePaise: safe(profit), periodProfitPaise: safe(rounded(profit * qty.n, qty.d)), marginBps: ratio(profit, price), complete: true };
};
export const targetPrice = ({ recipeCostPaise, targetBps = 3500, incrementPaise = 1 }) => {
  const food = integer(recipeCostPaise), target = integer(targetBps, "targetBps"), increment = integer(incrementPaise, "incrementPaise");
  if (target < 1n || target > 10000n || increment < 1n) throw bad("Invalid target or price increment");
  const divisor = target * increment;
  return safe(((food * 10000n + divisor - 1n) / divisor) * increment);
};
export const earnings = ({ revenuePaise, foodCostPaise, operatingCostsPaise, otherIncomePaise = 0, depreciationPaise = 0, amortisationPaise = 0, interestPaise = 0, taxPaise = 0, complete = true }) => {
  const revenue = integer(revenuePaise, "revenuePaise", true);
  const other = integer(otherIncomePaise), below = [depreciationPaise, amortisationPaise, interestPaise, taxPaise].reduce((s, v) => s + integer(v), 0n);
  if (!complete || foodCostPaise == null || operatingCostsPaise == null) return { grossProfitPaise: null, ebitdaPaise: null, netProfitPaise: null, marginBps: null, complete: false };
  const gross = revenue - integer(foodCostPaise), ebitda = gross - integer(operatingCostsPaise) + other;
  return { grossProfitPaise: safe(gross), ebitdaPaise: safe(ebitda), netProfitPaise: safe(ebitda - below), marginBps: ratio(ebitda, revenue), complete: true };
};

// Recognised entries only; recurrence materialisation must supply one stable
// occurrence key. An entered bill supersedes its scheduled occurrence.
export const runningCosts = (entries) => {
  const byOccurrence = new Map(), independent = [];
  for (const entry of list(entries)) {
    if (!entry.occurrenceKey) { independent.push(entry); continue; }
    const previous = byOccurrence.get(entry.occurrenceKey);
    if (previous) {
      const scheduled = previous.source === "REPEATS", nextScheduled = entry.source === "REPEATS";
      if (scheduled === nextScheduled) throw bad("Duplicate recurring occurrence");
      if (nextScheduled) continue;
    }
    byOccurrence.set(entry.occurrenceKey, entry);
  }
  const all = [...independent, ...byOccurrence.values()];
  return sumPaise(all.filter((e) => e.treatment === "OPERATING_EXPENSE").map((e) => safe(integer(e.amountPaise, "amountPaise", true))));
};
export const payrollExpense = (salaryRows) => {
  const salaries = list(salaryRows).filter((r) => r.type === "SALARY");
  const amounts = salaries.map((r) => r.grossPaise == null ? null : safe(integer(r.grossPaise)));
  return { amountPaise: amounts.some((v) => v == null) ? null : sumPaise(amounts), complete: amounts.every((v) => v != null) };
};
export const totalLeaks = ({ wastePaise, freeMealsPaise, unexplainedPaise, discountsPaise, writeOffPaise }) => {
  const values = [wastePaise, freeMealsPaise, unexplainedPaise, discountsPaise, writeOffPaise];
  return values.some((v) => v == null) ? null : sumPaise(values.map((v) => safe(integer(v))));
};
