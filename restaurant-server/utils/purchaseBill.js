// utils/purchaseBill.js
// ─────────────────────────────────────────────────────────────────────────────
// Pure rules for Record Purchase (Hotel KHOAI INV-02 / 03 / 04 / 06 / 07).
// services/inventoryService.js recordPurchase applies them; nothing here
// touches the database.
//
// INV-02 bill number, in this order:
//   1. the supplier's number the user typed            → SUPPLIER
//   2. the number read off the uploaded bill photo     → PHOTO
//   3. a number the user made up (bill had none: 1, 2) → MANUAL
//   4. nothing at all → the server makes one, prefixed SYSTEM_BILL_PREFIX,
//      source SYSTEM — always displayed as "System-generated".
// INV-07: Owner's Pocket money is a loan to the business: the purchase is
// still a real cost, but it creates a payable to the OWNER and never touches
// the cash drawer. Credit creates a payable to the SUPPLIER.
// ─────────────────────────────────────────────────────────────────────────────
import {
  BILL_NUMBER_SOURCES, SYSTEM_BILL_PREFIX, PURCHASE_PAYMENT_TYPES, PAYMENT_SOURCES, STOCK_UNITS,
} from "./inventoryConstants.js";

const bad = (message) => Object.assign(new Error(message), { statusCode: 400 });
const money = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const USER_SOURCES = BILL_NUMBER_SOURCES.filter((s) => s !== "SYSTEM");

/** → { number, source } when one was provided, else null (system must make one). */
export const resolveBillNumber = ({ billNumber, billNumberSource } = {}) => {
  const number = String(billNumber ?? "").trim().replace(/\s+/g, " ");
  if (!number) return null;
  if (number.length > 40) throw bad("Bill number is too long (40 characters at most)");
  // A typed number can't pose as a system one.
  if (number.toUpperCase().startsWith(SYSTEM_BILL_PREFIX)) throw bad(`Bill numbers starting "${SYSTEM_BILL_PREFIX}" are reserved for system-generated ones`);
  const source = USER_SOURCES.includes(billNumberSource) ? billNumberSource : "SUPPLIER";
  return { number, source };
};

/** "AUTO-20261004-003" — day of the bill + a per-day counter. */
export const systemBillNumber = (billDate, seq) =>
  `${SYSTEM_BILL_PREFIX}${String(billDate).replace(/-/g, "")}-${String(seq).padStart(3, "0")}`;

const DATE_RX = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RX = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** INV-03: both required, real calendar date, 24h time, not in the future. */
export const validateBillDateTime = ({ billDate, billTime }, { now = new Date(), toInstant }) => {
  const d = String(billDate || "").match(DATE_RX);
  if (!d) throw bad("Bill date is required (YYYY-MM-DD)");
  const t = String(billTime || "").match(TIME_RX);
  if (!t) throw bad("Bill time is required (HH:MM)");
  const [y, m, day] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const check = new Date(Date.UTC(y, m - 1, day));
  if (check.getUTCMonth() !== m - 1 || check.getUTCDate() !== day) throw bad("Bill date is not a real date");
  const at = toInstant(y, m, day, Number(t[1]), Number(t[2]));
  if (at.getTime() > now.getTime() + 5 * 60 * 1000) throw bad("Bill date and time can't be in the future");
  return at;
};

/**
 * INV-04: purchase lines. A line either names a stock item (inventoryItem) or
 * is typed in by hand (name + unit). Amount = quantity × rate, server-side.
 * → [{ inventoryItem|null, name, unit, manual, quantity, costPrice, amount, batchNo, expiryDate }]
 */
export const normalizePurchaseLines = (items) => {
  if (!Array.isArray(items) || !items.length) throw bad("Purchase must include at least one item");
  if (items.length > 200) throw bad("Too many lines in one purchase");
  return items.map((it, i) => {
    const quantity = Number(it?.quantity);
    const rate = Number(it?.costPrice ?? it?.rate);
    if (!(quantity > 0)) throw bad(`Line ${i + 1}: quantity must be more than 0`);
    if (!(rate >= 0)) throw bad(`Line ${i + 1}: rate must be 0 or more`);
    const name = String(it?.name ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
    const manual = !it?.inventoryItem;
    if (manual && !name) throw bad(`Line ${i + 1}: pick a stock item or type the item name`);
    const unit = it?.unit ? String(it.unit) : "";
    if (unit && !STOCK_UNITS.includes(unit)) throw bad(`Line ${i + 1}: unknown unit "${unit}"`);
    return {
      inventoryItem: manual ? null : String(it.inventoryItem),
      name, unit, manual,
      quantity, costPrice: rate, amount: money(quantity * rate),
      batchNo: it?.batchNo || "", expiryDate: it?.expiryDate || null,
    };
  });
};

/**
 * INV-06/07 — Paid (with a source) or Credit. Legacy callers (import flow)
 * that send neither keep the old behaviour: nothing recorded.
 * → { paymentType?, paymentSource?, payable: { to, amount } | null }
 */
export const paymentPlan = ({ paymentType, paymentSource }, totalCost, { required = false } = {}) => {
  if (paymentType === undefined || paymentType === null || paymentType === "") {
    if (required) throw bad("Choose Paid or Credit");
    return { payable: null };
  }
  if (!PURCHASE_PAYMENT_TYPES.includes(paymentType)) throw bad("Payment must be Paid or Credit");
  if (paymentType === "CREDIT") {
    return { paymentType, paymentSource: undefined, payable: { to: "SUPPLIER", amount: money(totalCost) } };
  }
  if (!PAYMENT_SOURCES.includes(paymentSource)) throw bad("Choose where the money came from: Cash Drawer, Bank/UPI or Owner's Pocket");
  return {
    paymentType, paymentSource,
    payable: paymentSource === "OWNER_POCKET" ? { to: "OWNER", amount: money(totalCost) } : null,
  };
};

/**
 * Money that left the business's own accounts, by source, for a set of
 * purchases (and payable settlements) — used by Close the day and Insights.
 * Owner's Pocket is NOT money out of the business until it is repaid.
 */
export const cashOutBySource = (purchases, { from, to } = {}) => {
  const inRange = (d) => d && (!from || d >= from) && (!to || d <= to);
  const out = { CASH_DRAWER: 0, BANK_UPI: 0, ownerFunded: 0, onCredit: 0, ownerRepaid: 0, supplierPaid: 0, notRecorded: 0 };
  for (const p of purchases) {
    const at = new Date(p.purchaseDate);
    if (inRange(at)) {
      if (p.paymentType === "PAID" && p.paymentSource === "CASH_DRAWER") out.CASH_DRAWER += p.totalCost;
      else if (p.paymentType === "PAID" && p.paymentSource === "BANK_UPI") out.BANK_UPI += p.totalCost;
      else if (p.paymentType === "PAID" && p.paymentSource === "OWNER_POCKET") out.ownerFunded += p.totalCost;
      else if (p.paymentType === "CREDIT") out.onCredit += p.totalCost;
      else out.notRecorded += p.totalCost;
    }
    const s = p.payable;
    if (s?.settledAt && inRange(new Date(s.settledAt)) && s.settledSource) {
      out[s.settledSource] += s.amount;
      if (s.to === "OWNER") out.ownerRepaid += s.amount; else out.supplierPaid += s.amount;
    }
  }
  for (const k of Object.keys(out)) out[k] = money(out[k]);
  return out;
};
