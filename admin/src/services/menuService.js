// // ─── src/services/menuService.js ─────────────────────────────────────────────
// import api from "./api.js";
// export const getMenu = (params) => api.get("/menu", { params });
// export const getCategories = () => api.get("/menu/categories");
// // Admin operations (require JWT token)
// export const createMenuItem = (data) => api.post("/menu", data);
// export const updateMenuItem = (id, data) => api.put(`/menu/${id}`, data);
// export const deleteMenuItem = (id) => api.delete(`/menu/${id}`);

// Scheduled visibility — one request for any number of categories/items.
// schedule: { startTime: "HH:MM", endTime: "HH:MM" } to set, null to clear.
export const updateMenuSchedule = ({ itemIds = [], categoryIds = [], schedule }) =>
  api.patch("/menu/schedule", { itemIds, categoryIds, schedule });
import axios from "axios";
import api from "./api.js";

export const getMenu = (params) => api.get("/menu", { params });
// export const getCategories = () => api.get("/menu/categories");
export const getCategoriesWithImage = () => api.get("/menu/categoriesimage");

// FormData — multer on backend handles multipart
// Do NOT set Content-Type manually — axios sets it with the correct boundary
export const createMenuItem = (formData) => api.post("/menu", formData); // axios auto-detects FormData

export const updateMenuItem = (id, data) => {
  // data can be FormData (with files) OR plain object (toggle available)
  if (data instanceof FormData) {
    return api.put(`/menu/${id}`, data);
  }
  // plain JSON for quick toggle (no file change)
  return api.put(`/menu/${id}`, data, {
    headers: { "Content-Type": "application/json" },
  });
};

export const deleteMenuItem = (id) => api.delete(`/menu/${id}`);

//for catagory

export const getCategories = () => api.get("/categories"); // ✅ correct
export const createCategory = (data) => api.post("/categories", data);
// FormData: name?, image (file)?, removeImage ("true")? → { category, renamedFrom, itemsMoved }.
// Renaming moves every item in the category along with it (server-side, one transaction).
export const updateCategory = (id, data) => api.put(`/categories/${id}`, data);
// 409 while items still use the category.
export const deleteCategory = (id) => api.delete(`/categories/${id}`);

// ── Admin → Menu items: big-menu tools ───────────────────────────────────────
// Sort order: ids = every category id, in the new order.
export const reorderCategories = (ids) => api.put("/categories/order", { ids });
// Moves every item of `id` into `intoId`, then deletes `id` (one transaction).
export const mergeCategory = (id, intoId) => api.post(`/categories/${id}/merge`, { into: intoId });

// state: "on" | "soldout" (back on when the business day ends) | "off"
export const setMenuAvailability = (ids, state) => api.patch("/menu/availability", { ids, state });
// { ids, category?, addTags?, removeTags?, pricePercent? } — prices are computed server-side.
export const bulkEditMenu = (body) => api.post("/menu/bulk", body);

// Menu times: { name, schedule: { startTime, endTime, days, startDate, endDate }, color, categoryIds? }
export const getMenuTimes = () => api.get("/menu/times");
export const createMenuTime = (body) => api.post("/menu/times", body);
export const updateMenuTime = (id, body) => api.put(`/menu/times/${id}`, body);
export const deleteMenuTime = (id) => api.delete(`/menu/times/${id}`);

// Import: read (never saves) → admin reviews → commit.
export const readMenuImportText = (text, format = "text") => api.post("/menu/import/read", { text, format });
export const readMenuImportFile = (file) => {
  const fd = new FormData();
  fd.append("file", file);
  return api.post("/menu/import/read-file", fd, { timeout: 60_000 });
};
export const commitMenuImport = (rows) => api.post("/menu/import", { rows });
