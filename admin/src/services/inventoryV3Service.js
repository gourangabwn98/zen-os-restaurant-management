import api from "./api.js";
export const v3Get = async (path, params) => (await api.get(`/admin/inventory/v3/${path}`, { params })).data;
export const v3Write = async (path, data, method = "post") => (await api[method](`/admin/inventory/v3/${path}`, data)).data;
export const uploadV3Receipt = async (file) => { const form = new FormData(); form.append("file", file); return v3Write("receipts", form); };
export const requestKey = () => crypto.randomUUID();
// Conversion here is display formatting only; monetary totals come from the server.
export const moneyV3 = (paise) => paise == null ? "—" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(paise / 100);
export const pctV3 = (bps) => bps == null ? "—" : `${(bps / 100).toFixed(1)}%`;
