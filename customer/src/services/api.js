// src/services/api.js
import axios from "axios";
import toast from "react-hot-toast";
import { STORAGE } from "../theme.js";

/** Fired when the saved login stopped working — hooks/useAuth.js logs out. */
export const AUTH_EXPIRED_EVENT = "auth:expired";

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL });

// Backend is single-restaurant now — no restaurant-identifying header is
// needed for guests. Logged-in customers attach their JWT.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem(STORAGE.customerToken);
  if (token) config.headers.Authorization = `Bearer ${token}`;

  // Lets a logged-out guest's cancel/view actions on their own order work
  // (see services/orderService.js — set per-request, not globally, so it
  // never leaks onto unrelated calls).
  return config;
});

// A login that has expired (server: code SESSION_EXPIRED) — log out and
// retry the same request once as a guest, so e.g. placing an order still
// works (it just isn't linked to the account any more).
api.interceptors.response.use(
  (res) => res,
  (error) => {
    const cfg = error.config;
    if (error.response?.status === 401 && error.response.data?.code === "SESSION_EXPIRED" && cfg && !cfg._retriedAsGuest) {
      localStorage.removeItem(STORAGE.customerToken);
      localStorage.removeItem(STORAGE.customerUser);
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
      toast("Your login expired — you're continuing as a guest. Log in again to save your orders.", { icon: "🔑", duration: 5000 });
      cfg._retriedAsGuest = true;
      if (typeof cfg.headers?.delete === "function") cfg.headers.delete("Authorization");
      else if (cfg.headers) delete cfg.headers.Authorization;
      return api(cfg);
    }
    return Promise.reject(error);
  },
);

export default api;
