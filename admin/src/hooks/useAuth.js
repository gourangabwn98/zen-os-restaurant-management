// ─── src/hooks/useAuth.js ─────────────────────────────────────────────────────
import { useContext } from "react";
import { AuthContext } from "../context/authContextObject.js";
export const useAuth = () => useContext(AuthContext);
