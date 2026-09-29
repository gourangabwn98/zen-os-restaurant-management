// src/services/notificationService.js — Admin "Offers" broadcast
import api from "./api.js";

// couponCode is optional ("" = none); the server uppercases and validates it.
// startsAt / expiresAt: ISO strings or null. A future startsAt schedules the
// offer — the server pushes it automatically at that time.
export const sendOfferNotification = ({ title, body, couponCode, startsAt, expiresAt }) =>
  api.post("/notifications/admin/send", { title, body, couponCode, startsAt, expiresAt });

// Cancel an offer that is still SCHEDULED (409 if it has already gone out).
export const cancelScheduledOffer = (id) => api.post(`/notifications/admin/${id}/cancel`);

export const getNotificationHistory = () => api.get("/notifications/admin/history");
