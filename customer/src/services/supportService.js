import api from "./api.js";

export const submitSupportTicket = (body) => api.post("/support", body);
export const getMySupportTickets = () => api.get("/support/my");
