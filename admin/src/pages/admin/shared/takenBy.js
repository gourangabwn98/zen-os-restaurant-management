// src/pages/admin/shared/takenBy.js — KH-09
// Who took the order, for admin order details. Read-only, from fields every
// order already has (restaurant-server/services/orderService.js placeOrderTx):
//   staff order (source WAITER / ADMIN) → the person who keyed it in
//     (waiterName, else the createdBy actor's name);
//   customer QR order → the waiter/admin who accepted it (confirmedBy), if any.
// Old orders without any of these → "" (callers show "–").
const placedByCustomer = (o) => !o?.source || o.source === "CUSTOMER";

export const takenByName = (o) => {
  if (!o) return "";
  if (!placedByCustomer(o)) return o.waiterName || o.createdBy?.name || "";
  return o.confirmedBy?.name || "";
};

/** true when the name is the person who accepted a customer's order. */
export const takenByIsAcceptor = (o) => placedByCustomer(o) && !!o?.confirmedBy?.name;
