import api from "./api.js";

export const getKitchenOrders = () => api.get("/kitchen/orders");
export const updateKitchenOrderStatus = (id, status) => api.patch(`/kitchen/orders/${id}/status`, { status });
export const getMyDashboard = () => api.get("/admin/employees/me/dashboard");
