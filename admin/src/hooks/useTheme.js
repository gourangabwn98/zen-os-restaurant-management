// src/hooks/useTheme.js
import { useContext } from "react";
import { ThemeContext } from "../context/themeContext.js";

export const useTheme = () => useContext(ThemeContext);
