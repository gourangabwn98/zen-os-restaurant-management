import axios from "axios";
import { API_URL } from "../config/runtimeConfig.js";
import toast from "react-hot-toast";
import { STORAGE } from "../theme.js";
import { withSavedData, clearSavedData } from "../offline/savedData.js";

const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(STORAGE.token);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Expired login or deactivated account (server codes SESSION_EXPIRED /
// ACCOUNT_INACTIVE): clear it and go to the login screen — never carry on
// as if logged in (the server would refuse, or used to treat it as a guest).
let redirecting = false;
api.interceptors.response.use(
  (res) => res,
  (error) => {
    const code = error.response?.data?.code;
    if ((code === "SESSION_EXPIRED" || code === "ACCOUNT_INACTIVE") && !redirecting && !window.location.pathname.startsWith("/login")) {
      redirecting = true;
      localStorage.removeItem(STORAGE.token);
      localStorage.removeItem(STORAGE.user);
      clearSavedData();
      toast.error(error.response.data.message || "Please log in again");
      setTimeout(() => window.location.assign("/login"), 1200);
    }
    return Promise.reject(error);
  },
);

// Offline: successful GETs are saved per login; when the server can't be
// reached, the same GET returns the saved copy (see offline/savedData.js).
withSavedData(api, () => localStorage.getItem(STORAGE.token));

export default api;
