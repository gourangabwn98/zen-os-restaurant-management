import { createContext, useContext } from "react";
import { useAuth } from "../hooks/useAuth.js";
import { useDuty } from "../hooks/useDuty.js";

const AppCtx = createContext(null);

export function AppStateProvider({ children }) {
  const auth = useAuth();
  const duty = useDuty(auth.isLoggedIn);
  return <AppCtx.Provider value={{ auth, duty }}>{children}</AppCtx.Provider>;
}

export const useAppState = () => {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error("useAppState must be used inside <AppStateProvider>");
  return ctx;
};
