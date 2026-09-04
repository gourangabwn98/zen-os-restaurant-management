import api from "./api.js";

export const getMenu = (params) => api.get("/menu", { params });
export const getMenuCategories = () => api.get("/menu/categories");
