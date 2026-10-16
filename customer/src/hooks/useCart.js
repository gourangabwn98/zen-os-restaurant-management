import { useState, useCallback, useEffect, useRef } from "react";
import { lineKey, keyOf, pickAddons, lineUnitPrice, addonQty, stepLineAddon, cartLineAddons } from "../utils/menuDisplay.js";

const CART_KEY = "sohoj_cart_v1";

const loadInitialCart = (storage, key) => {
  try {
    const raw = storage.getItem(key);
    const lines = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(lines)) return [];
    const used = new Set();
    return lines.map((line, index) => {
      let key = keyOf(line);
      while (used.has(key)) key = `${key}|saved-${index}`;
      used.add(key);
      return { ...line, key, addons: cartLineAddons(line) };
    });
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
  const replaceAll = useCallback((lines) => setCart(Array.isArray(lines) ? lines.map((l, index) => ({ ...l, key: `draft-${index}` })) : []), [setCart]);

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
    setCart((p) => {
      const match = p.findIndex((c) => lineKey(c.item._id, c.addonIds) === lineKey(item._id, ids) && (c.notes || "") === notes);
      if (match !== -1) {
        return p.map((c, index) => (index === match ? { ...c, qty: c.qty + qty } : c));
      }
      const baseKey = `${lineKey(item._id, ids)}|${JSON.stringify(notes)}`;
      let key = baseKey;
      for (let suffix = 1; p.some((c) => keyOf(c) === key); suffix++) key = `${baseKey}|${suffix}`;
      const addons = pickAddons(item, ids);
      return [...p, {
        key, item, qty, notes,
        ...(addons.length && { addonIds: ids, addons, unitPrice: (Number(item.price) || 0) + addons.reduce((s, a) => s + a.price * addonQty(a), 0) }),
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
  const changeAddonQty = useCallback((key, addonId, delta) => {
    setCart((p) => {
      const index = findIndex(p, key);
      return p.map((line, i) => i === index ? stepLineAddon(line, addonId, delta) : line);
    });
  }, []);
  // Every line of the item (with and without add-ons) — what a menu card shows.
  const getQty    = useCallback((id) => cart.reduce((s, c) => s + (c.item._id === id ? c.qty : 0), 0), [cart]);
  const itemCount = cart.reduce((s, c) => s + c.qty, 0);
  const subtotal  = cart.reduce((s, c) => s + lineUnitPrice(c) * c.qty, 0);

  return {
    cart, addItem, incLine, removeItem, setQty, setNotes, deleteLine, clearCart, replaceAll, changeAddonQty,
    getQty, itemCount, subtotal,
  };
}
