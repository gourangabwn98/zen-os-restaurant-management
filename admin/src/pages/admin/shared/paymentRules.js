// src/pages/admin/shared/paymentRules.js
// Mirrors restaurant-server/utils/orderStateMachine.js (the server enforces
// both rules; these just keep the admin screens from offering what it will
// refuse).
//
//  • Payment status is set by hand only to PAID (or back to Pending to undo
//    a mistake). FAILED is never set by hand — it stays in the enum only for
//    historic orders.
//  • Nobody — admin included — can complete an order until it's Paid.

export const MANUAL_PAYMENT_STATUSES = ["PENDING_VERIFICATION", "PAID"];

/** Moving `order` to `toStatus` is blocked until it's marked Paid. */
export const needsPaidFirst = (order, toStatus) =>
  toStatus === "COMPLETED" && order?.paymentStatus !== "PAID";

import { N_ } from "../../../i18n/core.js";

// English key — render with t(PAID_FIRST_HINT).
export const PAID_FIRST_HINT = N_("Mark the payment Paid before completing this order");
