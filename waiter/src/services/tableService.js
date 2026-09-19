import api from "./api.js";

export const getAllTables        = () => api.get("/admin/tables");
export const getOpenTableSessions = () => api.get("/admin/table-sessions");
export const getTableSession      = (tableNo) => api.get(`/admin/table-sessions/${tableNo}`);
