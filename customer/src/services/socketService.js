import { io } from "socket.io-client";
import { STORAGE } from "../theme.js";

// Socket.IO listens on the same server as the REST API, at the root
// (not under /api) — derive that from VITE_API_URL.
const SOCKET_URL = (import.meta.env.VITE_API_URL || "").replace(/\/api\/?$/, "");

let socket = null;

/** Lazily creates (or reuses) a single shared socket connection. */
export const getSocket = () => {
  if (socket) return socket;
  const token = localStorage.getItem(STORAGE.customerToken);
  socket = io(SOCKET_URL, {
    auth: token ? { token } : {},
    transports: ["websocket", "polling"],
    withCredentials: false,
  });
  return socket;
};

/** Subscribes to realtime updates for one order. Returns an unsubscribe fn. */
export const subscribeToOrder = (orderId, guestOrderToken, onUpdate) => {
  const s = getSocket();
  s.emit("join-order", { orderId, guestOrderToken });

  const handler = (payload) => {
    const order = payload?.order;
    if (order && String(order._id) === String(orderId)) onUpdate(order);
  };

  s.on("order:confirmed", handler);
  s.on("order:status_changed", handler);
  s.on("order:cancelled", handler);
  s.on("order:payment_changed", handler);

  return () => {
    s.off("order:confirmed", handler);
    s.off("order:status_changed", handler);
    s.off("order:cancelled", handler);
    s.off("order:payment_changed", handler);
  };
};

export const disconnectSocket = () => {
  if (socket) { socket.disconnect(); socket = null; }
};
