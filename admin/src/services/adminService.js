// ─── src/services/adminService.js ────────────────────────────────────────────
import api from "./api.js";
export const getDashboard = () => api.get("/admin/dashboard");
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
export const regenerateQR = (tableNo) =>
  api.post(`/admin/tables/${tableNo}/regenerate-qr`);

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
export const getCategories = () => api.get("/menu/categories");

// ── Order confirmation (Phase 4) ──────────────────────────────────────────
export const confirmOrder = (id) => api.patch(`/orders/${id}/confirm`);
export const rejectOrder  = (id, reason) => api.patch(`/orders/${id}/reject`, { reason });

// ── Payment verification (Phase 4) ────────────────────────────────────────
export const updateOrderPayment = (id, body) => api.patch(`/admin/orders/${id}/payment`, body);

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
export const getEmployeeStats    = (id) => api.get(`/admin/employees/${id}/stats`);
export const getEmployeePerformance = (params) => api.get("/admin/employees/performance", { params });