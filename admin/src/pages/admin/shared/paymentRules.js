// src/pages/admin/shared/paymentRules.js
// Mirrors restaurant-server/utils/orderStateMachine.js (the server enforces
// both rules; these just keep the admin screens from offering what it will
// refuse).
//
//  • Payment status is set by hand only to PAID (or back to Pending to undo
//    a mistake). FAILED is never set by hand — it stays in the enum only for
//    historic orders.
//  • An admin may Complete an order (it settles the bill and clears the
//    table) — but ONLY once it is PAID, and only when it is cooking, ready or
//    served (orderStateMachine ADMIN_COMPLETE_FROM: a Placed order goes to
//    the kitchen first). Settling the bill in billing still completes a
//    served order too.

import { N_ } from "../../../i18n/core.js";

export const MANUAL_PAYMENT_STATUSES = ["PENDING_VERIFICATION", "PAID"];

/** States an admin may Complete from (server: ADMIN_COMPLETE_FROM). */
export const COMPLETE_FROM = ["PREPARING", "READY", "DELIVERED"];

/** Can a person pick this status in a status control? (Every status now —
 * whether it's offered for a given order is offersStatus.) */
export const canPickStatus = () => true;

/** Is this target offered for this order? COMPLETED only from cooking/ready/served. */
export const offersStatus = (order, status) => status !== "COMPLETED" || COMPLETE_FROM.includes(order?.status);

/** BIL-02: is this order's bill settled? (Older orders: COMPLETED ⇒ settled.) */
export const isBillSettled = (order) => (order?.billStatus ? order.billStatus === "SETTLED" : order?.status === "COMPLETED");
/** Can billing settle it now? Accepted and not cancelled, bill still open. */
export const canSettleBill = (order) =>
  !isBillSettled(order) && ["CONFIRMED", "PREPARING", "READY", "DELIVERED", "COMPLETED"].includes(order?.status);

/** Shown but locked: Complete on an order that isn't PAID yet. */
export const needsPaidFirst = (order, toStatus) => toStatus === "COMPLETED" && order?.paymentStatus !== "PAID";

// English key — render with t(PAID_FIRST_HINT).
export const PAID_FIRST_HINT = N_("Mark the order Paid first — then it can be completed");
