// src/services/socketService.js
import { io } from "socket.io-client";

const SOCKET_URL = (import.meta.env.VITE_API_URL || "").replace(/\/api\/?$/, "");

let socket = null;

/** Lazily creates (or reuses) a single shared socket connection, authenticated
 * as this admin via their JWT (server resolves role + joins the staff room). */
export const getSocket = () => {
  if (socket) return socket;
  const token = localStorage.getItem("adminToken");
  if (!token) return null;
  socket = io(SOCKET_URL, {
    auth: { token },
    transports: ["websocket", "polling"],
  });
  return socket;
};

export const disconnectSocket = () => {
  if (socket) { socket.disconnect(); socket = null; }
};
