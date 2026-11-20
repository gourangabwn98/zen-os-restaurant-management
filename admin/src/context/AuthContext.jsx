import { STORAGE_KEY } from "../theme.js";
// ─── src/context/AuthContext.jsx ──────────────────────────────────────────────
import { useState } from "react";
import { AuthContext } from "./authContextObject.js";
import { clearSavedData } from "../offline/savedData.js";
import { localLogout } from "../local/localAuth.js";

// src/context/AuthContext.jsx — make sure BOTH use same key
export function AuthProvider({ children }) {
  // ── INITIAL LOAD — reads from localStorage ──────────────────────────────
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem("adminUser"); // ← key
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });

  const login = (data) => {
    localStorage.setItem("adminToken", data.token);        // ← key 1
    localStorage.setItem("adminUser", JSON.stringify(data)); // ← key 2
    setUser(data);
  };

  const logout = () => {
    localLogout(localStorage.getItem("adminToken")); // Offline Edition: end the PIN session on the server (no-op in the cloud)
    localStorage.removeItem("adminToken");
    localStorage.removeItem("adminUser");
    clearSavedData(); // offline copies of this login's data (may include guest details)
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoggedIn: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}