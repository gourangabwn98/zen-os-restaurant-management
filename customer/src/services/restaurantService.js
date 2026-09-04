import api from "./api.js";

// GET /api/admin/restaurant/profile — public, single restaurant.
export const getRestaurantProfile = () => api.get("/admin/restaurant/profile");
