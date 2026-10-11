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
// What a customer may choose, and what a staff order is placed with.
export const PAYMENT_METHODS = ["Cash", "Online"];

// Staff collecting a bill may also take part in cash and part online
// ("Both"). The two amounts are stored on Order.paymentSplit and must add up
// to the bill total exactly — checked here, on the server, every time.
export const SPLIT_METHOD = "Both";
export const COLLECT_METHODS = [...PAYMENT_METHODS, SPLIT_METHOD];

const toPaise = (v) => Math.round(Number(v) * 100);

/**
 * Validates a cash + online split against the bill total, or throws 400.
 * Both parts must be more than zero (a "split" with ₹0 on one side is just
 * Cash or Online) and together equal the total to the paisa.
 * @returns {{ cash: number, online: number }} rounded to 2 decimals
 */
export const parsePaymentSplit = (split, total) => {
  const bad = (msg) => Object.assign(new Error(msg), { statusCode: 400 });
  const cash = toPaise(split?.cash), online = toPaise(split?.online);
  if (!Number.isFinite(cash) || !Number.isFinite(online)) throw bad("Enter both the cash and the online amount");
  if (cash <= 0 || online <= 0) throw bad("Cash and online amounts must both be more than ₹0 — otherwise choose Cash or Online");
  const due = toPaise(total);
  if (cash + online !== due) {
    throw bad(`Cash ₹${cash / 100} + Online ₹${online / 100} = ₹${(cash + online) / 100}, but the bill total is ₹${due / 100}`);
  }
  return { cash: cash / 100, online: online / 100 };
};

/** "Cash" | "Online" | "Cash ₹300 + Online ₹212.5" — for bills and messages. */
export const paymentMethodLabel = (order, rupee = "₹") => {
  const m = order?.paymentMethod || "Cash";
  if (m !== SPLIT_METHOD) return m;
  const s = order.paymentSplit || {};
  return `Cash ${rupee}${Number(s.cash) || 0} + Online ${rupee}${Number(s.online) || 0}`;
};

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
