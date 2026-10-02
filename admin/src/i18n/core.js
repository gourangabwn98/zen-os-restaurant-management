// src/i18n/core.js
// ─────────────────────────────────────────────────────────────────────────────
// Hand-rolled English / Bengali support for the admin app (no i18n library —
// see CLAUDE.md "keep frontend dependencies minimal").
//
//   • Keys ARE the English text:  t("Save recipe")  → "রেসিপি সেভ করুন" in bn,
//     "Save recipe" in en. A missing Bengali entry falls back to English, so
//     nothing ever renders blank. `npm run i18n:check` lists missing entries.
//   • Placeholders:  t("{n} orders today", { n: 5 })  — numbers in vars are
//     formatted with the active locale, so Bengali gets Bengali digits.
//   • Plurals:  tn(count, "{n} order", "{n} orders")  — English picks by count;
//     Bengali dictionaries usually map both to the same text.
//   • Formatting (Bengali digits / month names in bn):  fmtNum, fmtMoney,
//     fmtDate, fmtDateTime, fmtTime, and LOCALE() for any toLocale* call.
//   • Admin-typed data:  localName(doc)  → doc.nameBn in bn when it's filled,
//     else doc.name (menu items, categories, stock items, order lines).
//
// The active language lives in this module (set by LanguageProvider before
// it re-renders), so plain functions — toasts, CSV export, module-level
// helpers — translate correctly without a hook.
// ─────────────────────────────────────────────────────────────────────────────
import BN from "./bn/index.js";

export const LANGS = ["en", "bn"];
export const LANG_STORAGE_KEY = "adsCafeLang";

let current = "en";
const LOCALES = { en: "en-IN", bn: "bn-IN" };

export const getLang = () => current;
export const setCurrentLang = (lang) => { current = LANGS.includes(lang) ? lang : "en"; };
/** Locale for Intl / toLocaleString: "en-IN" or "bn-IN" (Bengali digits). */
export const LOCALE = () => LOCALES[current];

export const readStoredLang = () => {
  try {
    const v = localStorage.getItem(LANG_STORAGE_KEY);
    return LANGS.includes(v) ? v : "en";
  } catch {
    return "en";
  }
};
export const writeStoredLang = (lang) => {
  try { localStorage.setItem(LANG_STORAGE_KEY, lang); } catch { /* storage disabled — in-memory only */ }
};

const warned = new Set();
const lookup = (text) => {
  if (current !== "bn" || text == null) return text;
  const hit = BN[text];
  if (hit != null) return hit;
  if (import.meta.env?.DEV && !warned.has(text)) {
    warned.add(text);
    console.warn(`[i18n] missing Bengali for: ${JSON.stringify(text)}`);
  }
  return text;
};

const fill = (str, vars) => {
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (m, k) => {
    if (!(k in vars)) return m;
    const v = vars[k];
    return typeof v === "number" ? fmtNum(v) : String(v ?? "");
  });
};

/** Translate English UI text (the key) into the active language. */
export const t = (text, vars) => fill(lookup(text), vars);

/**
 * Marks English text for translation WITHOUT translating it yet (gettext's
 * N_). Use in module-level label maps, then call t(label) where it renders —
 * lets `npm run i18n:check` find the string.
 */
export const N_ = (text) => text;

/** Plural-aware t: tn(3, "{n} item", "{n} items") — `n` is filled automatically. */
export const tn = (count, one, other, vars) => t(count === 1 ? one : other, { n: count, ...vars });

/** Translate a canonical enum value through a label map, e.g. tLabel(STATUS_LABEL, "CONFIRMED"). */
export const tLabel = (map, value) => t(map?.[value] ?? value);

// ── formatting ──────────────────────────────────────────────────────────────
export const fmtNum = (n, opts = { maximumFractionDigits: 2 }) =>
  Number(n || 0).toLocaleString(LOCALE(), opts);

export const fmtMoney = (n, opts = { maximumFractionDigits: 2 }) => `₹${fmtNum(n, opts)}`;

const asDate = (d) => (d instanceof Date ? d : new Date(d));
const valid = (d) => d != null && d !== "" && !Number.isNaN(asDate(d).getTime());

export const fmtDate = (d, opts = { day: "2-digit", month: "short", year: "numeric" }) =>
  valid(d) ? asDate(d).toLocaleDateString(LOCALE(), opts) : "—";
export const fmtDateTime = (d, opts = { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) =>
  valid(d) ? asDate(d).toLocaleString(LOCALE(), opts) : "—";
export const fmtTime = (d, opts = { hour: "2-digit", minute: "2-digit" }) =>
  valid(d) ? asDate(d).toLocaleTimeString(LOCALE(), opts) : "—";

// ── admin-entered data ──────────────────────────────────────────────────────
/** Bengali name when the language is bn and one was entered, else the English name. */
export const localName = (doc, field = "name") => {
  if (!doc) return "";
  if (typeof doc === "string") return doc;
  const bn = doc[`${field}Bn`];
  return current === "bn" && bn && String(bn).trim() ? bn : doc[field] ?? "";
};
