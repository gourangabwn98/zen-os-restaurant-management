import { STORAGE_KEY } from "../theme.js";
// ─── src/context/AuthContext.jsx ──────────────────────────────────────────────
import { createContext, useState } from "react";
export const AuthContext = createContext(null);

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
    localStorage.removeItem("adminToken");
    localStorage.removeItem("adminUser");
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoggedIn: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}