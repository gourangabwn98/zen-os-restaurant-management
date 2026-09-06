// src/services/orderFocus.js
// ─────────────────────────────────────────────────────────────────────────────
// Tiny cross-component channel for "open this order's detail view".
//
// The admin shell switches pages with local state (not routes), so when a
// notification is clicked while the user is NOT on the Billing/Orders page,
// OrdersPage isn't mounted yet and would miss a plain CustomEvent. So we keep
// the last request in a module variable too: OrdersPage drains it on mount AND
// listens for the live event while it's already open.
// ─────────────────────────────────────────────────────────────────────────────

let pending = null;

export const requestOrderFocus = (order) => {
  if (!order || (!order._id && !order.orderId)) return;
  pending = { _id: order._id || null, orderId: order.orderId || null };
  window.dispatchEvent(new CustomEvent("zc:focus-order", { detail: pending }));
};

/** Returns the last focus request (once) and clears it. */
export const consumePendingOrderFocus = () => {
  const p = pending;
  pending = null;
  return p;
};
