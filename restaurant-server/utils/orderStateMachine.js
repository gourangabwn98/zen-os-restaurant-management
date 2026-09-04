// utils/orderStateMachine.js
// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for the order lifecycle. Every place that changes
// an order's status (customer cancel, waiter confirm, admin override, etc.)
// must go through `assertValidTransition` so the rules can never drift
// between controllers.
//
//   PENDING_CONFIRMATION → CONFIRMED → PREPARING → READY → DELIVERED → COMPLETED
//                        ↘ CANCELLED (only from the first three states)
// ─────────────────────────────────────────────────────────────────────────────

export const ORDER_STATUSES = [
  "PENDING_CONFIRMATION",
  "CONFIRMED",
  "PREPARING",
  "READY",
  "DELIVERED",
  "COMPLETED",
  "CANCELLED",
];

export const ORDER_SOURCES = ["CUSTOMER", "WAITER", "ADMIN"];
export const ORDER_TYPES   = ["DINE_IN", "TAKEAWAY", "ONLINE"];

// Map of status -> statuses it may legally move to next.
const TRANSITIONS = {
  PENDING_CONFIRMATION: ["CONFIRMED", "CANCELLED"],
  CONFIRMED:            ["PREPARING", "CANCELLED"],
  PREPARING:            ["READY", "CANCELLED"],
  READY:                ["DELIVERED"],
  DELIVERED:            ["COMPLETED"],
  COMPLETED:            [],
  CANCELLED:            [],
};

// Which roles may perform which transition. "*" = any authenticated staff
// (admin/waiter). Customers are handled separately (see canCustomerCancel).
const TRANSITION_ROLES = {
  "PENDING_CONFIRMATION->CONFIRMED": ["admin", "waiter"],
  "PENDING_CONFIRMATION->CANCELLED": ["admin", "waiter", "customer"],
  "CONFIRMED->PREPARING":            ["admin", "waiter", "chef"],
  "CONFIRMED->CANCELLED":            ["admin", "waiter"],
  "PREPARING->READY":                ["admin", "waiter", "chef"],
  "PREPARING->CANCELLED":            ["admin"], // once kitchen has started, only admin can void
  "READY->DELIVERED":                ["admin", "waiter"],
  "DELIVERED->COMPLETED":            ["admin", "waiter"],
};

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
