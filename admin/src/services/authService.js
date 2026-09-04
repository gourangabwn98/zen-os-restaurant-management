// // ─── src/services/authService.js ─────────────────────────────────────────────
// import api from "./api.js";
// export const sendOTP = (phone) => api.post("/auth/send-otp", { phone });
// export const verifyOTP = (phone, otp, name) =>
//   api.post("/auth/verify-otp", { phone, otp, name });
// admin/src/services/authService.js
import api from "./api.js";

export const firebaseVerify = (firebaseToken, name) =>
  api.post("/auth/firebase-verify", { firebaseToken, name });
// services/authService.js
export const checkAdminPhone = (phone) =>
  api.post("/auth/check-admin-phone", { phone }); // ← match your existing axios baseURL/prefix