import { useState, useCallback, useEffect } from "react";
import { STORAGE } from "../theme.js";

const readUser = () => {
  try { return JSON.parse(localStorage.getItem(STORAGE.customerUser)) || null; }
  catch { return null; }
};

export function useAuth() {
  const [user, setUser] = useState(readUser);

  // Keep in sync if another tab logs in/out.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === STORAGE.customerUser) setUser(readUser());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const login = useCallback((data) => {
    localStorage.setItem(STORAGE.customerToken, data.token);
    const u = { _id: data._id, name: data.name, phone: data.phone };
    localStorage.setItem(STORAGE.customerUser, JSON.stringify(u));
    setUser(u);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE.customerToken);
    localStorage.removeItem(STORAGE.customerUser);
    setUser(null);
  }, []);

  const updateLocal = useCallback((patch) => {
    setUser((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem(STORAGE.customerUser, JSON.stringify(next));
      return next;
    });
  }, []);

  return { user, isLoggedIn: !!user, login, logout, updateLocal };
}
