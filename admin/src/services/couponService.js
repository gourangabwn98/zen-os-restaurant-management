// src/services/couponService.js — Admin "Coupons" (restaurant-server/services/couponService.js)
import api from "./api.js";

// startsAt / endsAt: ISO strings. The server validates every field and
// uppercases the code; the discount itself is only ever computed server-side.
export const getAllCoupons = () => api.get("/coupons/admin");
export const createCoupon  = (data) => api.post("/coupons/admin", data);
export const updateCoupon  = (id, data) => api.put(`/coupons/admin/${id}`, data);
export const deleteCoupon  = (id) => api.delete(`/coupons/admin/${id}`);

// Admin → Offers: read-only reach / results / signals, and a cost check of a
// draft's terms against recent bills (restaurant-server/services/offerStatsService.js).
export const getOfferStats = () => api.get("/coupons/admin/stats");
export const checkOffer    = (terms) => api.post("/coupons/admin/check", terms);
