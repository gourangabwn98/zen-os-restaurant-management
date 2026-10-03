// src/pages/admin/shared/customerName.js
// The CUSTOMER on an order. On a staff-placed order `order.user` is the
// waiter/admin who keyed it (restaurant-server/services/orderService.js
// placeOrderTx) and the customer is guestName/guestPhone — so the account name
// only names the customer on a customer-placed order. Returns "" when unknown
// (callers add their own fallback, e.g. "Guest").
const placedByCustomer = (o) => !o?.source || o.source === "CUSTOMER";

export const customerName = (o) => o?.guestName || (placedByCustomer(o) ? o?.user?.name : "") || "";
export const customerPhone = (o) => o?.guestPhone || (placedByCustomer(o) ? o?.user?.phone : "") || "";
