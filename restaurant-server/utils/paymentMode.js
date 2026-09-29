// utils/paymentMode.js
// ─────────────────────────────────────────────────────────────────────────────
// How customers may pay — RestaurantProfile.paymentMode (Admin → Profile →
// Payment). Pure logic; the server applies it when a CUSTOMER places an
// order (staff-keyed orders are taken in person and are not restricted).
//
//   CASH   — order directly; pay at the table/counter (the customer app points
//            them at "Call waiter").
//   ONLINE — pay first: the order starts AWAITING_PAYMENT and only reaches
//            staff after a checksum-verified PhonePe success.
//   BOTH   — the customer picks; picking Online is the same pay-first flow.
//
// Pay-first needs the PhonePe gateway: a UPI deep link can't be verified
// automatically, so without PhonePe "ONLINE" falls back to CASH (and the
// admin can't select it — profileController rejects it), while "BOTH" keeps
// the older UPI flow (order placed, staff verify the payment by hand).
// ─────────────────────────────────────────────────────────────────────────────

export const PAYMENT_MODES = ["CASH", "ONLINE", "BOTH"];
export const DEFAULT_PAYMENT_MODE = "BOTH";

// Payment method values on Order.paymentMethod (genuinely mixed-case).
export const PAYMENT_METHODS = ["Cash", "Online"];

/** Unpaid pay-first orders are cancelled after this long. */
export const PAY_FIRST_WINDOW_MS = 15 * 60 * 1000;

/** The mode actually in force, given whether PhonePe is configured. */
export const effectivePaymentMode = (mode, phonePeEnabled) => {
  const m = PAYMENT_MODES.includes(mode) ? mode : DEFAULT_PAYMENT_MODE;
  if (m === "ONLINE" && !phonePeEnabled) return "CASH";
  return m;
};

/** Payment methods a customer may choose under the effective mode. */
export const allowedPaymentMethods = (effectiveMode) =>
  effectiveMode === "CASH" ? ["Cash"] : effectiveMode === "ONLINE" ? ["Online"] : ["Cash", "Online"];

/** Does this customer order have to be paid before staff see it? */
export const isPayFirst = (paymentMethod, phonePeEnabled) =>
  paymentMethod === "Online" && !!phonePeEnabled;

/**
 * Resolves the payment method for a customer order, or throws 400. A missing
 * method defaults to the only allowed one (single-option modes) or Cash.
 */
export const resolveCustomerPaymentMethod = ({ requested, mode, phonePeEnabled }) => {
  const eff = effectivePaymentMode(mode, phonePeEnabled);
  const allowed = allowedPaymentMethods(eff);
  const method = requested ?? (allowed.length === 1 ? allowed[0] : "Cash");
  if (!allowed.includes(method)) {
    const e = new Error(
      eff === "ONLINE" ? "This restaurant only accepts online payment — please pay online to place your order"
        : eff === "CASH" ? "Online payment isn't available — please choose cash"
        : `Payment method must be one of: ${allowed.join(", ")}`,
    );
    e.statusCode = 400;
    throw e;
  }
  return method;
};
