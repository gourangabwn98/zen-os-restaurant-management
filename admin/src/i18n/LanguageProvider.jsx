// src/i18n/LanguageProvider.jsx
// Owns the English / Bengali choice for the admin app. Stored per browser
// (localStorage) — a viewer preference, like the theme's local copy.
// The module-level language (core.js) is updated BEFORE React re-renders, so
// every t()/fmt*() call in that render already uses the new language.
import { useCallback, useEffect, useState } from "react";
import { LangContext } from "./langContext.js";
import { LANGS, readStoredLang, writeStoredLang, setCurrentLang } from "./core.js";

const initial = () => {
  const lang = readStoredLang();
  setCurrentLang(lang);
  return lang;
};

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(initial);

  // DOM write only: <html lang> drives fonts, screen readers and hyphenation.
  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next) => {
    if (!LANGS.includes(next)) return;
    setCurrentLang(next);
    writeStoredLang(next);
    setLangState(next);
  }, []);

  return (
    <LangContext.Provider value={{ lang, setLang }}>
      {/* key: remount on switch so every screen — including memoised parts
          and module-level label maps — re-reads the new language. Pages keep
          their place because AdminLayout stores the open page outside React. */}
      <div key={lang} style={{ display: "contents" }}>{children}</div>
    </LangContext.Provider>
  );
}
