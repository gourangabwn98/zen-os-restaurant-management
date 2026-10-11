// Menu / categories / pricing settings for the New order screen — kept for a
// short while so the screen opens instantly instead of waiting ~3 s for the
// menu every time (same idea as the admin app's order-modal cache).
//
// Safety: the screen shows the kept copy only while it is young (TTL) and
// ALWAYS fetches a fresh one at the same time, replacing it when it arrives.
// The server's "menu:updated" event (item switched off, sold out, price)
// drops the kept copy at once. Prices are re-checked by the server on every
// order anyway — this only decides what the screen shows first.
import { getMenu, getMenuCategories } from "./menuService.js";
import { getRestaurantProfile } from "./orderService.js";
import { getSocket } from "./socketService.js";

const TTL = { menu: 60 * 1000, categories: 60 * 1000, profile: 5 * 60 * 1000 };
const FETCH = { menu: () => getMenu(), categories: () => getMenuCategories(), profile: () => getRestaurantProfile() };

const kept = new Map();     // key → { at, data }
const inFlight = new Map(); // key → promise (one request at a time per key)
let listening = null;       // the socket we listen on
const version = new Map();  // key → bumped on "menu:updated"; an older answer isn't kept

const listen = () => {
  const socket = getSocket();
  if (!socket || socket === listening) return;
  listening = socket;
  // Drop the kept copies AND forget a request already running (it may hold
  // the old menu) — the next fetch asks the server again.
  socket.on("menu:updated", () => {
    for (const k of ["menu", "categories"]) { kept.delete(k); inFlight.delete(k); version.set(k, (version.get(k) || 0) + 1); }
  });
};

/** The kept copy if it is still young enough to show, else undefined. */
export const peekOrderData = (key) => {
  listen();
  const hit = kept.get(key);
  return hit && Date.now() - hit.at < TTL[key] ? hit.data : undefined;
};

/** Fetch fresh (deduplicated while one is running) and keep it. */
export const fetchOrderData = (key) => {
  listen();
  if (inFlight.has(key)) return inFlight.get(key);
  const v = version.get(key) || 0;
  const p = FETCH[key]()
    .then(({ data }) => { if ((version.get(key) || 0) === v) kept.set(key, { at: Date.now(), data }); return data; })
    .finally(() => { if (inFlight.get(key) === p) inFlight.delete(key); });
  inFlight.set(key, p);
  return p;
};

/** Warm the cache ahead of time (e.g. from the Tables screen). Never throws. */
export const prefetchOrderData = () => {
  for (const key of Object.keys(FETCH)) if (!peekOrderData(key)) fetchOrderData(key).catch(() => {});
};
