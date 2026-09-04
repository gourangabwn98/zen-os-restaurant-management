import api from "./api.js";
import { STORAGE } from "../theme.js";

// ── Guest order tokens ──────────────────────────────────────────────────────
// Each guest order returns a short-lived token proving "this browser placed
// this order" (see backend utils/guestOrderToken.js). We keep a small map of
// orderId -> token in localStorage so a guest can view/cancel/track their
// own orders across page reloads without ever needing an account.
const TOKENS_KEY = "sohoj_guest_order_tokens";

const readTokenMap = () => {
  try { return JSON.parse(localStorage.getItem(TOKENS_KEY)) || {}; }
  catch { return {}; }
};
const writeTokenMap = (map) => localStorage.setItem(TOKENS_KEY, JSON.stringify(map));

export const saveGuestOrderToken = (orderId, token) => {
  if (!orderId || !token) return;
  const map = readTokenMap();
  map[orderId] = token;
  writeTokenMap(map);
};
export const getGuestOrderToken = (orderId) => readTokenMap()[orderId] || null;
export const listGuestOrderIds = () => Object.keys(readTokenMap());

const guestHeaders = (orderId) => {
  const token = getGuestOrderToken(orderId);
  return token ? { "x-guest-order-token": token } : {};
};

// ── Idempotency ──────────────────────────────────────────────────────────
// One key per "checkout attempt" — regenerated only when the cart/checkout
// form actually changes, so a double-tap or a flaky network retry can never
// create two orders (see backend services/orderService.js placeOrderTx).
export const newIdempotencyKey = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

// ── API calls ──────────────────────────────────────────────────────────────
export const placeOrder = (body) => api.post("/orders", body);

export const getOrder = (id) => api.get(`/orders/${id}`, { headers: guestHeaders(id) });

export const cancelOrder = (id, reason) =>
  api.delete(`/orders/${id}`, { data: { reason }, headers: guestHeaders(id) });

// Logged-in only.
export const getMyOrders = () => api.get("/orders/my");

// Guest history — we only know about orders whose id we stored locally, so
// fetch each individually (fine for the small counts a single browser will
// realistically accumulate).
export const getGuestOrderHistory = async () => {
  const ids = listGuestOrderIds();
  const results = await Promise.allSettled(ids.map((id) => getOrder(id)));
  return results
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value.data)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
};

export const isLoggedIn = () => !!localStorage.getItem(STORAGE.customerToken);
