import axios from "axios";
import { API_URL } from "../config/runtimeConfig.js";
import { STORAGE } from "../theme.js";
import { withSavedData, clearSavedData } from "../offline/savedData.js";

const LOCAL_SERVER = typeof window !== "undefined" && window.__ZEN_CONFIG__?.localServer === true;

const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(STORAGE.token);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Offline: successful GETs are saved per login; when the server can't be
// reached, the same GET returns the saved copy (see offline/savedData.js).
// Offline Edition only: a revoked device / ended PIN session answers
// SESSION_EXPIRED — go back to the login screen (as admin and waiter do).
// Cloud behaviour is unchanged (LOCAL_SERVER is false there).
let redirecting = false;
api.interceptors.response.use(
  (res) => res,
  (error) => {
    const code = error.response?.data?.code;
    if (LOCAL_SERVER && (code === "SESSION_EXPIRED" || code === "ACCOUNT_INACTIVE") && !redirecting && !window.location.pathname.startsWith("/login")) {
      redirecting = true;
      localStorage.removeItem(STORAGE.token);
      localStorage.removeItem(STORAGE.user);
      clearSavedData();
      setTimeout(() => window.location.assign("/login"), 300);
    }
    return Promise.reject(error);
  },
);

withSavedData(api, () => localStorage.getItem(STORAGE.token));

export default api;
