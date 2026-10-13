import { useState, useCallback, useEffect, useRef } from "react";
import { lineKey, keyOf, pickAddons, lineUnitPrice } from "../utils/menuDisplay.js";

const CART_KEY = "sohoj_cart_v1";

const loadInitialCart = (storage, key) => {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
};

/** The shopping cart — or, with `storageKey`/`storage`, any other list of
 * lines with the same interface (ORD-02's order-edit draft uses one). */
export function useCart({ storageKey = CART_KEY, storage = localStorage } = {}) {
  const [cart, setCartState] = useState(() => loadInitialCart(storage, storageKey)); // [{ key, item, qty, notes, addonIds?, addons?, unitPrice? }]
  const setCart = setCartState;
  const hydrated = useRef(false);

  // Persist so an accidental refresh mid-order doesn't wipe the cart.
  useEffect(() => {
    if (!hydrated.current) { hydrated.current = true; return; }
    try { storage.setItem(storageKey, JSON.stringify(cart)); } catch { /* storage off */ }
  }, [cart, storage, storageKey]);

  /** Replace every line at once (start of an order edit). */
  const replaceAll = useCallback((lines) => setCart(Array.isArray(lines) ? lines.map((l) => ({ ...l, key: keyOf(l) })) : []), [setCart]);

  // A line is one item + one add-on combination (`key`). Functions taking
  // `idOrKey` accept a line key, or a menu item id — then they act on that
  // item's most recently added line (the +/− on a menu card).
  const findIndex = (p, idOrKey) => {
    const byKey = p.findIndex((c) => keyOf(c) === idOrKey);
    if (byKey !== -1) return byKey;
    for (let i = p.length - 1; i >= 0; i--) if (p[i].item._id === idOrKey) return i;
    return -1;
  };

  /** Adds `qty` of an item, optionally with add-ons (ids — the server prices them). */
  const addItem = useCallback((item, qty = 1, notes = "", addonIds = []) => {
    const ids = Array.isArray(addonIds) ? addonIds.map(String) : [];
    const key = lineKey(item._id, ids);
    setCart((p) => {
      if (p.some((c) => keyOf(c) === key)) {
        return p.map((c) => (keyOf(c) === key ? { ...c, qty: c.qty + qty, notes: notes || c.notes } : c));
      }
      const addons = pickAddons(item, ids);
      return [...p, {
        key, item, qty, notes,
        ...(addons.length && { addonIds: ids, addons, unitPrice: (Number(item.price) || 0) + addons.reduce((s, a) => s + a.price, 0) }),
      }];
    });
  }, []);

  /** +1 on an existing line (keeps its add-ons). */
  const incLine = useCallback((idOrKey) => {
    setCart((p) => {
      const i = findIndex(p, idOrKey);
      return i === -1 ? p : p.map((c, j) => (j === i ? { ...c, qty: c.qty + 1 } : c));
    });
  }, []);

  const removeItem = useCallback((idOrKey) => {
    setCart((p) => {
      const i = findIndex(p, idOrKey);
      if (i === -1) return p;
      return p[i].qty === 1 ? p.filter((_, j) => j !== i) : p.map((c, j) => (j === i ? { ...c, qty: c.qty - 1 } : c));
    });
  }, []);

  const setQty = useCallback((idOrKey, qty) => {
    setCart((p) => {
      const i = findIndex(p, idOrKey);
      if (i === -1) return p;
      if (qty <= 0) return p.filter((_, j) => j !== i);
      return p.map((c, j) => (j === i ? { ...c, qty } : c));
    });
  }, []);

  const setNotes = useCallback((idOrKey, notes) => {
    setCart((p) => {
      const i = findIndex(p, idOrKey);
      return i === -1 ? p : p.map((c, j) => (j === i ? { ...c, notes } : c));
    });
  }, []);

  const deleteLine = useCallback((idOrKey) => {
    setCart((p) => {
      const i = findIndex(p, idOrKey);
      return i === -1 ? p : p.filter((_, j) => j !== i);
    });
  }, []);

  const clearCart = useCallback(() => setCart([]), []);
  // Every line of the item (with and without add-ons) — what a menu card shows.
  const getQty    = useCallback((id) => cart.reduce((s, c) => s + (c.item._id === id ? c.qty : 0), 0), [cart]);
  const itemCount = cart.reduce((s, c) => s + c.qty, 0);
  const subtotal  = cart.reduce((s, c) => s + lineUnitPrice(c) * c.qty, 0);

  return {
    cart, addItem, incLine, removeItem, setQty, setNotes, deleteLine, clearCart, replaceAll,
    getQty, itemCount, subtotal,
  };
}
