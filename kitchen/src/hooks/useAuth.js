import { useState, useCallback } from "react";
import { STORAGE } from "../theme.js";
import { clearSavedData } from "../offline/savedData.js";
import { localLogout } from "../local/localAuth.js";

const readUser = () => {
  try { return JSON.parse(localStorage.getItem(STORAGE.user)) || null; }
  catch { return null; }
};

export function useAuth() {
  const [user, setUser] = useState(readUser);

  const login = useCallback((data) => {
    localStorage.setItem(STORAGE.token, data.token);
    const u = { name: data.name, phone: data.phone, role: data.role, restaurantName: data.restaurantName };
    localStorage.setItem(STORAGE.user, JSON.stringify(u));
    setUser(u);
  }, []);

  const logout = useCallback(() => {
    localLogout(localStorage.getItem(STORAGE.token)); // Offline Edition: end the PIN session on the server (no-op in the cloud)
    localStorage.removeItem(STORAGE.token);
    localStorage.removeItem(STORAGE.user);
    clearSavedData(); // offline copies of this login's data (may include guest details)
    setUser(null);
  }, []);

  return { user, isLoggedIn: !!user, login, logout };
}
