import api from "./api.js";
import { getGuestOrderToken } from "./orderService.js";

// A guest proves "this browser placed this order" with the same token used for
// view/cancel (see orderService.js). Logged-in customers use their JWT (added
// by the api interceptor).
const guestHeaders = (orderId) => {
  const t = getGuestOrderToken(orderId);
  return t ? { "x-guest-order-token": t } : {};
};

// POST /api/payments/phonepe/initiate → { redirectUrl }
// The caller redirects the browser to redirectUrl (PhonePe's hosted page).
export const initiatePhonePePayment = (orderId) =>
  api.post("/payments/phonepe/initiate", { orderId }, { headers: guestHeaders(orderId) });

// GET /api/payments/phonepe/status/:orderId → { paymentStatus, paymentMethod, paymentState }
// Does a live gateway status check server-side; safe to call repeatedly.
export const getPhonePePaymentStatus = (orderId) =>
  api.get(`/payments/phonepe/status/${orderId}`, { headers: guestHeaders(orderId) });
