// src/i18n/langContext.js
// Context object only — kept component-free so React Fast Refresh stays happy
// (same split as context/themeContext.js).
import { createContext } from "react";

export const LangContext = createContext({
  lang: "en",
  setLang: () => {},
});
