import axios from "axios";
import { API_URL } from "../config/runtimeConfig.js";
import { STORAGE } from "../theme.js";
import { withSavedData } from "../offline/savedData.js";

const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(STORAGE.token);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Offline: successful GETs are saved per login; when the server can't be
// reached, the same GET returns the saved copy (see offline/savedData.js).
withSavedData(api, () => localStorage.getItem(STORAGE.token));

export default api;
