// src/services/api.js
import axios from "axios";

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL });

// Single-restaurant mode: the backend is always process.env.MONGO_URI on its
// end — the client only ever needs to attach its own JWT, never any
// restaurant-identifying header.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("adminToken");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default api;
