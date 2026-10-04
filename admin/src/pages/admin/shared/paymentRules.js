// src/pages/admin/shared/paymentRules.js
// Mirrors restaurant-server/utils/orderStateMachine.js (the server enforces
// both rules; these just keep the admin screens from offering what it will
// refuse).
//
//  • Payment status is set by hand only to PAID (or back to Pending to undo
//    a mistake). FAILED is never set by hand — it stays in the enum only for
//    historic orders.
//  • Nobody — admin included — completes an order by hand (BIL-02/DSH-03):
//    settling its bill in billing does, once it has been served.

export const MANUAL_PAYMENT_STATUSES = ["PENDING_VERIFICATION", "PAID"];

// Statuses the server only ever sets itself (orderStateMachine SYSTEM_ONLY_TARGETS).
export const SYSTEM_ONLY_STATUSES = ["COMPLETED"];
/** Can a person pick this status in a status control? */
export const canPickStatus = (status) => !SYSTEM_ONLY_STATUSES.includes(status);

/** BIL-02: is this order's bill settled? (Older orders: COMPLETED ⇒ settled.) */
export const isBillSettled = (order) => (order?.billStatus ? order.billStatus === "SETTLED" : order?.status === "COMPLETED");
/** Can billing settle it now? Accepted and not cancelled, bill still open. */
export const canSettleBill = (order) =>
  !isBillSettled(order) && ["CONFIRMED", "PREPARING", "READY", "DELIVERED", "COMPLETED"].includes(order?.status);

/** Kept for older callers: COMPLETED is never pickable now (see canPickStatus). */
export const needsPaidFirst = (order, toStatus) => toStatus === "COMPLETED";

import { N_ } from "../../../i18n/core.js";

// English key — render with t(PAID_FIRST_HINT).
export const PAID_FIRST_HINT = N_("Orders complete when their bill is settled");
