import api from "./api.js";

// GET /api/coupons — only coupons live right now (server clock decides).
export const getLiveCoupons = () => api.get("/coupons");
// GET /api/coupons/check/:code — 400 with a readable message if not usable.
export const checkCoupon = (code) => api.get(`/coupons/check/${encodeURIComponent(code.trim())}`);
