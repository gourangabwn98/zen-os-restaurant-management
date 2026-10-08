// ─── src/services/adminService.js ────────────────────────────────────────────
import api from "./api.js";
export const getDashboard = () => api.get("/admin/dashboard");
// Revenue by item / category + making cost, aggregated server-side ({ from, to } ISO).
export const getSalesInsights = (params) => api.get("/admin/insights/sales", { params });
export const getInsightsOverview = (params) => api.get("/admin/insights/overview", { params });
export const getAllOrders = (params) => api.get("/admin/orders", { params });
export const updateOrderStatus = (id, status) =>
  api.put(`/admin/orders/${id}/status`, { status });
export const getAllUsers = (params) => api.get("/admin/users", { params });
export const deleteUser = (id) => api.delete(`/admin/users/${id}`);
// src/services/adminService.js
export const getAllInvoices = () => api.get("admin/invoices/all");
export const updateInvoiceStatus = (id, status) =>
  api.patch(`/admin/invoices/${id}/status`, { status });

// ── NEW TABLE MANAGEMENT APIs ─────────────────────────────────────
// export const getAllTables = () => api.get("admin/tables");

// export const createTable = (data) => api.post("admin/tables", data);

// export const updateTable = (tableNo, data) =>
//   api.put(`admin/tables/${tableNo}`, data);

// export const deleteTable = (tableNo) => api.delete(`admin/tables/${tableNo}`);
// ── tables ────────────────────────────────────────────────────────────────────
export const getAllTables = () => api.get("/admin/tables");
export const getTableByNo = (tableNo) => api.get(`/admin/tables/${tableNo}`);
export const createTable = (data) => api.post("/admin/tables", data);
export const updateTable = (tableNo, d) =>
  api.put(`/admin/tables/${tableNo}`, d);
export const deleteTable = (tableNo) => api.delete(`/admin/tables/${tableNo}`);
export const getTakeawayQR = () => api.get("/admin/tables/takeaway-qr");
// TBL-01: { keepToken: true } rebuilds a stale link (wrong/old customer URL)
// without invalidating the table's token; omit it to issue a new token.
export const regenerateQR = (tableNo, opts = {}) =>
  api.post(`/admin/tables/${tableNo}/regenerate-qr`, opts);

//for chef

export const getAllChefs = () => api.get("admin/chefs");
export const createChef = (data) => api.post("admin/chefs", data);
export const updateChefStatus = (id, status) =>
  api.patch(`admin/chefs/${id}/status`, { status });
export const deleteChef = (id) => api.delete(`admin/chefs/${id}`);

//admin profile

// export const getRestaurantProfile = () => api.get("admin/restaurant/profile");
// export const updateRestaurantProfile = (data) =>
//   api.put("admin/restaurant/profile", data);
// export const uploadRestaurantLogo = (formData) =>
//   api.post("admin/restaurant/logo", formData, {
//     headers: { "Content-Type": "multipart/form-data" },
//   });
// ── Restaurant Profile ─────────────────────────────────────────────────────
export const getRestaurantProfile    = ()       => api.get("admin/restaurant/profile");
export const updateRestaurantProfile = (data)   => api.put("admin/restaurant/profile", data);
export const uploadRestaurantLogo    = (formData) =>
  api.post("admin/restaurant/logo", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });

export const uploadPaymentQr = (formData) =>
  api.post("admin/restaurant/payment-qr", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
export const removePaymentQr = () => api.delete("admin/restaurant/payment-qr");

// ── Banners ────────────────────────────────────────────────────────────────
export const uploadRestaurantBanner = (formData) =>
  api.post("admin/restaurant/banner", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
export const updateRestaurantBanner = (bannerId, data) =>
  api.patch(`admin/restaurant/banner/${bannerId}`, data);
export const deleteRestaurantBanner = (bannerId) =>
  api.delete(`admin/restaurant/banner/${bannerId}`);

// ── Printer IPs ────────────────────────────────────────────────────────────
export const addRestaurantPrinter    = (data)       => api.post("admin/restaurant/printer", data);
export const updateRestaurantPrinter = (id, data)   => api.patch(`admin/restaurant/printer/${id}`, data);
export const deleteRestaurantPrinter = (id)         => api.delete(`admin/restaurant/printer/${id}`);
export const printOrderBill = (id) => api.post(`/admin/orders/${id}/print-bill`);
// KH-07 — an order + the follow-ups added after its KOT.
export const getOrderGroup = (id) => api.get(`/admin/orders/${id}/group`);
const RUNNING = ["CONFIRMED", "PREPARING", "READY", "DELIVERED"];
/** KH-07: an order that has live follow-ups prints ONE combined bill for the
 * whole group (every item, one total); any other order prints exactly as
 * before. Resolves to the API response. */
export const printOrderOrGroupBill = async (order) => {
  try {
    const { data } = await getOrderGroup(order._id);
    const live = (data.orders || []).filter((o) => RUNNING.includes(o.status));
    if (live.length > 1) {
      const requestKey = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      return await api.post("/admin/combined-bill/print", { groupOf: data.rootId, orderIds: live.map((o) => o._id), requestKey });
    }
  } catch { /* fall back to the single bill below */ }
  return printOrderBill(order._id);
};
export const getCategories = () => api.get("/menu/categories");

// ── Order confirmation (Phase 4) ──────────────────────────────────────────
export const confirmOrder = (id) => api.patch(`/orders/${id}/confirm`);
export const rejectOrder  = (id, reason) => api.patch(`/orders/${id}/reject`, { reason });
// Edit a not-yet-sent order: full item list [{ menuItemId, qty, notes }] + the
// order's current revision (409 if someone else edited it first).
export const modifyOrderItems = (id, items, revision) => api.patch(`/orders/${id}/items`, { items, revision });

// ── Payment verification (Phase 4) ────────────────────────────────────────
export const updateOrderPayment = (id, body) => api.patch(`/admin/orders/${id}/payment`, body);
// BIL-01/BIL-02 — the billing workflow: settle bills (records the payment when
// it isn't yet; a served order completes as a result) / reopen a settled bill.
export const settleOrders = (orderIds, paymentMethod) => api.post("/admin/orders/settle", { orderIds, paymentMethod });
export const reopenOrderBill = (id) => api.post(`/admin/orders/${id}/reopen-bill`);

// ── Table sessions / clearing (Phase 4) ───────────────────────────────────
export const getOpenTableSessions = () => api.get("/admin/table-sessions");
export const getTableSession      = (tableNo) => api.get(`/admin/table-sessions/${tableNo}`);
export const clearTableSession    = (sessionId) => api.post(`/admin/table-sessions/${sessionId}/close`);

// ── Printer monitoring (Phase 4) ──────────────────────────────────────────
export const getPrinterStatus = () => api.get("/admin/printer/status");

// ── Inventory overview (already built — reused for the dashboard alert banner)
export const getInventoryOverview = () => api.get("/admin/inventory/overview");

// ── Employee Management ───────────────────────────────────────────────────
export const getEmployees        = (params) => api.get("/admin/employees", { params });
export const addEmployee         = (body) => api.post("/admin/employees", body);
export const editEmployee        = (id, body) => api.put(`/admin/employees/${id}`, body);
export const setEmployeeStatus   = (id, status) => api.patch(`/admin/employees/${id}/status`, { status });
// EMP-01 — the manager sets On shift / On break / Off shift for someone.
// ON_BREAK needs a reason (mandatory, saved in Duty history).
export const setEmployeeShift    = (id, state, reason) => api.patch(`/admin/employees/${id}/shift`, reason ? { state, reason } : { state });
export const getEmployeeStats    = (id, { from, to } = {}) =>
  api.get(`/admin/employees/${id}/stats`, { params: { from: from || undefined, to: to || undefined } });
export const getEmployeePerformance = (params) => api.get("/admin/employees/performance", { params });

// ── Employees HR: reviews / pay / leave / documents (Employees page tabs) ──
export const getHrSummary          = (params) => api.get("/admin/employees/hr/summary", { params });
export const updateHrPolicy        = (body) => api.patch("/admin/employees/hr/policy", body);
export const getEmployeeReviews    = (id, params) => api.get(`/admin/employees/${id}/reviews`, { params });
export const markReviewLookedInto  = (reviewId, note) => api.patch(`/admin/employees/reviews/${reviewId}/looked-into`, { note });
export const getEmployeePay        = (id, month) => api.get(`/admin/employees/${id}/pay`, { params: { month } });
export const addEmployeeAdvance    = (id, body) => api.post(`/admin/employees/${id}/pay/advances`, body);
export const payEmployeeSalary     = (id, body) => api.post(`/admin/employees/${id}/pay/salary`, body);
export const getEmployeeLeave      = (id) => api.get(`/admin/employees/${id}/leave`);
export const addEmployeeLeave      = (id, body) => api.post(`/admin/employees/${id}/leave`, body);
export const decideEmployeeLeave   = (leaveId, body) => api.patch(`/admin/employees/leave/${leaveId}`, body);
export const uploadEmployeePhoto   = (id, file) => {
  const fd = new FormData(); fd.append("photo", file);
  return api.post(`/admin/employees/${id}/photo`, fd, { headers: { "Content-Type": "multipart/form-data" } });
};

// ── Support tickets (Help & Support → Raise a ticket) ─────────────────────
export const createSupportTicket = (body) => api.post("/support", body);

// ── Table waitlist / walk-in queue ─────────────────────────────────────────
export const getWaitlist        = (params) => api.get("/admin/waitlist", { params });
export const addWaitlistEntry   = (body) => api.post("/admin/waitlist", body);
export const notifyWaitlistEntry= (id) => api.post(`/admin/waitlist/${id}/notify`);
export const seatWaitlistEntry  = (id, tableNo) => api.post(`/admin/waitlist/${id}/seat`, { tableNo });
export const cancelWaitlistEntry= (id) => api.post(`/admin/waitlist/${id}/cancel`);
// Combine Bill for a table — the admin ticks SOME orders; the server
// re-validates every id and uses only stored amounts (combinedBillService.js).
export const previewCombinedBill  = (tableNo, orderIds) => api.post("/admin/combined-bill/preview", { tableNo, orderIds });
export const printCombinedBill    = (tableNo, orderIds, requestKey) => api.post("/admin/combined-bill/print", { tableNo, orderIds, requestKey });
export const paySelectedOrders    = (tableNo, orderIds, paymentMethod) => api.post("/admin/combined-bill/pay", { tableNo, orderIds, paymentMethod });
// BIL-01: "settle selected" (the route kept its old name) — never a hand completion.
export const completeSelectedOrders = (tableNo, orderIds, paymentMethod) => api.post("/admin/combined-bill/complete", { tableNo, orderIds, paymentMethod });
