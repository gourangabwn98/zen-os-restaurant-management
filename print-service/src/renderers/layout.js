// src/renderers/layout.js
// ─────────────────────────────────────────────────────────────────────────────
// Width-aware text layout shared by the BILL and KOT renderers. Everything is
// laid out as fixed-width monospace text for the printer's character width
// (printers.config.json → charsPerLine; 48 = 80 mm roll in the standard font,
// 32 = 58 mm), so no line can ever run off the paper and columns stay
// aligned. The renderers only choose WHAT to print; this decides how it fits.
//
// Every helper returns the same "line" objects the drivers already understand
// (src/drivers/renderLines.js): { text, bold?, align?, size? }.
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_WIDTH = 48;

// Thermal printers print only their code page (ASCII is always safe). Map the
// typographic characters that commonly appear in names ("AD's Cafe" typed
// with a curly quote) and strip Latin accents. Other scripts (Bengali,
// Hindi...) are KEPT: src/textImage.js prints any line containing them as an
// image drawn with a Windows font; only if that isn't possible do they become
// "?" (src/drivers/renderLines.js).
const REPLACE = {
  "‘": "'", "’": "'", "‚": "'", "“": '"', "”": '"', "„": '"',
  "–": "-", "—": "-", "…": "...", "•": "*", "₹": "Rs", "×": "x",
};
const TYPOGRAPHIC_RE = /[‘’‚“”„–—…•₹×]/g;
export const toPrintable = (value) => String(value ?? "")
  .replace(TYPOGRAPHIC_RE, (c) => REPLACE[c])
  .normalize("NFKD").replace(/[̀-ͯ]/g, "").normalize("NFC")
  .replace(/[\u0000-\u001f\u007f]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

/** True if the printer's built-in font can't show this text (needs an image). */
export const needsImage = (text) => /[^\x20-\x7E]/.test(String(text ?? ""));

export const padRight = (s, w) => (s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length));
// Never truncates: callers size columns so values fit (a value that doesn't
// is better printed whole than silently cut).
export const padLeft = (s, w) => (s.length >= w ? s : " ".repeat(w - s.length) + s);

/** Word-wrap to `width`; words longer than a line are hard-split. */
export const wrapText = (text, width) => {
  const words = toPrintable(text).split(" ").filter(Boolean);
  const lines = [];
  let cur = "";
  for (let word of words) {
    while (word.length > width) {             // a single over-long word
      if (cur) { lines.push(cur); cur = ""; }
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (!word) continue;
    if (!cur) cur = word;
    else if (cur.length + 1 + word.length <= width) cur += ` ${word}`;
    else { lines.push(cur); cur = word; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
};

export const separator = (width, ch = "-") => ({ text: ch.repeat(width) });

/** Centered text, wrapped to the paper width. */
export const centered = (text, width, style = {}) =>
  wrapText(text, width).map((t) => ({ text: t, align: "center", ...style }));

/**
 * "Bill No    :                     ORD00042" — label column padded so every
 * colon lines up, value right-aligned. A value too long for the space left
 * wraps onto further right-aligned lines, never past the edge.
 */
export const keyValue = (label, value, width, { labelWidth = 11, bold = false } = {}) => {
  const head = `${padRight(toPrintable(label), labelWidth)}: `;
  const room = Math.max(1, width - head.length);
  const parts = wrapText(value, room);
  return parts.map((part, i) => ({
    text: (i === 0 ? head : " ".repeat(head.length)) + padLeft(part, room),
    // Column positions (in characters) — used when the line is drawn as an
    // image (src/textImage.js) so it lines up with the text lines around it.
    cells: [
      ...(i === 0 ? [{ text: head.trimEnd(), start: 0, width: head.length, align: "left" }] : []),
      { text: part, start: head.length, width: room, align: "right" },
    ],
    ...(bold ? { bold: true } : {}),
  }));
};

// Bill item columns: | name ...... | qty | amount |
const QTY_W = 4;      // " 999"
const MIN_AMT_W = 8;  // " Rs99999"

/** Amount column width that fits every amount on this bill (never truncated). */
export const amountWidth = (amounts) => Math.max(MIN_AMT_W, ...amounts.map((a) => String(a).length + 1));

/** Header row for the bill's item table. */
export const billItemHeader = (width, amtW = MIN_AMT_W) => {
  const nameW = width - QTY_W - amtW;
  return { text: padRight("Item", nameW) + padLeft("Qty", QTY_W) + padLeft("Amt", amtW), bold: true };
};

/**
 * One bill item: the name wraps inside its own column; qty and amount sit on
 * the first line, so they can never be pushed off the paper.
 */
export const billItemRows = (name, qty, amount, width, amtW = MIN_AMT_W) => {
  const nameW = width - QTY_W - amtW;
  const names = wrapText(name, nameW - 1);
  return names.map((n, i) => ({
    text: i === 0 ? padRight(n, nameW) + padLeft(String(qty), QTY_W) + padLeft(amount, amtW) : n,
    cells: i === 0
      ? [
        { text: n, start: 0, width: nameW, align: "left" },
        { text: String(qty), start: nameW, width: QTY_W, align: "right" },
        { text: amount, start: nameW + QTY_W, width: amtW, align: "right" },
      ]
      : [{ text: n, start: 0, width: nameW, align: "left" }],
  }));
};

/**
 * One KOT item: name left, "x2" right. A long name wraps and the quantity
 * goes on its LAST line, so it is always visible at the right edge:
 *   Cheese Fried Chicken Momo -
 *   10 PC                                     x1
 */
export const kotItemRows = (name, qty, width) => {
  const q = `x${qty}`;
  const qW = Math.max(4, q.length + 1);
  const names = wrapText(name, width - qW - 1);
  return names.map((n, i) => ({
    text: i === names.length - 1 ? padRight(n, width - qW) + padLeft(q, qW) : n,
    cells: i === names.length - 1
      ? [{ text: n, start: 0, width: width - qW, align: "left" }, { text: q, start: width - qW, width: qW, align: "right" }]
      : [{ text: n, start: 0, width, align: "left" }],
    bold: true,
  }));
};

/** Whole-rupee amounts as "Rs120"; anything fractional keeps 2 decimals. */
export const money = (n) => {
  const v = Number(n) || 0;
  const s = Number.isInteger(v) ? String(Math.abs(v)) : Math.abs(v).toFixed(2);
  return `${v < 0 ? "-" : ""}Rs${s}`;
};

const pad2 = (n) => String(n).padStart(2, "0");
/** { date: "01/10/2026", time: "01:05 PM" } in this PC's local time. */
export const dateTime = (when) => {
  const d = when ? new Date(when) : new Date();
  const ok = !Number.isNaN(d.getTime()) ? d : new Date();
  const h = ok.getHours();
  return {
    date: `${pad2(ok.getDate())}/${pad2(ok.getMonth() + 1)}/${ok.getFullYear()}`,
    time: `${pad2(h % 12 || 12)}:${pad2(ok.getMinutes())} ${h < 12 ? "AM" : "PM"}`,
  };
};

const ORDER_TYPE_LABEL = { DINE_IN: "Dine In", TAKEAWAY: "Takeaway", ONLINE: "Online" };
// KH-10: a DINE_IN order seated in the AC Room / Garden prints that instead
// of "Dine In" (backend utils/diningArea.js). Old jobs have no area → as before.
const DINING_AREA_LABEL = { AC_ROOM: "Indoor-AC", GARDEN: "Garden", GAZEBO: "Gazebo" };
export const orderTypeLabel = (t, area = "") =>
  (t === "DINE_IN" && DINING_AREA_LABEL[area]) || ORDER_TYPE_LABEL[t] || toPrintable(t || "-");

const PAYMENT_STATUS_LABEL = { PAID: "Paid", PENDING_VERIFICATION: "Pending", FAILED: "Failed" };
export const paymentStatusLabel = (s) => PAYMENT_STATUS_LABEL[s] || toPrintable(s || "");

/**
 * Restaurant header: name (bold, double height), address, city, "Ph: ...".
 * `header` = { name, address, city, phone }; blank parts are skipped.
 */
export const restaurantHeader = (header, width) => {
  const out = [];
  out.push(...centered(header?.name || "RECEIPT", width, { bold: true, size: "large" }));
  const address = toPrintable(header?.address);
  const city = toPrintable(header?.city);
  if (address) out.push(...centered(address, width));
  if (city && !address.toLowerCase().includes(city.toLowerCase())) out.push(...centered(city, width));
  if (toPrintable(header?.phone)) out.push(...centered(`Ph: ${header.phone}`, width));
  return out;
};
