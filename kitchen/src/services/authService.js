import api from "./api.js";

// Same underlying login as Waiter (phone + OTP, backend-verified employee
// record) — just the role-neutral route name, since this is a chef account,
// not a waiter one. See backend routes/authRoutes.js.
export const sendEmployeeOTP = (phone) => api.post("/auth/employee/send-otp", { phone });
export const verifyEmployeeOTP = (phone, otp) => api.post("/auth/employee/verify-otp", { phone, otp });
