import api from "./api.js";

// ── Admin: employee attendance monitoring ───────────────────────────────────
export const getAttendanceToday    = (params) => api.get("/admin/attendance/today", { params });
export const getAttendanceHistory  = (params) => api.get("/admin/attendance", { params });
export const getAttendanceEmployee = (id, params) => api.get(`/admin/attendance/employee/${id}`, { params });
export const getAttendanceSummary  = () => api.get("/admin/attendance/summary");
