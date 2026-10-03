// utils/menuImportParser.js
// ─────────────────────────────────────────────────────────────────────────────
// Admin → Menu items → Import menu. Turns text into CANDIDATE dishes for the
// admin to review — nothing here touches the database, and nothing is saved
// until the admin presses Add (services/menuItemService.js commitImport).
//
//   parseMenuText(text)  printed / photographed / pasted menus:
//       LUNCH                         ← a line with no price = a section
//       Veg Thali ........ 160/-      ← name + price at the end
//       Masala Bhetki (Time 30min) 260/-   → note "Time 30min"
//   parseMenuCsv(text)   a spreadsheet saved as CSV; columns are matched by
//       header name (Item / Name / Dish, Price / Rate, Category / Section,
//       Type / Veg, Note / Remarks / Description; Half + Full → price = Full).
//
// Every row carries `check: [reasons]` when the reader is unsure (OCR source,
// odd characters, a price that looks wrong, two prices on one line), so the
// review list can flag it. Veg / Non-veg and Fish / Prawn tags are guessed
// from the dish name and are always shown for the admin to correct.
// ─────────────────────────────────────────────────────────────────────────────

const NON_VEG_WORDS = [
  "chicken", "mutton", "lamb", "goat", "beef", "pork", "ham", "bacon", "egg", "omelette", "omelet", "keema", "kheema",
  "fish", "prawn", "shrimp", "crab", "lobster", "squid", "tuna", "salmon", "mach", "maach", "machh", "chingri", "golda",
  "ilish", "hilsa", "katla", "rui", "rohu", "bhetki", "bhekti", "pomfret", "pabda", "mourola", "tangra", "parshe",
  "koi", "magur", "shol", "boal", "kakra", "murgi", "mangsho", "mangso", "anda", "dim", "seafood", "tandoori chicken",
];
const FISH_WORDS = ["fish", "mach", "maach", "machh", "ilish", "hilsa", "katla", "rui", "rohu", "bhetki", "bhekti", "pomfret",
  "pabda", "mourola", "tangra", "parshe", "koi", "magur", "shol", "boal", "tuna", "salmon"];
const PRAWN_WORDS = ["prawn", "shrimp", "chingri", "golda", "lobster"];

const words = (s) => s.toLowerCase().split(/[^a-z]+/).filter(Boolean);
const hasWord = (name, list) => {
  const w = words(name);
  return list.some((x) => (x.includes(" ") ? name.toLowerCase().includes(x) : w.includes(x)));
};

/** Guess Veg / Non Veg and diner tags from a dish name (admin reviews it). */
export const guessFoodType = (name) => {
  const tags = [];
  if (hasWord(name, FISH_WORDS)) tags.push("Fish");
  if (hasWord(name, PRAWN_WORDS)) tags.push("Prawn");
  return { tag: hasWord(name, NON_VEG_WORDS) ? "Non Veg" : "Veg", tags };
};

const titleCase = (s) => s.toLowerCase().replace(/(^|[\s(/&-])([a-z])/g, (m, a, b) => a + b.toUpperCase());

/** "LUNCH", "Extra -", "STARTERS:" → "Lunch", "Extra", "Starters". */
const cleanHeading = (line) => titleCase(line.replace(/[:\-–—.•*_=|]+\s*$/g, "").replace(/^[\s•*#\-–—=]+/, "").trim());

// price at the end of a line: "160/-", "₹ 160", "Rs.160", "160.00", "120/200"
const PRICE_TAIL = /(?:₹|\brs\.?|\binr)?\s*(\d{1,5}(?:\.\d{1,2})?)(?:\s*\/\s*(\d{1,5}(?:\.\d{1,2})?))?\s*(?:\/-|\/|-|\brs\.?|₹)?\s*$/i;

/**
 * One menu line → { name, price, note, check } or null when it has no price.
 * Notes in brackets are lifted out: "Chingri Malai Curry (B/Less)(3pcs) 250/-".
 */
export const parseMenuLine = (raw) => {
  const line = raw.replace(/\s+/g, " ").trim();
  if (!line) return null;
  const m = PRICE_TAIL.exec(line);
  if (!m || m.index === 0) return null;
  let head = line.slice(0, m.index);
  const check = [];

  const notes = [];
  head = head.replace(/\(([^()]{1,40})\)/g, (_, n) => { notes.push(n.trim()); return " "; });
  head = head.replace(/[\s.…·:\-–—_=*|]+$/g, "").replace(/\s+/g, " ").trim();
  if (!head || !/[a-z]/i.test(head)) return null;
  if (/\d{3,}/.test(head)) check.push("Name contains numbers");
  if (/[^a-z0-9\s&'’,./()+-]/i.test(head)) check.push("Unusual characters — check the spelling");

  let price = Number(m[1]);
  if (m[2]) {
    // "Half/Full": keep the full price, mention the half price in the note.
    notes.push(`Half ₹${m[1]}`);
    price = Number(m[2]);
    check.push("Two prices — kept the second (Full)");
  }
  if (price === 0) check.push("Price is 0");
  if (price > 5000) check.push("Price looks high");
  return { name: titleCase(head), price, note: notes.join(" · "), check };
};

const isHeading = (line) => {
  const s = line.trim();
  if (!s || s.length > 40 || /\d/.test(s)) return false;
  const letters = s.replace(/[^a-z]/gi, "");
  if (letters.length < 3) return false;
  // ALL CAPS, or ends with ":" / "-", or a short line of 1–3 words
  return s === s.toUpperCase() || /[:\-–—]\s*$/.test(s) || s.split(/\s+/).length <= 3;
};

/**
 * Free text (pasted, or read from a photo / PDF) → candidate rows.
 */
export const parseMenuText = (text, { defaultCategory = "Imported" } = {}) => {
  const rows = [];
  let section = "";
  const sections = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const item = parseMenuLine(line);
    if (item) {
      const { tag, tags } = guessFoodType(item.name);
      rows.push({
        name: item.name, price: item.price, description: item.note,
        category: section || defaultCategory, sourceSection: section, tag, tags,
        check: item.check,
      });
    } else if (isHeading(line)) {
      section = cleanHeading(line);
      if (section && !sections.includes(section)) sections.push(section);
    }
  }
  return { rows, sections };
};

// ── CSV ─────────────────────────────────────────────────────────────────────
/** RFC-4180-ish: quoted fields, "" escapes, commas or semicolons. */
export const splitCsv = (text) => {
  const src = String(text || "").replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] || "";
  const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";" : ",";
  const out = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim())) out.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) out.push(row);
  return out;
};

const COLS = {
  name: ["item name", "item", "name", "dish", "dish name", "product", "menu item", "title"],
  price: ["price", "rate", "amount", "mrp", "cost", "selling price", "full", "full price"],
  half: ["half", "half price"],
  category: ["category", "section", "group", "menu section", "type of dish", "course"],
  type: ["type", "veg", "veg/non-veg", "veg / non-veg", "food type", "veg or non veg", "diet"],
  note: ["note", "notes", "remarks", "remark", "description", "details"],
  tags: ["tags", "labels", "diner tags"],
};
const norm = (h) => String(h || "").toLowerCase().replace(/[^a-z/ ]/g, " ").replace(/\s+/g, " ").trim();

/** Header row → { name: index, price: index, … } (first match per field). */
export const matchColumns = (header) => {
  const map = {};
  const used = new Set();
  for (const [field, names] of Object.entries(COLS)) {
    const idx = header.findIndex((h, i) => !used.has(i) && names.includes(norm(h)));
    if (idx >= 0) { map[field] = idx; used.add(idx); }
  }
  return map;
};

const parseType = (v, name) => {
  const s = norm(v);
  if (!s) return guessFoodType(name).tag;
  if (/non|nv|egg|meat|chicken|fish/.test(s)) return "Non Veg";
  if (/veg|^v$|yes/.test(s)) return "Veg";
  return guessFoodType(name).tag;
};
const parsePrice = (v) => {
  const m = /(\d{1,6}(?:\.\d{1,2})?)/.exec(String(v || "").replace(/,/g, ""));
  return m ? Number(m[1]) : NaN;
};

export const parseMenuCsv = (text, { defaultCategory = "Imported" } = {}) => {
  const table = splitCsv(text);
  if (!table.length) return { rows: [], sections: [], columns: {} };
  const cols = matchColumns(table[0]);
  if (cols.name === undefined || (cols.price === undefined && cols.half === undefined)) {
    const e = new Error("Couldn't find the Name and Price columns — the first row must be headings like Name, Price, Category, Type, Note");
    e.statusCode = 422;
    throw e;
  }
  const rows = [];
  const sections = [];
  for (const r of table.slice(1)) {
    const name = String(r[cols.name] ?? "").trim().replace(/\s+/g, " ");
    if (!name) continue;
    const check = [];
    let price = cols.price !== undefined ? parsePrice(r[cols.price]) : NaN;
    const half = cols.half !== undefined ? parsePrice(r[cols.half]) : NaN;
    const notes = [];
    if (cols.note !== undefined && String(r[cols.note] ?? "").trim()) notes.push(String(r[cols.note]).trim());
    if (Number.isNaN(price) && !Number.isNaN(half)) { price = half; check.push("Only a Half price — used it"); }
    else if (!Number.isNaN(half)) notes.push(`Half ₹${half}`);
    if (Number.isNaN(price)) { price = 0; check.push("No price found"); }
    const category = (cols.category !== undefined && String(r[cols.category] ?? "").trim()) || defaultCategory;
    if (!sections.includes(category)) sections.push(category);
    const guess = guessFoodType(name);
    const ownTags = cols.tags !== undefined
      ? String(r[cols.tags] ?? "").split(/[,;|]/).map((t) => t.trim()).filter(Boolean)
      : [];
    rows.push({
      name, price, description: notes.join(" · "), category, sourceSection: category,
      tag: parseType(cols.type !== undefined ? r[cols.type] : "", name),
      tags: ownTags.length ? ownTags : guess.tags,
      check,
    });
  }
  return { rows, sections, columns: cols };
};
