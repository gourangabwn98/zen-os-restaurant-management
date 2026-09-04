import api from "./api.js";

// GET /api/admin/tables/:tableNo/validate?token=... — public, confirms a
// scanned QR is real before trusting the table number for dine-in ordering.
export const validateTable = (tableNo, token) =>
  api.get(`/admin/tables/${tableNo}/validate`, { params: { token } });
