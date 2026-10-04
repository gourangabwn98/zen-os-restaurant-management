// src/context/ThemeProvider.jsx
// Owns the Light / Dark preference for the admin panel (GLB-05 — there is no
// Auto/System mode any more).
//
//   mode       — the user's stored choice: "light" | "dark"
//   effective  — what is painted (same as mode; kept for existing callers)
//   setMode(m) — change it; writes localStorage + (when signed in) the backend
//
// A value saved by an older build ("system") is converted ONCE to whatever
// the device was showing at that moment and saved back — so nobody's screen
// changes look on upgrade, and it never flips by itself afterwards.
// First paint is handled by the inline script in index.html (same rule).
import { useCallback, useEffect, useRef, useState } from "react";
import { ThemeContext, THEME_MODES, THEME_STORAGE_KEY } from "./themeContext.js";
import { useAuth } from "../hooks/useAuth.js";
import { getMyProfile, updateThemePreference } from "../services/authService.js";

const matchDark = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-color-scheme: dark)").matches;

/** Legacy "system" (or nothing saved) → the look the device shows right now. */
const resolveLegacy = () => (matchDark() ? "dark" : "light");

const readStoredMode = () => {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (THEME_MODES.includes(v)) return v;
    const fixed = resolveLegacy();
    localStorage.setItem(THEME_STORAGE_KEY, fixed); // migrate once
    return fixed;
  } catch {
    return "dark";
  }
};

const writeStoredMode = (mode) => {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    /* private mode / storage disabled — in-memory only */
  }
};

export function ThemeProvider({ children }) {
  const { user } = useAuth();
  const [mode, setModeState] = useState(readStoredMode);
  const hydratedForToken = useRef(null);
  const effective = mode;

  // paint it (DOM write only)
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = effective;
    }
  }, [effective]);

  const setMode = useCallback(
    (next) => {
      if (!THEME_MODES.includes(next)) return;
      setModeState(next);
      writeStoredMode(next);
      if (user) {
        // fire-and-forget: the UI already reflects the choice locally
        updateThemePreference(next).catch(() => {});
      }
    },
    [user],
  );

  // On login, adopt the account's saved preference (once per token); on logout,
  // arm it to hydrate again next sign-in.
  useEffect(() => {
    const token = user?.token || null;
    if (!token) {
      hydratedForToken.current = null;
      return;
    }
    if (hydratedForToken.current === token) return;
    hydratedForToken.current = token;
    getMyProfile()
      .then((res) => {
        const pref = res?.data?.themePreference;
        if (THEME_MODES.includes(pref) && pref !== readStoredMode()) {
          setModeState(pref);
          writeStoredMode(pref);
        } else if (pref === "system") {
          // Saved by an older build — keep what this device shows, and save it.
          updateThemePreference(readStoredMode()).catch(() => {});
        }
      })
      .catch(() => {
        /* keep the local choice if the profile call fails */
      });
  }, [user]);

  return (
    <ThemeContext.Provider value={{ mode, effective, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}
