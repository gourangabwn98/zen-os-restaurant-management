import api from "./api.js";

// POST /api/auth/waiter/send-otp — body: { phone }. Single-restaurant mode:
// no mongoUri is ever sent from or to the client.
export const sendWaiterOTP = (phone) => api.post("/auth/waiter/send-otp", { phone });

// POST /api/auth/waiter/verify-otp — body: { phone, otp } → { token, name, phone, role, restaurantName }
export const verifyWaiterOTP = (phone, otp) => api.post("/auth/waiter/verify-otp", { phone, otp });

// Firebase Phone Auth login (same SMS service as the customer app):
// 1) check the number is active staff before Firebase texts it,
// 2) exchange the verified Firebase ID token for a staff session.
export const checkStaffPhone = (phone) => api.post("/auth/employee/check-phone", { phone });
export const firebaseStaffLogin = (firebaseToken) =>
  api.post("/auth/employee/firebase-verify", { firebaseToken });

// GET /api/admin/employees/me/dashboard — self-service "today's stats" for
// this logged-in waiter. Used by ProfilePage.jsx.
export const getMyDashboard = () => api.get("/admin/employees/me/dashboard");

// GET /api/admin/employees/me/activity?from=&to= — self-service order +
// duty activity for a date range (defaults to today). Used by ActivityPage.jsx.
export const getMyActivity = ({ from, to } = {}) =>
  api.get("/admin/employees/me/activity", { params: { from: from || undefined, to: to || undefined } });
