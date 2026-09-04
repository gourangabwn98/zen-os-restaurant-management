import api from "./api.js";

export const getAllTables        = () => api.get("/admin/tables");
export const getOpenTableSessions = () => api.get("/admin/table-sessions");
export const getTableSession      = (tableNo) => api.get(`/admin/table-sessions/${tableNo}`);
// "Clear table" — the backend rejects this (400) if any order on the
// session is still non-terminal; the waiter can only clear when allowed.
export const clearTableSession    = (sessionId) => api.post(`/admin/table-sessions/${sessionId}/close`);
