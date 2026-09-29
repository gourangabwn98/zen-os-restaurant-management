// "Call waiter" (restaurant-server/services/waiterCallService.js).
// Guests prove the order is theirs with the same token as view/cancel/pay;
// logged-in customers use their JWT (added by the api interceptor).
import api from "./api.js";
import { getGuestOrderToken } from "./orderService.js";
import { getSocket } from "./socketService.js";

const guestHeaders = (orderId) => {
  const t = getGuestOrderToken(orderId);
  return t ? { "x-guest-order-token": t } : {};
};

// All three return the call state:
// { call: { attempt, status, expiresAt, acknowledgedBy?: { name } } | null,
//   nextAction: "CALL" | "WAIT" | "CALL_AGAIN" | "PHONE", serverNow, adminPhone? }
export const getWaiterCallState = (orderId) =>
  api.get(`/waiter-calls/order/${orderId}`, { headers: guestHeaders(orderId) });

// 409 { code: "CALL_RESTAURANT", adminPhone } once both calls have run out.
export const callWaiter = (orderId) =>
  api.post("/waiter-calls", { orderId }, { headers: guestHeaders(orderId) });

export const withdrawWaiterCall = (orderId) =>
  api.delete(`/waiter-calls/order/${orderId}`, { headers: guestHeaders(orderId) });

/** Live call updates for one order (subscribeToOrder does the room join).
 * The socket may be in several of this customer's order rooms, so updates
 * are filtered by orderId. Returns an unsubscribe fn. */
export const onWaiterCallUpdate = (orderId, cb) => {
  const s = getSocket();
  const handler = (payload) => {
    if (payload?.state && String(payload.state.orderId) === String(orderId)) cb(payload.state);
  };
  s.on("waiter_call:updated", handler);
  return () => s.off("waiter_call:updated", handler);
};
