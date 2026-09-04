// src/services/api.js
import axios from "axios";
import { STORAGE } from "../theme.js";

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

export default api;
