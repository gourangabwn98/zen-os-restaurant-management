import { createContext, useContext } from "react";
import { useCart } from "../hooks/useCart.js";
import { useAuth } from "../hooks/useAuth.js";
import { useTableSession } from "../hooks/useTableSession.js";
import { useFavorites } from "../hooks/useFavorites.js";

const AppCtx = createContext(null);

export function AppStateProvider({ children }) {
  const cart      = useCart();
  const auth      = useAuth();
  const table     = useTableSession();
  const favorites = useFavorites();

  return (
    <AppCtx.Provider value={{ cart, auth, table, favorites }}>
      {children}
    </AppCtx.Provider>
  );
}

export const useAppState = () => {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error("useAppState must be used inside <AppStateProvider>");
  return ctx;
};
