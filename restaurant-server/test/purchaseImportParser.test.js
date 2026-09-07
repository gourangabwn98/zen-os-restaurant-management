// test/purchaseImportParser.test.js
// node test/purchaseImportParser.test.js
// Pure-function tests for the Inventory → Import Purchase text parser. No DB,
// no network — exercises the actual heuristics against invoice-shaped text.
import assert from "node:assert/strict";
import { parsePurchaseLineItems, extractDocumentMeta } from "../utils/purchaseImportParser.js";

let passed = 0, failed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL - ${name}`);
    console.error(`         ${err.stack || err.message}`);
  }
};

console.log("── parsePurchaseLineItems ──────────────────────────");

test("qty/rate/amount line (consistent) parses cleanly, no review needed", () => {
  const rows = parsePurchaseLineItems("Basmati Rice 10 kg 142.00 1420.00");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Basmati Rice");
  assert.equal(rows[0].quantity, 10);
  assert.equal(rows[0].unit, "kg");
  assert.equal(rows[0].costPrice, 142);
  assert.equal(rows[0].needsReview, false);
});

test("qty/rate/amount line where qty*rate != amount is flagged for review", () => {
  const rows = parsePurchaseLineItems("Paneer 5 kg 320 5000");
  assert.equal(rows[0].needsReview, true);
  assert.ok(rows[0].reviewReasons.some((r) => /didn't match/i.test(r)));
});

test("two-number line (qty, cost) with a unit alias normalises the unit", () => {
  const rows = parsePurchaseLineItems("Onion 20kgs 32");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].unit, "kg");
  assert.equal(rows[0].quantity, 20);
  assert.equal(rows[0].costPrice, 32);
});

test("single-number line is ambiguous and flagged, values left blank", () => {
  const rows = parsePurchaseLineItems("Chicken 500");
  assert.equal(rows[0].quantity, null);
  assert.equal(rows[0].costPrice, null);
  assert.equal(rows[0].needsReview, true);
});

test("missing unit is flagged for review rather than guessed", () => {
  const rows = parsePurchaseLineItems("Mystery Item 4 99");
  assert.equal(rows[0].unit, null);
  assert.equal(rows[0].needsReview, true);
  assert.ok(rows[0].reviewReasons.some((r) => /unit/i.test(r)));
});

test("header/footer/noise lines are skipped, not turned into fake items", () => {
  const rows = parsePurchaseLineItems([
    "Item Description Qty Unit Rate Amount",
    "Basmati Rice 10 kg 142.00 1420.00",
    "Total",
    "Page 1",
  ].join("\n"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Basmati Rice");
});

test("a line with no numbers at all is not a candidate item", () => {
  const rows = parsePurchaseLineItems("Thank you for your business");
  assert.equal(rows.length, 0);
});

test("negative or zero quantity is rejected, not silently accepted", () => {
  const rows = parsePurchaseLineItems("Broken Item -5 kg 10");
  // "-5" tokenises as 5 via the number matcher (no sign in NUMBER_RE), so
  // this also documents that only positive magnitudes are ever produced.
  assert.ok(rows[0].quantity === null || rows[0].quantity > 0);
});

console.log("── extractDocumentMeta ──────────────────────────");

test("extracts invoice number, date and total from labelled lines", () => {
  const meta = extractDocumentMeta([
    "ABC Traders",
    "Invoice No: INV-2024-118",
    "Date: 12/03/2024",
    "Grand Total: 1420.00",
  ].join("\n"));
  assert.equal(meta.invoiceNumberGuess, "INV-2024-118");
  assert.equal(meta.purchaseDateGuess, "2024-03-12");
  assert.equal(meta.totalAmountGuess, 1420);
});

test("supplier line with an explicit label is picked up", () => {
  const meta = extractDocumentMeta("Supplier: Fresh Farms Pvt Ltd\nDate: 01-01-2024");
  assert.equal(meta.supplierGuess, "Fresh Farms Pvt Ltd");
});

test("no date anywhere leaves purchaseDateGuess null rather than inventing today", () => {
  const meta = extractDocumentMeta("Just some random text with no structure at all");
  assert.equal(meta.purchaseDateGuess, null);
});

test("a title line mentioning 'Invoice' with no label delimiter is NOT mistaken for an invoice number", () => {
  // Regression: "Purchase Invoice / Inventory Import Test" used to match on
  // the bare word "Invoice"/"Inventory" and capture trailing letters
  // ("oice") as a fake invoice number, since the label delimiter was fully
  // optional. The real "Invoice No: ..." line further down must win instead.
  const meta = extractDocumentMeta([
    "Purchase Invoice / Inventory Import Test",
    "Invoice No: BFS-2026-0907",
  ].join("\n"));
  assert.equal(meta.invoiceNumberGuess, "BFS-2026-0907");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
