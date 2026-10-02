import api from "./api.js";

export const getKitchenOrders = () => api.get("/kitchen/orders");
export const updateKitchenOrderStatus = (id, status) => api.patch(`/kitchen/orders/${id}/status`, { status });
export const getMyDashboard = () => api.get("/admin/employees/me/dashboard");

// Leave — own requests only (approved on the admin Employees page).
export const getMyLeave = () => api.get("/admin/employees/me/leave");
export const requestMyLeave = (body) => api.post("/admin/employees/me/leave", body);
export const cancelMyLeave = (id) => api.patch(`/admin/employees/me/leave/${id}/cancel`);
