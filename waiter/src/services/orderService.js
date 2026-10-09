import api from "./api.js";

// ── Central order system — same POST used by customer/admin. Source is
// derived server-side from the authenticated waiter identity, so this order
// is auto-CONFIRMED (with KOT job created) the instant it's placed. ────────
export const placeOrder = (body) => api.post("/orders", body);
// Restaurant settings (e.g. the Indoor-AC ₹/guest rate for the order preview).
export const getRestaurantProfile = () => api.get("/profile");

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
// KH-11: guests seated (dine-in) → AC Room service charge on the server.
export const printBill       = (id) => api.post(`/admin/orders/${id}/print-bill`, {});

// ── KH-07 / KH-03 — follow-up orders + combined bill ─────────────────────
// An order with its follow-ups ("add items" after the KOT).
export const getOrderGroup = (id) => api.get(`/admin/orders/${id}/group`);
// Combined bill — body: { tableNo, orderIds } (a table) or { groupOf, orderIds }
// (an order + its follow-ups, e.g. takeaway). Every id is re-checked server-side.
export const previewCombinedBill  = (body) => api.post("/admin/combined-bill/preview", body);
export const printCombinedBill    = (body) => api.post("/admin/combined-bill/print", body);
export const payCombinedBill      = (body) => api.post("/admin/combined-bill/pay", body);
export const settleCombinedBill   = (body) => api.post("/admin/combined-bill/complete", body);

export const newIdempotencyKey = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
