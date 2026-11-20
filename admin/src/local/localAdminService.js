// src/local/localAdminService.js — Offline Edition admin calls (Admin →
// Devices, first-time setup). Only used when LOCAL_SERVER (localAuth.js).
// Server: restaurant-server/routes/localAuthRoutes.js.
import api from "../services/api.js";

export const getSetupStatus = () => api.get("/local/setup/status");
export const bootstrapRestaurant = (body) => api.post("/local/setup/bootstrap", body);

export const listDevices = () => api.get("/local/devices");
export const approveDevice = (id, body) => api.post(`/local/devices/${id}/approve`, body);
export const rejectDevice = (id) => api.post(`/local/devices/${id}/reject`);
export const revokeDevice = (id, reason) => api.post(`/local/devices/${id}/revoke`, { reason });

export const listPinStatus = () => api.get("/local/staff/pins");
export const setStaffPin = (userId, pin) => api.put(`/local/staff/${userId}/pin`, { pin });
export const changeMyPin = (currentPin, newPin) => api.post("/local/auth/change-pin", { currentPin, newPin });
export const listAuthEvents = (limit = 200) => api.get("/local/auth/events", { params: { limit } });
