// src/pages/admin/delivery/shared.js — labels and formatting for Admin → Delivery.
// Status strings mirror restaurant-server/utils/deliveryStateMachine.js exactly.
import { t, N_ } from "../../../i18n/core.js";

export const JOB_STATUS = {
  SEARCHING:     { label: N_("Finding partner"), tone: "wait" },
  ASSIGNED:      { label: N_("Assigned"), tone: "vio" },
  AT_RESTAURANT: { label: N_("At restaurant"), tone: "vio" },
  PICKED_UP:     { label: N_("On the way"), tone: "live" },
  AT_CUSTOMER:   { label: N_("At customer"), tone: "live" },
  DELIVERED:     { label: N_("Delivered"), tone: "ready" },
  FAILED:        { label: N_("Failed"), tone: "stop" },
  CANCELLED:     { label: N_("Cancelled"), tone: "done" },
};
export const ACTIVE = ["ASSIGNED", "AT_RESTAURANT", "PICKED_UP", "AT_CUSTOMER"];
export const UNASSIGNABLE = ["ASSIGNED", "AT_RESTAURANT"];

export const COD_STATUS = {
  COLLECTED: { label: N_("With rider"), tone: "wait" },
  VERIFYING: { label: N_("Verifying…"), tone: "vio" },
  VERIFIED:  { label: N_("Verified"), tone: "ready" },
  DISPUTED:  { label: N_("Disputed"), tone: "stop" },
};

export const rupees = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
export const km = (m) => (m == null ? "—" : `${(m / 1000).toFixed(1)} km`);
export const clock = (d) => (d ? new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—");
export const dayTime = (d) => (d ? new Date(d).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
export const ago = (d) => {
  if (!d) return t("never");
  const m = Math.round((Date.now() - new Date(d)) / 60000);
  return m < 1 ? t("just now") : m < 60 ? t("{n} min ago", { n: m }) : t("{n} h ago", { n: Math.round(m / 60) });
};
export const mins = (v) => (v == null ? "—" : t("{n} min", { n: v }));
