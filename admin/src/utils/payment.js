// Payment method helpers. Order.paymentMethod is "Cash" | "Online" | "Both";
// "Both" is a split bill — Order.paymentSplit { cash, online } says how much
// came each way (the server checks the two add up to the bill total).
import { t, fmtNum } from "../i18n/core.js";

export const SPLIT = "Both";

const isSplit = (o) => o?.paymentMethod === SPLIT;

/** Money of this order that came in cash / online (whole total when not split). */
export const cashPart = (o) => (isSplit(o) ? Number(o.paymentSplit?.cash) || 0 : (o?.paymentMethod || "Cash") === "Cash" ? Number(o?.total) || 0 : 0);
export const onlinePart = (o) => (isSplit(o) ? Number(o.paymentSplit?.online) || 0 : o?.paymentMethod === "Online" ? Number(o?.total) || 0 : 0);

const rs = (n) => `₹${fmtNum(Number(n) || 0, { maximumFractionDigits: 2 })}`;

/** "Cash" | "Online" | "Cash ₹300 + Online ₹200" (translated). */
export const paymentLabel = (o) => (isSplit(o)
  ? `${t("Cash")} ${rs(o.paymentSplit?.cash)} + ${t("Online")} ${rs(o.paymentSplit?.online)}`
  : t(o?.paymentMethod || "Cash"));

/** Do these amounts make a valid split of `total`? (Same rule as the server.) */
export const splitOk = (cash, online, total) => {
  const c = Math.round(Number(cash) * 100), on = Math.round(Number(online) * 100);
  return c > 0 && on > 0 && c + on === Math.round(Number(total) * 100);
};
