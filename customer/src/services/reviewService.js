// src/services/reviewService.js — rate a paid order (food → chef, service →
// waiter). Ownership: logged-in customer, or the guest token for that order.
import api from "./api.js";
import { getGuestOrderToken } from "./orderService.js";

const guestHeaders = (orderId) => {
  const t = getGuestOrderToken(orderId);
  return t ? { "x-guest-order-token": t } : {};
};

export const getReviewState = (orderId) =>
  api.get(`/reviews/order/${orderId}`, { headers: guestHeaders(orderId) });

export const submitReview = (orderId, body) =>
  api.post(`/reviews/order/${orderId}`, body, { headers: guestHeaders(orderId) });
