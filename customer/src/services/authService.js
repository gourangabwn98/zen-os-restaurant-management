import api from "./api.js";

// POST /api/auth/firebase-verify — backend verifies the Firebase ID token
// and returns { _id, name, phone, token }.
export const firebaseVerify = (firebaseToken, name) =>
  api.post("/auth/firebase-verify", { firebaseToken, name });

export const getProfile   = () => api.get("/auth/profile");
export const updateProfile = (body) => api.put("/auth/profile", body);
