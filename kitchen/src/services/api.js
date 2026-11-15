import axios from "axios";
import { API_URL } from "../config/runtimeConfig.js";
import { STORAGE } from "../theme.js";

const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(STORAGE.token);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default api;
