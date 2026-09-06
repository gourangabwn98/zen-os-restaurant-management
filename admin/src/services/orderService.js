import api from "./api.js";

// One key per "place order" attempt — resent on retry/double-click so the
// backend (services/orderService.js placeOrderTx) creates exactly one order.
// Without a key, a duplicate-key error on the backend used to be mis-handled
// as "order already exists" and a stale order was returned as a false success.
export const newIdempotencyKey = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

// ─── Guest order helpers ──────────────────────────────────────────────────────
const isGuest = () => {
  try {
    return JSON.parse(localStorage.getItem("addaUser"))?.isGuest === true;
  } catch {
    return false;
  }
};

const getGuestOrders = () => {
  try {
    return JSON.parse(localStorage.getItem("guestOrders")) || [];
  } catch {
    return [];
  }
};

const saveGuestOrders = (orders) =>
  localStorage.setItem("guestOrders", JSON.stringify(orders));

// const makeGuestOrder = (data) => {
//   const count = getGuestOrders().length + 1;
//   return {
//     _id: `guest_${Date.now()}`,
//     orderId: `GUEST${String(count).padStart(4, "0")}`,
//     user: "guest",
//     items: data.items.map((i) => ({
//       menuItem: i.menuItemId,
//       name: i.name,
//       price: i.price,
//       qty: i.qty,
//     })),
//     subtotal: data.subtotal,
//     tax: data.tax,
//     discount: data.discount,
//     total: data.total,
//     orderType: data.orderType || "Dining",
//     status: "Placed",
//     paymentStatus: "Pending",
//     cancelDeadline: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
//     createdAt: new Date().toISOString(),
//     isGuest: true,
//   };
// };

// ─── Place Order ─────────────────────────────────────────────────────────────
const makeGuestOrder = (data) => {
  const now = new Date();

  const orderId =
    "GUEST" +
    now.getMonth() + // Month (0-11)
    now.getDate() + // Day
    now.getHours() + // Hour
    now.getMinutes() + // Minute
    now.getSeconds(); // Second

  return {
    _id: `guest_${Date.now()}`,
    orderId,
    user: "guest",
    items: data.items.map((i) => ({
      menuItem: i.menuItemId,
      name: i.name,
      price: i.price,
      qty: i.qty,
    })),
    subtotal: data.subtotal,
    tax: data.tax,
    discount: data.discount,
    total: data.total,
    orderType: data.orderType || "Dining",
    status: "Placed",
    paymentStatus: "Pending",
    cancelDeadline: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString(),
    isGuest: true,
  };
};
export const placeOrder = async (data) => {
  if (isGuest()) {
    const order = makeGuestOrder(data);

    // send order to backend with guest orderId
    const payload = {
      ...data,
      orderId: order.orderId,
      isGuest: true,
    };

    const res = await api.post("/orders", payload);

    // save locally if you want order history in browser
    const orders = getGuestOrders();
    orders.unshift({ ...order, ...res.data });
    saveGuestOrders(orders);

    return res;
  }

  return api.post("/orders", data);
};
