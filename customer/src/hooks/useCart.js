import { useState, useCallback, useEffect, useRef } from "react";

const CART_KEY = "sohoj_cart_v1";

const loadInitialCart = () => {
  try {
    const raw = localStorage.getItem(CART_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
};

export function useCart() {
  const [cart, setCart] = useState(loadInitialCart); // [{ item, qty, notes }]
  const hydrated = useRef(false);

  // Persist so an accidental refresh mid-order doesn't wipe the cart.
  useEffect(() => {
    if (!hydrated.current) { hydrated.current = true; return; }
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  }, [cart]);

  const addItem = useCallback((item, qty = 1, notes = "") => {
    setCart((p) => {
      const ex = p.find((c) => c.item._id === item._id);
      if (ex) {
        return p.map((c) =>
          c.item._id === item._id
            ? { ...c, qty: c.qty + qty, notes: notes || c.notes }
            : c
        );
      }
      return [...p, { item, qty, notes }];
    });
  }, []);

  const removeItem = useCallback((id) => {
    setCart((p) => {
      const ex = p.find((c) => c.item._id === id);
      if (!ex) return p;
      return ex.qty === 1
        ? p.filter((c) => c.item._id !== id)
        : p.map((c) => (c.item._id === id ? { ...c, qty: c.qty - 1 } : c));
    });
  }, []);

  const setQty = useCallback((id, qty) => {
    setCart((p) => {
      if (qty <= 0) return p.filter((c) => c.item._id !== id);
      return p.map((c) => (c.item._id === id ? { ...c, qty } : c));
    });
  }, []);

  const setNotes = useCallback((id, notes) => {
    setCart((p) => p.map((c) => (c.item._id === id ? { ...c, notes } : c)));
  }, []);

  const deleteLine = useCallback((id) => {
    setCart((p) => p.filter((c) => c.item._id !== id));
  }, []);

  const clearCart = useCallback(() => setCart([]), []);
  const getQty    = useCallback((id) => cart.find((c) => c.item._id === id)?.qty || 0, [cart]);
  const itemCount = cart.reduce((s, c) => s + c.qty, 0);
  const subtotal  = cart.reduce((s, c) => s + c.item.price * c.qty, 0);

  return {
    cart, addItem, removeItem, setQty, setNotes, deleteLine, clearCart,
    getQty, itemCount, subtotal,
  };
}
