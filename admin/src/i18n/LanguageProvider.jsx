// src/i18n/LanguageProvider.jsx
// Owns the English / Bengali choice for the admin app. Stored per browser
// (localStorage) — a viewer preference, like the theme's local copy.
// The module-level language (core.js) is updated BEFORE React re-renders, so
// every t()/fmt*() call in that render already uses the new language.
import { useCallback, useEffect, useState } from "react";
import { LangContext } from "./langContext.js";
import { LANGS, readStoredLang, writeStoredLang, setCurrentLang, loadLang, isLangLoaded } from "./core.js";

// Only switch the module-level language once its dictionary is loaded, so
// nothing ever renders half-translated (Bengali digits on English text).
const initial = () => {
  const lang = readStoredLang();
  if (isLangLoaded(lang)) setCurrentLang(lang);
  return lang;
};

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(initial);
  const [ready, setReady] = useState(() => isLangLoaded(lang));

  // A saved Bengali choice: fetch the dictionary, then render (cached after
  // the first visit, so this is a few ms).
  useEffect(() => {
    if (ready) return undefined;
    let alive = true;
    loadLang(lang).finally(() => { if (alive) { setCurrentLang(lang); setReady(true); } });
    return () => { alive = false; };
  }, [lang, ready]);

  // DOM write only: <html lang> drives fonts, screen readers and hyphenation.
  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next) => {
    if (!LANGS.includes(next)) return;
    writeStoredLang(next);
    loadLang(next).then(() => {
      setCurrentLang(next);
      setLangState(next);
    });
  }, []);

  return (
    <LangContext.Provider value={{ lang, setLang }}>
      {/* GLB-04: NO remount on switch — a remount threw away half-filled
          forms, selections and open dialogs. App.jsx subscribes to the
          language instead, so the whole tree re-renders in place (module-level
          label maps are N_() keys translated at render time). */}
      {ready ? children : null}
    </LangContext.Provider>
  );
}
