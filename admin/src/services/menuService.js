// // ─── src/services/menuService.js ─────────────────────────────────────────────
// import api from "./api.js";
// export const getMenu = (params) => api.get("/menu", { params });
// export const getCategories = () => api.get("/menu/categories");
// // Admin operations (require JWT token)
// export const createMenuItem = (data) => api.post("/menu", data);
// export const updateMenuItem = (id, data) => api.put(`/menu/${id}`, data);
// export const deleteMenuItem = (id) => api.delete(`/menu/${id}`);
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
export const deleteCategory = (id) => api.delete(`/categories/${id}`);
