// src/context/authContextObject.js — the context object on its own, so
// AuthContext.jsx exports only a component (React fast refresh needs that).
import { createContext } from "react";
export const AuthContext = createContext(null);
