import api from "./api.js";

// POST /api/auth/waiter/send-otp — body: { phone }. Single-restaurant mode:
// no mongoUri is ever sent from or to the client.
export const sendWaiterOTP = (phone) => api.post("/auth/waiter/send-otp", { phone });

// POST /api/auth/waiter/verify-otp — body: { phone, otp } → { token, name, phone, role, restaurantName }
export const verifyWaiterOTP = (phone, otp) => api.post("/auth/waiter/verify-otp", { phone, otp });

// GET /api/admin/employees/me/dashboard — self-service "today's stats" for
// this logged-in waiter. Used by ProfilePage.jsx.
export const getMyDashboard = () => api.get("/admin/employees/me/dashboard");
