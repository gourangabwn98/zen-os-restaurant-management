// src/context/ThemeProvider.jsx
// Owns the light/dark/system preference for the admin panel.
//
//   mode       — the user's stored choice: "light" | "dark" | "system"
//   effective  — what is actually painted: "light" | "dark"
//   setMode(m) — change it; writes localStorage + (when signed in) the backend
//
// First paint is handled by the inline script in index.html so there is no
// flash; this provider then keeps <html data-theme> in sync with React state,
// follows the OS while mode === "system", and — once logged in — adopts the
// server's saved themePreference (User.themePreference, PATCH /api/auth/theme).
import { useCallback, useEffect, useRef, useState } from "react";
import { ThemeContext, THEME_MODES, THEME_STORAGE_KEY } from "./themeContext.js";
import { useAuth } from "../hooks/useAuth.js";
import { getMyProfile, updateThemePreference } from "../services/authService.js";

const matchDark = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-color-scheme: dark)").matches;

const readStoredMode = () => {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return THEME_MODES.includes(v) ? v : "system";
  } catch {
    return "system";
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
  const [systemDark, setSystemDark] = useState(matchDark);
  const hydratedForToken = useRef(null);

  // `effective` is derived, never stored — no setState-in-effect.
  const effective = mode === "system" ? (systemDark ? "dark" : "light") : mode;

  // paint it (DOM write only)
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = effective;
    }
  }, [effective]);

  // track the OS setting; the handler (not an effect) is what calls setState
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e) => setSystemDark(e.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

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
