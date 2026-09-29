// src/services/notificationService.js — Admin "Offers" broadcast
import api from "./api.js";

// couponCode is optional ("" = none); the server uppercases and validates it.
export const sendOfferNotification = ({ title, body, couponCode }) =>
  api.post("/notifications/admin/send", { title, body, couponCode });

export const getNotificationHistory = () => api.get("/notifications/admin/history");
