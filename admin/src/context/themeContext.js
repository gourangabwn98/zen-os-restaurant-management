// src/context/themeContext.js
// Context object only — kept in a component-free file so React Fast Refresh
// stays happy (same split the codebase uses for hooks/useAuth.js).
import { createContext } from "react";

export const THEME_STORAGE_KEY = "adsCafeTheme";
// GLB-05: Light and Dark only — no Auto/System (it flipped the look mid-shift).
export const THEME_MODES = ["light", "dark"];

export const ThemeContext = createContext({
  mode: "dark",         // the user's stored choice: light | dark
  effective: "dark",    // what's actually applied to <html data-theme>: light | dark
  setMode: () => {},
});
