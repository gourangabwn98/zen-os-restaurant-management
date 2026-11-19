// utils/deliveryStateMachine.js
// ─────────────────────────────────────────────────────────────────────────────
// The DELIVERY lifecycle of one home-delivery order (DeliveryJob.status) —
// deliberately separate from the restaurant's order lifecycle
// (utils/orderStateMachine.js). The two touch in exactly two places:
//   • PICKED_UP needs Order.status === READY (the food is actually ready);
//   • DELIVERED (OTP-verified) moves the order READY → DELIVERED through the
//     order state machine with role "delivery" (TRANSITION_ROLES there).
//
//   SEARCHING → ASSIGNED → AT_RESTAURANT → PICKED_UP → AT_CUSTOMER → DELIVERED
//       ↑           │            │              ↘ FAILED (customer unreachable…)
//       └─ admin unassign ───────┘
//   any non-terminal → CANCELLED (order cancelled, or admin cancels the delivery)
//
// SEARCHING = being offered to riders (DeliveryOffer rows, one per rider per
// round). `escalated` on the job (not a status) means the broadcast rounds ran
// out and an admin must act; the job is still SEARCHING so an admin assign or
// re-broadcast goes through the very same atomic paths.
// ─────────────────────────────────────────────────────────────────────────────

export const DELIVERY_JOB_STATUSES = [
  "SEARCHING", "ASSIGNED", "AT_RESTAURANT", "PICKED_UP", "AT_CUSTOMER", "DELIVERED", "FAILED", "CANCELLED",
];

/** A rider holds one unit of capacity while a job is in one of these. */
export const ACTIVE_JOB_STATUSES = ["ASSIGNED", "AT_RESTAURANT", "PICKED_UP", "AT_CUSTOMER"];
export const TERMINAL_JOB_STATUSES = ["DELIVERED", "FAILED", "CANCELLED"];
/** Before pickup the rider can still be swapped by an admin. */
export const UNASSIGNABLE_STATUSES = ["ASSIGNED", "AT_RESTAURANT"];
/** The rider is carrying the food — the customer's tracking map shows them. */
export const ON_THE_WAY_STATUSES = ["PICKED_UP", "AT_CUSTOMER"];

export const DELIVERY_OFFER_STATUSES = ["SENT", "REJECTED", "EXPIRED", "WON", "LOST"];

// Rider-driven steps (role "delivery"). Admin moves (assign / unassign /
// cancel) are their own service functions, not entries here.
const RIDER_TRANSITIONS = {
  ASSIGNED:      ["AT_RESTAURANT", "PICKED_UP"],
  AT_RESTAURANT: ["PICKED_UP"],
  PICKED_UP:     ["AT_CUSTOMER", "DELIVERED", "FAILED"],
  AT_CUSTOMER:   ["DELIVERED", "FAILED"],
};

for (const [from, tos] of Object.entries(RIDER_TRANSITIONS)) {
  for (const s of [from, ...tos]) {
    if (!DELIVERY_JOB_STATUSES.includes(s)) throw new Error(`deliveryStateMachine: unknown status ${s}`);
  }
}

const fail = (message, statusCode = 400, code) => Object.assign(new Error(message), { statusCode, ...(code && { code }) });

/** Throws (400/409) unless a rider may move this job from → to. */
export const assertRiderTransition = (from, to) => {
  if (!DELIVERY_JOB_STATUSES.includes(to)) throw fail(`Unknown delivery status "${to}"`);
  if (TERMINAL_JOB_STATUSES.includes(from)) throw fail(`This delivery is already ${from.toLowerCase()}`, 409, "JOB_CLOSED");
  if (!(RIDER_TRANSITIONS[from] || []).includes(to)) {
    throw fail(`Cannot move a delivery from ${from} to ${to}`, 409, "BAD_TRANSITION");
  }
};

/** Where each rider step writes its timestamp. */
export const STEP_TIMESTAMP = {
  AT_RESTAURANT: "arrivedRestaurantAt",
  PICKED_UP:     "pickedUpAt",
  AT_CUSTOMER:   "arrivedCustomerAt",
  DELIVERED:     "deliveredAt",
  FAILED:        "failedAt",
};

// Customer-facing wording — one place, so the tracking page, the customer
// order page and notifications can't drift.
export const CUSTOMER_LABEL = {
  SEARCHING:     "Finding a delivery partner",
  ASSIGNED:      "Delivery partner assigned",
  AT_RESTAURANT: "Delivery partner is at the restaurant",
  PICKED_UP:     "On the way",
  AT_CUSTOMER:   "Delivery partner has arrived",
  DELIVERED:     "Delivered",
  FAILED:        "Delivery could not be completed",
  CANCELLED:     "Delivery cancelled",
};
