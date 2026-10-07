import api from "./api.js";

// Self-service attendance/duty endpoints — see restaurant-server/routes/attendanceRoutes.js.
// Identity always comes from the JWT server-side; nothing employee-identifying is sent here.
export const getMyDuty      = () => api.get("/attendance/me");
export const getMyDutyToday = () => api.get("/attendance/me/today");
// Own ON/OFF duty history (who changed it, when) — ?from=&to= restaurant days.
export const getMyDutyHistory = (params) => api.get("/attendance/me/duty-history", { params });
export const startDuty      = () => api.post("/attendance/start");
export const startBreak     = () => api.post("/attendance/break/start");
export const endBreak       = () => api.post("/attendance/break/end");
export const endDuty        = () => api.post("/attendance/end");
