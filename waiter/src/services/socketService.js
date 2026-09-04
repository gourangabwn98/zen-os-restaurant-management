import { io } from "socket.io-client";
import { STORAGE } from "../theme.js";

const SOCKET_URL = (import.meta.env.VITE_API_URL || "").replace(/\/api\/?$/, "");
let socket = null;

export const getSocket = () => {
  if (socket) return socket;
  const token = localStorage.getItem(STORAGE.token);
  if (!token) return null;
  socket = io(SOCKET_URL, { auth: { token }, transports: ["websocket", "polling"] });
  return socket;
};

export const disconnectSocket = () => {
  if (socket) { socket.disconnect(); socket = null; }
};
