// src/services/deliveryAdminService.js — Admin → Delivery (restaurant-server
// routes/deliveryRoutes.js, /api/delivery/admin/*). Admin + manager; the
// settings PATCH is admin-only on the server too.
import api from "./api.js";

const base = "/delivery/admin";
export const getDeliveryOverview = () => api.get(`${base}/overview`);
export const getDeliveryJobs = (params) => api.get(`${base}/jobs`, { params });
export const getDeliveryJobEvents = (jobId) => api.get(`${base}/jobs/${jobId}/events`);
export const assignDeliveryJob = (jobId, partnerId) => api.post(`${base}/jobs/${jobId}/assign`, { partnerId });
export const unassignDeliveryJob = (jobId, reason) => api.post(`${base}/jobs/${jobId}/unassign`, { reason });
export const rebroadcastDeliveryJob = (jobId) => api.post(`${base}/jobs/${jobId}/rebroadcast`);
export const cancelDeliveryJob = (jobId, reason) => api.post(`${base}/jobs/${jobId}/cancel`, { reason });
export const resetDeliveryOtp = (jobId) => api.post(`${base}/jobs/${jobId}/reset-otp`);
export const revokeDeliveryTracking = (jobId) => api.post(`${base}/jobs/${jobId}/revoke-tracking`);
export const getDeliveryPartners = () => api.get(`${base}/partners`);
export const updateDeliveryPartner = (partnerId, body) => api.patch(`${base}/partners/${partnerId}`, body);
export const forcePartnerOffline = (partnerId) => api.post(`${base}/partners/${partnerId}/force-offline`);
export const getDeliveryLive = () => api.get(`${base}/live`);
export const getDeliveryReports = (params) => api.get(`${base}/reports`, { params });
export const getCodCollections = (params) => api.get(`${base}/cod`, { params });
export const verifyCodCollection = (id, note) => api.post(`${base}/cod/${id}/verify`, { note });
export const disputeCodCollection = (id, reason) => api.post(`${base}/cod/${id}/dispute`, { reason });
export const getDeliverySettings = () => api.get(`${base}/settings`);
export const updateDeliverySettings = (body) => api.patch(`${base}/settings`, body);

/** Server message for a failed call, or the fallback. */
export const errMsg = (err, fallback) => err?.response?.data?.message || fallback;
