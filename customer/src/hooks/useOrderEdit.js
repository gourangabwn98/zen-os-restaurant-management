import { useCallback, useState } from "react";
import { useCart } from "./useCart.js";
import { getMenu } from "../services/menuService.js";

const META_KEY = "khoai_order_edit_v1";
const LINES_KEY = "khoai_order_edit_lines_v1";

const readMeta = () => {
  try { return JSON.parse(sessionStorage.getItem(META_KEY)) || null; } catch { return null; }
};

// ORD-01 — the statuses in which the restaurant hasn't sent the order to the
// kitchen yet (mirror of restaurant-server orderService.EDITABLE_STATUSES).
export const EDITABLE_STATUSES = ["PENDING_CONFIRMATION", "CONFIRMED"];
export const canEditOrder = (o) =>
  Boolean(o && EDITABLE_STATUSES.includes(o.status) && !o.stockDeducted && o.paymentStatus !== "PAID");

/**
 * ORD-02 — "Change order → Add items" in the REAL menu. While editing, the
 * app's `cart` (AppState) is this draft of the placed order, so Home, Menu,
 * search, filters and item sheets all work exactly as when ordering; the
 * cart screen becomes "Review changes" and saves the draft back to the order
 * (PATCH /orders/:id/items — the server re-prices and re-checks the hold).
 * Kept in sessionStorage so a refresh mid-edit doesn't lose it.
 */
export function useOrderEdit() {
  const draft = useCart({ storageKey: LINES_KEY, storage: sessionStorage });
  const [meta, setMeta] = useState(readMeta); // { orderId (db id), orderNo, revision, tableNo }

  const start = useCallback(async (order) => {
    // Order lines carry name + price; enrich with the live menu item (photo,
    // veg tag) when it's on the menu, so the cart looks like a normal cart.
    let menu = [];
    try { const { data } = await getMenu(); menu = Array.isArray(data) ? data : []; } catch { /* lines still work */ }
    const byId = new Map(menu.map((m) => [String(m._id), m]));
    const lines = (order.items || []).map((it) => {
      const id = String(it.menuItem?._id ?? it.menuItem);
      const live = byId.get(id);
      return { item: live || { _id: id, name: it.name, nameBn: it.nameBn || "", price: it.price }, qty: it.qty, notes: it.notes || "" };
    });
    draft.replaceAll(lines);
    const next = { orderId: String(order._id), orderNo: order.orderId, revision: order.revision ?? 0, tableNo: order.tableNo ?? null };
    try { sessionStorage.setItem(META_KEY, JSON.stringify(next)); } catch { /* storage off */ }
    setMeta(next);
  }, [draft]);

  const stop = useCallback(() => {
    draft.clearCart();
    try { sessionStorage.removeItem(META_KEY); sessionStorage.removeItem(LINES_KEY); } catch { /* storage off */ }
    setMeta(null);
  }, [draft]);

  return { active: Boolean(meta), meta, draft, start, stop };
}
