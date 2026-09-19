// src/services/notificationService.js — Admin "Offers" broadcast
import api from "./api.js";

export const sendOfferNotification = ({ title, body }) =>
  api.post("/notifications/admin/send", { title, body });

export const getNotificationHistory = () => api.get("/notifications/admin/history");
