// src/context/themeContext.js
// Context object only — kept in a component-free file so React Fast Refresh
// stays happy (same split the codebase uses for hooks/useAuth.js).
import { createContext } from "react";

export const THEME_STORAGE_KEY = "adsCafeTheme";
export const THEME_MODES = ["light", "dark", "system"];

export const ThemeContext = createContext({
  mode: "system",       // the user's stored choice: light | dark | system
  effective: "dark",    // what's actually applied to <html data-theme>: light | dark
  setMode: () => {},
});
