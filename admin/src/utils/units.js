// src/utils/units.js
// ─────────────────────────────────────────────────────────────────────────────
// Live-preview mirror of restaurant-server/utils/units.js + utils/recipeCost.js
// (keep the unit table in sync). The server re-derives every quantity and
// cost on save and at sale time — this only powers the instant previews in
// the recipe editor and friendlier quantity display.
// ─────────────────────────────────────────────────────────────────────────────

import { t, N_, fmtNum } from "../i18n/core.js";

const UNIT_DEFS = {
  g:      { dim: "mass",   factor: 1 },
  kg:     { dim: "mass",   factor: 1000 },
  ml:     { dim: "volume", factor: 1 },
  l:      { dim: "volume", factor: 1000 },
  pcs:    { dim: "count",  factor: 1 },
  dozen:  { dim: "count",  factor: 12 },
  packet: { dim: "packet", factor: 1 },
  box:    { dim: "box",    factor: 1 },
};

export const UNITS = Object.keys(UNIT_DEFS);

// Display names only — the stored/sent unit is always the key (g, ml, …).
const UNIT_LABEL = {
  g: N_("g"), kg: N_("kg"), ml: N_("ml"), l: N_("l"), pcs: N_("pcs"),
  dozen: N_("dozen"), packet: N_("packet"), box: N_("box"),
};
/** "kg" → "কেজি" in Bengali mode; unknown units shown as-is. */
export const unitLabel = (unit) => (UNIT_LABEL[unit] ? t(UNIT_LABEL[unit]) : unit || "");

const info = (unit) => {
  const key = String(unit ?? "").trim().toLowerCase();
  return UNIT_DEFS[key] ? { key, ...UNIT_DEFS[key] } : { key, dim: `other:${key}`, factor: 1 };
};

/** Units `unit` converts to (incl. itself); stock in "l" → ["ml", "l"]. */
export const compatibleUnits = (unit) => {
  const { dim, key } = info(unit);
  const list = UNITS.filter((u) => UNIT_DEFS[u].dim === dim);
  return list.length ? list : [key];
};

/** How many `to` in one `from` (ml → l = 0.001), or null if they can't convert. */
export const conversionFactor = (from, to) => {
  const f = info(from), t = info(to);
  return f.dim === t.dim ? f.factor / t.factor : null;
};

/** Smaller unit for a stock recipe line by default (stocked in l → ml). */
export const preferredRecipeUnit = (stockUnit) => ({ l: "ml", kg: "g", dozen: "pcs" }[stockUnit] || stockUnit);

const round4 = (n) => Math.round((n + Number.EPSILON) * 1e4) / 1e4;

/**
 * Same rules as the server's computeIngredientCost.
 * line: { sourceType, quantity, unit, cost }, stockItem: { name, unit, costPrice }
 * → { unitCost, cost, error }  (error set ⇒ no cost, never a silent ₹0)
 */
export const ingredientCost = (line, stockItem) => {
  const qty = Number(line.quantity);
  if (line.sourceType === "CUSTOM") {
    if (line.cost === "" || line.cost == null) return { unitCost: null, cost: null, error: t("Enter a price") };
    const cost = Number(line.cost);
    if (!Number.isFinite(cost) || cost < 0) return { unitCost: null, cost: null, error: t("Price can't be negative") };
    return { unitCost: qty > 0 ? round4(cost / qty) : null, cost: round4(cost), error: null };
  }
  if (!stockItem) return { unitCost: null, cost: null, error: null };
  const factor = conversionFactor(line.unit, stockItem.unit);
  if (factor == null) return { unitCost: null, cost: null, error: t("{name} is stocked in {stockUnit} — {unit} can't convert", { name: stockItem.name, stockUnit: unitLabel(stockItem.unit), unit: unitLabel(line.unit) }) };
  const price = Number(stockItem.costPrice);
  // costMissing: a warning, not a blocking error (callers check this flag, not the text)
  if (!(price > 0)) return { unitCost: null, cost: null, costMissing: true, error: t("No cost price set for {name}", { name: stockItem.name }) };
  const unitCost = price * factor;
  return { unitCost, cost: Number.isFinite(qty) && qty > 0 ? round4(unitCost * qty) : null, error: null };
};

const trim = (n, dp) => fmtNum(n, { maximumFractionDigits: dp });

/** "0.2 l" → "200 ml", "1.5 kg" stays; small fractions read in the smaller unit. */
export const formatQty = (qty, unit) => {
  const n = Number(qty || 0);
  const smaller = { l: "ml", kg: "g" }[unit];
  if (smaller && Math.abs(n) > 0 && Math.abs(n) < 1) return `${trim(n * 1000, 1)} ${unitLabel(smaller)}`;
  return `${trim(n, 3)} ${unitLabel(unit)}`.trim();
};

/** ₹ per unit with enough precision to be meaningful (₹0.06/ml, ₹0.4/g). */
export const formatUnitCost = (n) => {
  if (n == null) return "—";
  const dp = n >= 1 ? 2 : n >= 0.01 ? 3 : 4;
  return `₹${fmtNum(n, { maximumFractionDigits: dp })}`;
};

export const formatMoney = (n) =>
  n == null ? "—" : `₹${fmtNum(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
