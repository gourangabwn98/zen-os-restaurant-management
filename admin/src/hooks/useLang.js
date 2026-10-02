// src/hooks/useLang.js
import { useContext } from "react";
import { LangContext } from "../i18n/langContext.js";

export const useLang = () => useContext(LangContext);
