// utils/guestOrderToken.js
// ─────────────────────────────────────────────────────────────────────────────
// Guest customers don't log in, so there's no `req.user` to check ownership
// against. Instead, when a guest places an order we hand back a short-lived,
// order-scoped JWT. The client can present it later (header
// `x-guest-order-token`) to prove it is the same guest who placed that
// specific order — without needing any account system.
//
// This is purely additive: existing customer-app behaviour (fetching an
// order by its Mongo _id with no token) keeps working exactly as before, so
// today's build of the customer app is not broken by this change. Providing
// the token just adds a stronger ownership guarantee for future frontend use.
// ─────────────────────────────────────────────────────────────────────────────

import jwt from "jsonwebtoken";

const PURPOSE = "guest-order-access";

export const signGuestOrderToken = (orderId) =>
  jwt.sign({ orderId: String(orderId), purpose: PURPOSE }, process.env.JWT_SECRET, {
    expiresIn: "12h",
  });

/** Returns true only if the token is valid AND scoped to this exact order. */
export const verifyGuestOrderToken = (token, orderId) => {
  if (!token) return false;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded.purpose === PURPOSE && String(decoded.orderId) === String(orderId);
  } catch {
    return false;
  }
};
