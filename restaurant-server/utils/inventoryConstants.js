// utils/inventoryConstants.js
// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for inventory enums, mirroring how
// utils/orderStateMachine.js centralizes the order enums.
// ─────────────────────────────────────────────────────────────────────────────

// No automatic conversion between units in Phase 2 — a recipe ingredient's
// unit must match its InventoryItem's unit exactly (e.g. an item stocked in
// "g" must have its recipe quantities specified in "g", not "kg"). This is a
// deliberate scope decision to avoid a whole unit-conversion subsystem; a
// mismatched unit is rejected at recipe-save time (see inventoryService.js).
export const STOCK_UNITS = ["g", "kg", "ml", "l", "pcs", "dozen", "packet", "box"];

// Every row ever written to StockLedger has exactly one of these types.
// Sign convention: PURCHASE/ADJUSTMENT(increase)/PHYSICAL_COUNT(increase)/REVERSAL
// are positive quantity; SALE_DEDUCTION/WASTAGE/ADJUSTMENT(decrease)/
// PHYSICAL_COUNT(decrease) are negative quantity. `balanceAfter` always
// records the resulting currentStock so the ledger is self-auditing.
export const LEDGER_TYPES = [
  "PURCHASE",
  "SALE_DEDUCTION",
  "WASTAGE",
  "ADJUSTMENT",
  "PHYSICAL_COUNT",
  "REVERSAL",
];

export const STOCK_ADJUSTMENT_TYPES = ["MANUAL_ADJUSTMENT", "PHYSICAL_COUNT"];

export const WASTAGE_REASONS = ["Spoilage", "Expired", "Damaged", "Accident", "Other"];

// Computed (never stored) stock-health classification for an InventoryItem,
// derived from currentStock vs reorderLevel/criticalLevel at read time.
export const STOCK_ALERT_LEVELS = ["OK", "LOW", "CRITICAL", "OUT_OF_STOCK"];

export const classifyStockLevel = (currentStock, reorderLevel, criticalLevel) => {
  if (currentStock <= 0) return "OUT_OF_STOCK";
  if (criticalLevel != null && currentStock <= criticalLevel) return "CRITICAL";
  if (reorderLevel != null && currentStock <= reorderLevel) return "LOW";
  return "OK";
};
