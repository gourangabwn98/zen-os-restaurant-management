// src/services/api.js
import axios from "axios";
import toast from "react-hot-toast";

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL });

// Single-restaurant mode: the backend is always process.env.MONGO_URI on its
// end — the client only ever needs to attach its own JWT, never any
// restaurant-identifying header.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("adminToken");
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
      localStorage.removeItem("adminToken");
      localStorage.removeItem("adminUser");
      toast.error(error.response.data.message || "Please log in again");
      setTimeout(() => window.location.assign("/login"), 1200);
    }
    return Promise.reject(error);
  },
);

export default api;
