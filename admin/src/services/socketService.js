// src/services/socketService.js
import { io } from "socket.io-client";

// Backend address: config/runtimeConfig.js (config.js → VITE_API_URL → same origin).
import { SOCKET_URL, SOCKET_PATH } from "../config/runtimeConfig.js";

let socket = null;

/** Lazily creates (or reuses) a single shared socket connection, authenticated
 * as this admin via their JWT (server resolves role + joins the staff room). */
export const getSocket = () => {
  if (socket) return socket;
  const token = localStorage.getItem("adminToken");
  if (!token) return null;
  socket = io(SOCKET_URL, {
    path: SOCKET_PATH,
    auth: { token },
    transports: ["websocket", "polling"],
  });
  return socket;
};

export const disconnectSocket = () => {
  if (socket) { socket.disconnect(); socket = null; }
};
