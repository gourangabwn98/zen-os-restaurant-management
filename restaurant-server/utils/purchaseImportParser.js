// utils/purchaseImportParser.js
// ─────────────────────────────────────────────────────────────────────────────
// Pure text → candidate-purchase-line heuristics. No I/O, no DB — takes the
// raw text utils/purchaseImportExtract.js produced and returns a best-effort
// list of rows shaped like an inventory purchase line.
//
// Invoices are not a standard format, so this is deliberately conservative:
// every field this can't identify with reasonable confidence is left blank
// and the row is flagged `needsReview`, rather than guessed. Only fields
// that exist on the real models are ever populated — see
// restaurant-server/config/getModels.js (inventoryItemSchema /
// stockPurchaseItemSchema): name, category, quantity, unit, costPrice,
// batchNo, expiryDate, plus the purchase-level supplier/invoiceNumber/
// purchaseDate/totalAmount. Nothing here invents a field the model doesn't have.
// ─────────────────────────────────────────────────────────────────────────────
import { STOCK_UNITS } from "./inventoryConstants.js";

const UNIT_ALIASES = {
  g: "g", gm: "g", gms: "g", gram: "g", grams: "g",
  kg: "kg", kgs: "kg", kilo: "kg", kilos: "kg", kilogram: "kg", kilograms: "kg",
  ml: "ml", milliliter: "ml", millilitre: "ml",
  l: "l", ltr: "l", ltrs: "l", litre: "l", litres: "l", liter: "l", liters: "l",
  pc: "pcs", pcs: "pcs", pieces: "pcs", piece: "pcs", nos: "pcs", no: "pcs", unit: "pcs", units: "pcs",
  dz: "dozen", doz: "dozen", dozen: "dozen", dozens: "dozen",
  pkt: "packet", pkts: "packet", packet: "packet", packets: "packet",
  box: "box", boxes: "box", ctn: "box", carton: "box", cartons: "box",
};
// No \b on the left: invoices often glue the unit straight onto the
// quantity ("20kgs", "5pcs") with no space, and digit→letter isn't a \b
// boundary. A letter immediately before/after still excludes a match, so
// this won't fire inside an unrelated word.
const UNIT_PATTERN = new RegExp(`(?<![a-zA-Z])(${Object.keys(UNIT_ALIASES).join("|")})(?![a-zA-Z])`, "i");

const NOISE_LINE = /^(item|description|particulars|sr\.?\s?no\.?|s\.?no\.?|qty|quantity|rate|price|unit price|amount|total|sub\s?total|grand\s?total|tax|gst|cgst|sgst|igst|discount|hsn|page\s*\d+|invoice|bill|thank you|terms|signature)[:\s]*$/i;

// Document-metadata lines (invoice #, date, totals, supplier) — these carry a
// value after the label, so NOISE_LINE's "label with nothing after it" check
// doesn't catch them, but they're still not an item row. Matched the same
// way extractDocumentMeta() reads them, so the two stay in sync.
const META_LINE = /^(?:(?:invoice|bill|inv)\s*(?:no\.?|number|#)?\s*[:\-]|(?:date|dated|invoice date|purchase date)\s*[:\-]|(?:grand\s*total|net\s*amount|total\s*amount|total|sub\s*total|subtotal)\s*[:\-]?\s*(?:rs\.?|inr|₹)?\s*[\d,]|(?:supplier|vendor|from|seller|sold by)\s*[:\-])/i;

const DATE_PATTERNS = [
  // 12/03/2024, 12-03-2024, 12.03.2024
  /\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})\b/,
  // 2024-03-12 (ISO)
  /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/,
];

function parseDateLoose(str) {
  if (!str) return null;
  for (const re of DATE_PATTERNS) {
    const m = str.match(re);
    if (!m) continue;
    let d, mo, y;
    if (m[1].length === 4) { [, y, mo, d] = m; } // ISO
    else { [, d, mo, y] = m; }
    y = y.length === 2 ? Number(y) + 2000 : Number(y);
    const dt = new Date(Date.UTC(y, Number(mo) - 1, Number(d)));
    if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  }
  return null;
}

// Numbers as they appear on an invoice: "1,240.50", "320", "8.5"
const NUMBER_RE = /\d[\d,]*\.?\d*/g;
const numbersIn = (s) => (s.match(NUMBER_RE) || []).map((n) => Number(n.replace(/,/g, "")));

function extractUnit(line) {
  const m = line.match(UNIT_PATTERN);
  return m ? UNIT_ALIASES[m[1].toLowerCase()] : null;
}

// ── document-level fields (supplier / invoice / date / total) ───────────────
export function extractDocumentMeta(rawText) {
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const meta = { supplierGuess: "", invoiceNumberGuess: "", purchaseDateGuess: null, totalAmountGuess: null };

  for (const line of lines) {
    if (!meta.supplierGuess) {
      const m = line.match(/^(?:supplier|vendor|from|seller|sold by)\s*[:\-]\s*(.+)$/i);
      if (m) meta.supplierGuess = m[1].trim();
    }
    if (!meta.invoiceNumberGuess) {
      // The label→value delimiter (a "No."/"Number"/"#" keyword, or at
      // least a bare colon/dash) must actually be present — otherwise
      // "invoice"/"inv" appearing anywhere in ordinary prose (e.g. a title
      // like "Purchase Invoice / Inventory Import Test") would have
      // whatever letters follow it mis-captured as an invoice number.
      const m = line.match(/\b(?:invoice|bill|inv)\.?\s*(?:(?:no\.?|number|#)\s*[:\-]?|[:\-])\s*([A-Za-z0-9\-/]{2,20})\b/i);
      if (m) meta.invoiceNumberGuess = m[1].trim();
    }
    if (!meta.purchaseDateGuess) {
      const m = line.match(/\b(?:date|dated|invoice date|purchase date)\s*[:\-]?\s*(.+)$/i);
      const d = parseDateLoose(m ? m[1] : line.match(/date/i) ? line : "");
      if (d) meta.purchaseDateGuess = d;
    }
    if (!meta.totalAmountGuess) {
      const m = line.match(/\b(?:grand\s*total|net\s*amount|total\s*amount|total)\b\s*[:\-]?\s*(?:rs\.?|inr|₹)?\s*([\d,]+\.?\d*)/i);
      if (m) meta.totalAmountGuess = Number(m[1].replace(/,/g, ""));
    }
  }
  if (!meta.purchaseDateGuess) {
    for (const line of lines) {
      const d = parseDateLoose(line);
      if (d) { meta.purchaseDateGuess = d; break; }
    }
  }
  return meta;
}

// ── line items ───────────────────────────────────────────────────────────
/**
 * @returns {Array<{
 *   rawLine: string, name: string, category: string, quantity: number|null,
 *   unit: string|null, costPrice: number|null, batchNo: string, expiryDate: string|null,
 *   needsReview: boolean, reviewReasons: string[]
 * }>}
 */
export function parsePurchaseLineItems(rawText) {
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows = [];

  for (const line of lines) {
    if (line.length < 3) continue;
    if (NOISE_LINE.test(line)) continue;
    if (META_LINE.test(line)) continue;
    if (/^--\s*\d+\s*of\s*\d+\s*--$/i.test(line)) continue; // pdf-parse's own page-break marker
    if (/^[\d\s.,\-:/₹]+$/.test(line)) continue; // number-only line, no item text at all

    const numbers = numbersIn(line);
    if (numbers.length === 0) continue; // no quantity/price signal at all — not a line item

    const unit = extractUnit(line);

    // Item name = the text before the first number, with unit words and
    // leading list markers ("1.", "-", "•") stripped.
    const firstNumberIdx = line.search(NUMBER_RE);
    let name = (firstNumberIdx > 0 ? line.slice(0, firstNumberIdx) : line)
      .replace(/^[\-•*\d.)\s]+/, "")
      .replace(UNIT_PATTERN, "")
      .replace(/[₹:\-]+$/, "")
      .trim();

    const reviewReasons = [];
    if (!name || name.length < 2) {
      reviewReasons.push("Could not identify an item name");
      name = name || "";
    }

    let quantity = null, costPrice = null;
    if (numbers.length === 1) {
      // Only one number on the line — could be qty OR price; too ambiguous
      // to guess which, so leave both blank and ask for review rather than
      // invent an association.
      reviewReasons.push("Only one number found — could not tell quantity from cost");
    } else if (numbers.length === 2) {
      [quantity, costPrice] = numbers;
    } else {
      // 3+ numbers: the common "qty, rate, amount" invoice-line shape.
      // If qty*rate is close to the last number, trust that reading;
      // otherwise fall back to the first two and flag for review.
      const [qty, rate] = numbers;
      const amount = numbers[numbers.length - 1];
      const consistent = Math.abs(qty * rate - amount) <= Math.max(1, amount * 0.02);
      quantity = qty;
      costPrice = rate;
      if (!consistent) reviewReasons.push("Quantity × cost didn't match the line total — please verify");
    }

    if (quantity != null && !(quantity > 0)) { reviewReasons.push("Quantity must be greater than 0"); quantity = null; }
    if (costPrice != null && !(costPrice >= 0)) { reviewReasons.push("Cost must be 0 or more"); costPrice = null; }
    if (!unit) reviewReasons.push("Unit not recognised — please select one");

    const batchMatch = line.match(/\bbatch\s*(?:no\.?)?\s*[:\-]?\s*([A-Za-z0-9\-]+)/i);
    const expiryMatch = line.match(/\b(?:exp(?:iry)?|best before)\s*[:\-]?\s*(.+)$/i);

    rows.push({
      rawLine: line,
      name,
      category: "",
      quantity,
      unit: unit || null,
      costPrice,
      batchNo: batchMatch ? batchMatch[1] : "",
      expiryDate: expiryMatch ? parseDateLoose(expiryMatch[1]) : null,
      needsReview: reviewReasons.length > 0,
      reviewReasons,
    });
  }

  return rows;
}

export { STOCK_UNITS };
