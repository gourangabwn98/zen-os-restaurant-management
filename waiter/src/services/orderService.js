import api from "./api.js";

// ── Central order system — same POST used by customer/admin. Source is
// derived server-side from the authenticated waiter identity, so this order
// is auto-CONFIRMED (with KOT job created) the instant it's placed. ────────
export const placeOrder = (body) => api.post("/orders", body);

export const getOrder = (id) => api.get(`/orders/${id}`);
export const confirmOrder = (id) => api.patch(`/orders/${id}/confirm`);
export const rejectOrder  = (id, reason) => api.patch(`/orders/${id}/reject`, { reason });
export const cancelOrder  = (id, reason) => api.delete(`/orders/${id}`, { data: { reason } });

// ── Staff order management ────────────────────────────────────────────────
export const getAllOrders     = (params) => api.get("/admin/orders", { params });
export const updateOrderStatus = (id, status, note) => api.put(`/admin/orders/${id}/status`, { status, note });
export const addItemsToOrder   = (id, items) => api.post(`/admin/orders/${id}/add-items`, { items });
// Edit a not-yet-sent (PENDING_CONFIRMATION) order: full item list + the
// order's current revision — 409 if someone else changed it first.
export const modifyOrderItems  = (id, items, revision) => api.patch(`/orders/${id}/items`, { items, revision });
export const updateOrderPayment = (id, body) => api.patch(`/admin/orders/${id}/payment`, body);
// BIL-01/BIL-02 — settle bills (records the payment when not yet paid);
// a served order is completed by the server as a result, never by hand.
export const settleOrders = (orderIds, paymentMethod) => api.post("/admin/orders/settle", { orderIds, paymentMethod });

// ── Billing ────────────────────────────────────────────────────────────────
export const getCombinedBill = (params) => api.get("/admin/orders/combined-bill", { params });
export const printBill       = (id) => api.post(`/admin/orders/${id}/print-bill`);

export const newIdempotencyKey = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
