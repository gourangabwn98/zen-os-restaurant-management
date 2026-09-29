import { useState, useCallback, useEffect } from "react";
import { STORAGE } from "../theme.js";
import { AUTH_EXPIRED_EVENT } from "../services/api.js";

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
    // The server rejected the saved login (services/api.js already cleared it).
    const onExpired = () => setUser(null);
    window.addEventListener("storage", onStorage);
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
    };
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
