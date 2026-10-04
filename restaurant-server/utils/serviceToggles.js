// utils/serviceToggles.js
// ─────────────────────────────────────────────────────────────────────────────
// SET-01 — RestaurantProfile.services (Dine-in / Takeaway / Delivery) decides
// which order types customers may place. Enforced server-side at order time
// (orderService.placeOrderTx) and mirrored by the customer app, which hides
// switched-off types. Staff orders are not blocked: a waiter keying an order
// at the counter is the restaurant's own decision.
// ─────────────────────────────────────────────────────────────────────────────
import { ORDER_TYPES } from "./orderStateMachine.js";

// Order type → the services switch that allows it.
export const SERVICE_FOR_TYPE = { DINE_IN: "dineIn", TAKEAWAY: "takeAway", ONLINE: "delivery" };
for (const t of Object.keys(SERVICE_FOR_TYPE)) {
  if (!ORDER_TYPES.includes(t)) throw new Error(`serviceToggles: unknown order type ${t}`);
}
// Same defaults as the schema (getModels.js) for a profile saved before the
// field existed.
const DEFAULTS = { dineIn: true, takeAway: true, delivery: false };
const LABEL = { dineIn: "Dine-in", takeAway: "Takeaway", delivery: "Delivery" };

/** { dineIn, takeAway, delivery } with defaults filled in. */
export const effectiveServices = (profile) => ({ ...DEFAULTS, ...(profile?.services?.toObject?.() || profile?.services || {}) });

export const isServiceEnabled = (profile, orderType) => {
  const key = SERVICE_FOR_TYPE[orderType];
  return key ? effectiveServices(profile)[key] !== false : false;
};

/** Throws 400 when a customer orders a switched-off service. */
export const assertServiceEnabled = (profile, orderType) => {
  if (isServiceEnabled(profile, orderType)) return;
  const err = new Error(`${LABEL[SERVICE_FOR_TYPE[orderType]] || "This service"} is not available right now`);
  err.statusCode = 400;
  err.code = "SERVICE_DISABLED";
  throw err;
};
