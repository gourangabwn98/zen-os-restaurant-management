import api from "./api.js";

// "Call waiter" (restaurant-server/services/waiterCallService.js). Calls are
// pushed to this waiter's own socket room as waiter_call:new/updated; this
// list is for app start / reconnect.
// GET → { calls: [{ _id, orderNumber, tableNo, customerName, attempt, status, expiresAt, acknowledgedBy }] }
export const getMyCalls = () => api.get("/waiter-calls/mine");

// "On my way" — 409 if another waiter already took it or it ran out.
export const acknowledgeCall = (id) => api.patch(`/waiter-calls/${id}/ack`);

// "Done" — attended the table.
export const resolveCall = (id) => api.patch(`/waiter-calls/${id}/resolve`);
