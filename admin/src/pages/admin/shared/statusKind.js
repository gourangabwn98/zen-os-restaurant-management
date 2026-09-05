// src/pages/admin/shared/statusKind.js
// Maps a canonical status/type/payment string to one of the Zen OS tag "kinds"
// (wait / live / ready / done / stop / vio). Values are the real enums from
// restaurant-server/utils/orderStateMachine.js — plus the pre-rename strings
// that still exist in historic data.
export const STATUS_KIND = {
  // order status
  PENDING_CONFIRMATION: "wait",
  CONFIRMED: "live",
  PREPARING: "wait",
  READY: "ready",
  DELIVERED: "ready",
  COMPLETED: "done",
  CANCELLED: "stop",
  // payment status
  PENDING_VERIFICATION: "wait",
  PAID: "ready",
  FAILED: "stop",
  // invoice status
  pending: "wait",
  completed: "done",
  paid: "ready",
  cancelled: "stop",
  refunded: "done",
  // order type
  DINE_IN: "vio",
  TAKEAWAY: "vio",
  ONLINE: "vio",
  // legacy strings still present in historic data
  Placed: "live",
  Preparing: "wait",
  Ready: "ready",
  Delivered: "ready",
  Completed: "done",
  Cancelled: "stop",
  Paid: "ready",
  Pending: "wait",
};

export const statusKind = (value) => STATUS_KIND[value] || "done";
