// utils/inventoryConstants.js
// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for inventory enums, mirroring how
// utils/orderStateMachine.js centralizes the order enums.
// ─────────────────────────────────────────────────────────────────────────────

// A recipe ingredient may use any unit convertible to its InventoryItem's
// unit (g ↔ kg, ml ↔ l, pcs ↔ dozen) — see utils/units.js, the one place
// conversion happens. Units of different dimensions (g vs ml) are rejected at
// recipe-save time and never silently converted.
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

// ── Purchases & suppliers (Hotel KHOAI change round) ────────────────────────
// INV-02 — where a purchase's bill number came from. SYSTEM = nothing was
// provided, so the server made one (prefixed SYSTEM_BILL_PREFIX) — always
// shown as "System-generated", never passed off as a supplier number.
export const BILL_NUMBER_SOURCES = ["SUPPLIER", "PHOTO", "MANUAL", "SYSTEM"];
export const SYSTEM_BILL_PREFIX = "AUTO-"; // owner to confirm the marker (open question)
// INV-06/07
export const PURCHASE_PAYMENT_TYPES = ["PAID", "CREDIT"];
export const PAYMENT_SOURCES = ["CASH_DRAWER", "BANK_UPI", "OWNER_POCKET"];
// Owner's Pocket → the business owes the OWNER; Credit → owes the SUPPLIER.
export const PAYABLE_PARTIES = ["OWNER", "SUPPLIER"];
// Paying a payable back comes from the business's own money only.
export const SETTLE_SOURCES = ["CASH_DRAWER", "BANK_UPI"];
// INV-13 / INV-14
export const AUTO_ORDER_PREFERENCES = ["ASK_FIRST", "ONE_TAP", "SEND_LINK"];
export const CREDIT_PREFERENCES = ["GIVES_CREDIT", "UPFRONT", "OTHER"];
