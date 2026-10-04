// src/i18n/index.jsx — GLB-04 English / বাংলা for the Waiter app.
// ─────────────────────────────────────────────────────────────────────────────
// Same approach as the admin app (admin/src/i18n/core.js), kept small:
//   • keys ARE the English text: t("Served") → "পরিবেশন হয়েছে" in bn; a
//     missing Bengali entry falls back to English, so nothing renders blank;
//   • placeholders: t("Table {n}", { n: 4 });  plurals: tn(n, one, other);
//   • N_() marks module-level labels; translate them where they render.
// The choice is stored per device. Switching re-renders the app in place
// (App.jsx subscribes) — it never remounts, so a half-built order, the open
// screen and the login all stay exactly as they were.
// Never translated: menu item names, customer / employee / supplier names —
// anything typed in by people (localName() shows an admin's Bengali name only
// where one was entered).
// ─────────────────────────────────────────────────────────────────────────────
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import BN from "./bn.js";

export const LANGS = ["en", "bn"];
const STORAGE_KEY = "khoaiWaiterLang";

const read = () => {
  try { const v = localStorage.getItem(STORAGE_KEY); return LANGS.includes(v) ? v : "en"; } catch { return "en"; }
};
let current = read();

const fill = (str, vars) => (vars ? str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k] ?? "") : m)) : str);

export const getLang = () => current;
export const t = (text, vars) => fill(current === "bn" && BN[text] != null ? BN[text] : text, vars);
export const N_ = (text) => text;
export const tn = (count, one, other, vars) => t(count === 1 ? one : other, { n: count, ...vars });
/** Admin-entered Bengali name when the language is bn and one exists. */
export const localName = (doc, field = "name") => {
  if (!doc) return "";
  const bn = doc[`${field}Bn`];
  return current === "bn" && bn && String(bn).trim() ? bn : doc[field] ?? "";
};

const LangContext = createContext({ lang: "en", setLang: () => {} });

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(current);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const setLang = useCallback((next) => {
    if (!LANGS.includes(next)) return;
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* storage off — this visit only */ }
    current = next; // before the re-render, so every t() in it is already bn/en
    setLangState(next);
  }, []);
  return <LangContext.Provider value={{ lang, setLang }}>{children}</LangContext.Provider>;
}

export const useLang = () => useContext(LangContext);

/** English / বাংলা switch — each option written in its own language. */
export function LanguageToggle({ style }) {
  const { lang, setLang } = useLang();
  const opt = (value, label) => (
    <button
      key={value} type="button" role="radio" lang={value} aria-checked={lang === value} onClick={() => setLang(value)}
      style={{
        flex: 1, minHeight: 40, borderRadius: 999, border: "none", cursor: "pointer", fontWeight: 800, fontSize: 13,
        background: lang === value ? "#6AA8FF" : "transparent", color: lang === value ? "#0B0E13" : "rgba(255,255,255,0.75)",
      }}
    >
      {label}
    </button>
  );
  return (
    <div role="radiogroup" aria-label={t("Language")} style={{ display: "flex", gap: 4, padding: 4, borderRadius: 999, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)", ...style }}>
      {opt("en", "English")}
      {opt("bn", "বাংলা")}
    </div>
  );
}
