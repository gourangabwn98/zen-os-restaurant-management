// utils/orderStateMachine.js
// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for the order lifecycle. Every place that changes
// an order's status (customer cancel, waiter confirm, admin override, etc.)
// must go through `assertValidTransition` so the rules can never drift
// between controllers.
//
//   AWAITING_PAYMENT → PENDING_CONFIRMATION → CONFIRMED → PREPARING → READY → DELIVERED → COMPLETED
//          ↘ CANCELLED              ↘ CANCELLED (only from the first three states, for
//                                     non-admin roles)
//
// Customer orders start PENDING_CONFIRMATION ("Awaiting confirmation") and a
// waiter/admin accepts them → CONFIRMED ("Placed"); staff orders start
// CONFIRMED. A Placed order is editable (orderService.modifyOrderItemsTx)
// until its autoPrepareAt (RestaurantProfile.editWindowMinutes, default 3),
// then orderService.sendToKitchenTx moves it CONFIRMED → PREPARING in ONE
// transaction with the stock deduction and the KOT — the KOT prints exactly
// when preparation starts, so the kitchen never cooks from a stale ticket.
//
// AWAITING_PAYMENT is the pay-first entry state: a customer order paid
// online (RestaurantProfile.paymentMode ONLINE, or BOTH with Online chosen,
// with the PhonePe gateway configured) starts here and is invisible to
// waiters and the kitchen. ONLY a checksum-verified PhonePe success moves it
// on (role "system" — orderService.promotePaidOrder); an unpaid one is
// cancelled when its paymentDeadline passes (orderService.expireUnpaidOrders).
//
// Admin has full override authority: an admin may move an order to ANY
// other status at all — except COMPLETED, which needs PAID (see
// ADMIN_COMPLETE_FROM) — (forward, backward, or sideways into/out of
// CANCELLED) to correct a mis-click or a support dispute — see the
// `role === "admin"` bypass in validateTransition below. Every other role
// (manager/waiter/chef/customer) stays restricted to the explicit TRANSITIONS /
// TRANSITION_ROLES maps exactly as before.
//
// An admin override is always a pure `status` field flip — it never
// re-runs or reverses side effects (stock deduction, KOT job creation) on
// its own. The two operations that DO have real side effects — the first
// real PENDING_CONFIRMATION → CONFIRMED confirmation (deducts stock,
// creates the KOT job) and cancellation of a live order (reverses any
// stock already deducted) — are still routed through confirmOrderTx /
// cancelOrderTx respectively (see services/orderService.js), and only when
// actually applicable. Any other admin jump (e.g. reviving a CANCELLED
// order, or jumping straight to DELIVERED) changes only the status field
// and audit trail — it does not retroactively create a KOT job or move
// stock.
// ─────────────────────────────────────────────────────────────────────────────

export const ORDER_STATUSES = [
  "AWAITING_PAYMENT",
  "PENDING_CONFIRMATION",
  "CONFIRMED",
  "PREPARING",
  "READY",
  "DELIVERED",
  "COMPLETED",
  "CANCELLED",
];

export const PAYMENT_STATUSES = ["PENDING_VERIFICATION", "PAID", "FAILED"];

// BIL-02 — the bill's own lifecycle, separate from the operational `status`
// above and from `paymentStatus` (money received). OPEN until the billing
// workflow settles it (services/billingService.js — the only writer).
// Orders saved before this field existed read as SETTLED when COMPLETED,
// otherwise OPEN (effectiveBillStatus).
export const BILL_STATUSES = ["OPEN", "SETTLED"];

export const effectiveBillStatus = (order) =>
  order?.billStatus || (order?.status === "COMPLETED" ? "SETTLED" : "OPEN");

// COMPLETED is reached two ways, and no other:
//   • "system" — billing settles a served order (DSH-03/DSH-04, BIL-01):
//     orderService.completeServedSettledOrder (DELIVERED → COMPLETED).
//   • "admin"  — an explicit "Complete" (clears the table), and ONLY once the
//     order is PAID (PAYMENT_REQUIRED_INTO below, re-checked atomically in
//     orderService.completeOrderByAdminTx, which also settles the bill).
//     Only from a state the kitchen has already taken: a Placed order hasn't
//     had its KOT/stock deduction yet (sendToKitchenTx) and must not skip it.
// Waiters/chefs/customers never complete by hand — a waiter settles the bill.
export const ADMIN_COMPLETE_FROM = ["PREPARING", "READY", "DELIVERED"];

export const ORDER_SOURCES = ["CUSTOMER", "WAITER", "ADMIN"];
export const ORDER_TYPES   = ["DINE_IN", "TAKEAWAY", "ONLINE"];

// Map of status -> statuses it may legally move to next, for non-admin
// roles (waiter/chef/customer). Admin bypasses this map entirely — see the
// `role === "admin"` check in validateTransition below.
const TRANSITIONS = {
  AWAITING_PAYMENT:     ["PENDING_CONFIRMATION", "CANCELLED"],
  PENDING_CONFIRMATION: ["CONFIRMED", "CANCELLED"],
  CONFIRMED:            ["PREPARING", "CANCELLED"],
  PREPARING:            ["READY", "CANCELLED"],
  READY:                ["DELIVERED"],
  DELIVERED:            ["COMPLETED"],
  COMPLETED:            [],
  CANCELLED:            [],
};

// Which roles may perform which transition. Consulted only for non-admin
// roles (admin already short-circuited above). Customers are handled
// separately (see canCustomerCancel).
const TRANSITION_ROLES = {
  // Only the server itself, on a checksum-verified payment — never a person.
  "AWAITING_PAYMENT->PENDING_CONFIRMATION": ["system"],
  // Customer gives up before paying, or the server expires it unpaid.
  "AWAITING_PAYMENT->CANCELLED":     ["admin", "manager", "customer", "system"],
  "PENDING_CONFIRMATION->CONFIRMED": ["admin", "manager", "waiter"],
  "PENDING_CONFIRMATION->CANCELLED": ["admin", "manager", "waiter", "customer"],
  // "system" = the edit-window timer (orderService.autoSendDueOrders).
  "CONFIRMED->PREPARING":            ["admin", "manager", "waiter", "chef", "system"],
  "CONFIRMED->CANCELLED":            ["admin", "manager", "waiter"],
  "PREPARING->READY":                ["admin", "manager", "waiter", "chef"],
  "PREPARING->CANCELLED":            ["admin", "manager"], // once kitchen has started, only admin/manager can void
  "READY->DELIVERED":                ["admin", "manager", "waiter"], // waiter taps "Served" → Eating
  // Bill settled in billing → Completed (services/billingService.js).
  "DELIVERED->COMPLETED":            ["system"],
};

// Target statuses that require the order to be PAID first, per role. Nobody
// — admin included — can complete an unpaid order: mark it Paid first. Keyed
// on the TARGET (not only DELIVERED→COMPLETED) so an admin's override jump
// (e.g. READY→COMPLETED) can't skip it either. transitionOrderStatusTx also
// puts `paymentStatus: "PAID"` into its atomic update filter, so a payment
// change racing the completion can't slip through.
const PAYMENT_REQUIRED_INTO = {
  COMPLETED: ["waiter", "admin", "manager", "system"],
};

/** True when this role must see paymentStatus === "PAID" before this transition. */
export const requiresPaidForTransition = (fromStatus, toStatus, role) =>
  (PAYMENT_REQUIRED_INTO[toStatus] || []).includes(role);

// Payment statuses staff may set by hand (PATCH /admin/orders/:id/payment).
// Staff only ever confirm money received (PAID); admin may also undo a
// mistaken Paid (back to PENDING_VERIFICATION). FAILED is never set by hand —
// a failed PhonePe attempt deliberately leaves the order unpaid so the
// customer can retry or pay cash (services/paymentService.js); FAILED stays
// in the enum only for historic data.
const PAYMENT_STATUS_ROLES = {
  PENDING_VERIFICATION: ["admin"],
  PAID:                 ["admin", "manager", "waiter"],
  FAILED:               [],
};

export const canSetPaymentStatus = (paymentStatus, role) =>
  (PAYMENT_STATUS_ROLES[paymentStatus] || []).includes(role);

// ── Backward-compatible normalization ────────────────────────────────────────
// The existing (unmodified this phase) customer app still sends legacy
// orderType strings ("Dining" / "Take Away"). Rather than reject those
// requests, normalize them onto the new canonical enum so old clients keep
// working while the stored data is always the new, clean vocabulary.
const LEGACY_ORDER_TYPE_MAP = {
  "Dining":    "DINE_IN",
  "Take Away": "TAKEAWAY",
  "Delivery":  "ONLINE",
};

export const normalizeOrderType = (value) => {
  if (!value) return "DINE_IN";
  if (ORDER_TYPES.includes(value)) return value;
  return LEGACY_ORDER_TYPE_MAP[value] || "DINE_IN";
};

export const isTerminalStatus = (status) =>
  !TRANSITIONS[status] || TRANSITIONS[status].length === 0;

/**
 * Returns { ok: true } or { ok: false, message } — never throws, so callers
 * decide how to respond (400 vs 403 etc.)
 */
export const validateTransition = (fromStatus, toStatus, role) => {
  if (!ORDER_STATUSES.includes(fromStatus)) {
    return { ok: false, code: 500, message: `Unknown current status "${fromStatus}"` };
  }
  if (!ORDER_STATUSES.includes(toStatus)) {
    return { ok: false, code: 400, message: `Unknown target status "${toStatus}"` };
  }
  if (fromStatus === toStatus) {
    return { ok: false, code: 400, message: `Order is already "${toStatus}"` };
  }

  // Checked BEFORE the generic admin override (see ADMIN_COMPLETE_FROM).
  if (toStatus === "COMPLETED" && role !== "system") {
    // A manager runs the floor for the admin: same hand "Complete" (PAID only).
    if (role !== "admin" && role !== "manager") {
      return {
        ok: false,
        code: 400,
        message: "Only an admin can complete an order by hand — otherwise it completes by settling its bill",
      };
    }
    if (!ADMIN_COMPLETE_FROM.includes(fromStatus)) {
      return {
        ok: false,
        code: 400,
        message: "Only an order that is cooking, ready or served can be completed — send it to the kitchen first",
      };
    }
    return { ok: true }; // payment (PAID) is checked by orderService.completeOrderByAdminTx
  }

  // Admin override: any status -> any other (distinct, valid) status is
  // allowed. See the header comment for what this does and does not do.
  if (role === "admin") return { ok: true };

  const allowedNext = TRANSITIONS[fromStatus] || [];
  if (!allowedNext.includes(toStatus)) {
    return {
      ok: false,
      code: 400,
      message: `Cannot move order from "${fromStatus}" to "${toStatus}". Allowed: ${
        allowedNext.length ? allowedNext.join(", ") : "none (terminal state)"
      }`,
    };
  }

  const key = `${fromStatus}->${toStatus}`;
  const allowedRoles = TRANSITION_ROLES[key];
  if (allowedRoles && role && !allowedRoles.includes(role)) {
    return {
      ok: false,
      code: 403,
      message: `Role "${role}" is not allowed to move order from "${fromStatus}" to "${toStatus}"`,
    };
  }

  return { ok: true };
};

/** Throws an Error with .statusCode set — convenient inside try/catch controllers */
export const assertValidTransition = (fromStatus, toStatus, role) => {
  const result = validateTransition(fromStatus, toStatus, role);
  if (!result.ok) {
    const err = new Error(result.message);
    err.statusCode = result.code;
    throw err;
  }
};
