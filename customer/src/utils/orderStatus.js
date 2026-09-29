// Display metadata for the canonical backend enums
// (restaurant-server/utils/orderStateMachine.js). Never compare against a
// renamed/legacy string here — the keys below ARE the backend values.

export const ORDER_STATUS = {
  AWAITING_PAYMENT: "AWAITING_PAYMENT", // pay-first order, not paid yet
  PENDING_CONFIRMATION: "PENDING_CONFIRMATION",
  CONFIRMED: "CONFIRMED",
  PREPARING: "PREPARING",
  READY: "READY",
  DELIVERED: "DELIVERED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
};

export const ACTIVE_STATUSES = [
  ORDER_STATUS.AWAITING_PAYMENT, ORDER_STATUS.PENDING_CONFIRMATION, ORDER_STATUS.CONFIRMED, ORDER_STATUS.PREPARING,
  ORDER_STATUS.READY, ORDER_STATUS.DELIVERED,
];

export const isActiveOrder = (o) => ACTIVE_STATUSES.includes(o?.status);

// Short label (pills, lists) + one-line message (tracker headline).
export const STATUS_LABEL = {
  AWAITING_PAYMENT: "Payment needed",
  PENDING_CONFIRMATION: "Awaiting confirmation",
  CONFIRMED: "Placed",
  PREPARING: "Preparing",
  READY: "Ready",
  DELIVERED: "Delivered",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const STATUS_MESSAGE = {
  AWAITING_PAYMENT: "Complete your payment to send this order to the restaurant.",
  PENDING_CONFIRMATION: "Waiting for the restaurant to accept your order…",
  CONFIRMED: "Your order has been placed — you can still change it for a few minutes.",
  PREPARING: "Your food is being prepared.",
  READY: "Your order is ready!",
  DELIVERED: "Enjoy your meal!",
  COMPLETED: "Order completed. Thanks for visiting!",
  CANCELLED: "This order was cancelled.",
};

// Tracker steps — COMPLETED renders as "all five done".
export const STAGES = [
  { key: "PENDING_CONFIRMATION", label: "Awaiting",  icon: "📨" },
  { key: "CONFIRMED",            label: "Placed",    icon: "✅" },
  { key: "PREPARING",            label: "Preparing", icon: "👨‍🍳" },
  { key: "READY",                label: "Ready",     icon: "🛎️" },
  { key: "DELIVERED",            label: "Delivered", icon: "🍽️" },
];

export const statusPillClass = (status) => {
  if (status === "PENDING_CONFIRMATION" || status === "AWAITING_PAYMENT") return "st-wait";
  if (status === "CANCELLED") return "st-bad";
  if (status === "READY" || status === "DELIVERED") return "st-ok";
  if (status === "COMPLETED") return "st-mute";
  return "st-live";
};

export const PAYMENT_LABEL = {
  PENDING_VERIFICATION: "Payment pending verification",
  PAID: "Paid",
  FAILED: "Payment failed",
};

export const paymentPillClass = (status) =>
  status === "PAID" ? "st-ok" : status === "FAILED" ? "st-bad" : "st-wait";

export const formatOrderTime = (d) =>
  new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
