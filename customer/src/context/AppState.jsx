import { createContext, useContext } from "react";
import { useCart } from "../hooks/useCart.js";
import { useAuth } from "../hooks/useAuth.js";
import { useTableSession } from "../hooks/useTableSession.js";
import { useFavorites } from "../hooks/useFavorites.js";
import { useMenuFilters } from "../hooks/useMenuFilters.js";
import { useOrderEdit } from "../hooks/useOrderEdit.js";

const AppCtx = createContext(null);

export function AppStateProvider({ children }) {
  const shoppingCart = useCart();
  const auth      = useAuth();
  const table     = useTableSession();
  const favorites = useFavorites();
  const filters   = useMenuFilters();
  const orderEdit = useOrderEdit();
  // ORD-02: while an order is being changed, every screen that adds to "the
  // cart" adds to the order's draft instead — the shopping cart is untouched.
  const cart = orderEdit.active ? orderEdit.draft : shoppingCart;

  return (
    <AppCtx.Provider value={{ cart, shoppingCart, orderEdit, auth, table, favorites, filters }}>
      {children}
    </AppCtx.Provider>
  );
}

export const useAppState = () => {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error("useAppState must be used inside <AppStateProvider>");
  return ctx;
};
