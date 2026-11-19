// src/services/deliveryService.js — home delivery for customers.
//   getMyDelivery(orderId)  logged-in owner: status, rider, hand-over code, COD amount, tracking link
//   getTracking(token)      public tracking link (no login) — no code, no phone numbers
import api from "./api.js";
import { getSocket } from "./socketService.js";

export const getMyDelivery = (orderId) => api.get(`/delivery/orders/${orderId}`);
export const getTracking = (token) => api.get(`/delivery/track/${encodeURIComponent(token)}`);

/** Watch one delivery by its tracking token (server checks it). Returns an unsubscribe fn. */
export const watchTracking = (token, { onStatus, onLocation, onJoined }) => {
  const s = getSocket();
  const join = () => s.emit("join-tracking", { token }, (ack) => onJoined?.(!!ack?.ok));
  const status = (p) => onStatus?.(p);
  const loc = (p) => onLocation?.(p);
  join();
  s.on("connect", join); // rejoin after a reconnect
  s.on("delivery:status_updated", status);
  s.on("delivery:location_updated", loc);
  return () => {
    s.off("connect", join);
    s.off("delivery:status_updated", status);
    s.off("delivery:location_updated", loc);
  };
};

const ADDRESS_KEY = "zen.deliveryAddress";
/** The customer's last delivery details on this device (convenience only). */
export const loadSavedAddress = () => { try { return JSON.parse(localStorage.getItem(ADDRESS_KEY)) || null; } catch { return null; } };
export const saveAddress = (a) => { try { localStorage.setItem(ADDRESS_KEY, JSON.stringify(a)); } catch { /* storage off */ } };

/** The tracking page's own URL for a token. */
export const trackingUrl = (token) => `${window.location.origin}/track/${encodeURIComponent(token)}`;
