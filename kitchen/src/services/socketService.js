import { io } from "socket.io-client";
import { STORAGE } from "../theme.js";
// Backend address: config/runtimeConfig.js (config.js → VITE_API_URL → same origin).
import { SOCKET_URL, SOCKET_PATH } from "../config/runtimeConfig.js";

let socket = null;

export const getSocket = () => {
  if (socket) return socket;
  const token = localStorage.getItem(STORAGE.token);
  if (!token) return null;
  socket = io(SOCKET_URL, { path: SOCKET_PATH, auth: { token }, transports: ["websocket", "polling"] });
  return socket;
};

export const disconnectSocket = () => {
  if (socket) { socket.disconnect(); socket = null; }
};
