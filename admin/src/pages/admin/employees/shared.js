// src/pages/admin/employees/shared.js — small helpers shared by the Employees screen.
import { t, N_, fmtNum, fmtDate } from "../../../i18n/core.js";

export const ROLE_LABEL = { waiter: N_("Waiter"), chef: N_("Chef"), admin: N_("Admin") };
// Duty state from the attendance service (AttendanceSession lifecycle).
export const DUTY_LABEL = { ONLINE: N_("On duty"), BREAK: N_("On break"), OFFLINE: N_("Off duty") };

export const initials = (name = "") =>
  name.trim().split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 2) || "?";

export const fmtDuration = (totalSeconds) => {
  const s = Math.max(0, Math.round(totalSeconds || 0));
  return t("{h}h {m}m", { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60) });
};

// Local-day "YYYY-MM-DD" (never toISOString(), which shifts by the UTC offset).
export const toDateInput = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

export const phoneLabel = (phone) => (phone ? `+91 ${phone}` : "—");
export const count = (n) => fmtNum(n ?? 0);

// Documents tab slots — shared with the tab's "missing" badge.
export const documentSlots = (employee) => {
  const hr = employee.hr || {};
  return [
    { key: "id", label: N_("ID proof"), value: hr.idProofType ? `${t(hr.idProofType)}${hr.idProofLast4 ? ` •••• ${hr.idProofLast4}` : ""}` : "", ok: !!(hr.idProofType && hr.idProofLast4) },
    { key: "joined", label: N_("Joining date"), value: fmtDate(hr.joinedAt || employee.createdAt, { day: "numeric", month: "short", year: "numeric" }), ok: true, note: hr.joinedAt ? "" : N_("Date the account was created") },
    { key: "address", label: N_("Address"), value: employee.address || "", ok: !!employee.address },
    { key: "emergency", label: N_("Emergency contact"), value: hr.emergencyPhone ? `${hr.emergencyName || ""} · +91 ${hr.emergencyPhone}`.replace(/^ · /, "") : "", ok: !!hr.emergencyPhone },
    { key: "photo", label: N_("Photo"), value: hr.photo ? N_("Added") : "", ok: !!hr.photo, photo: hr.photo },
    { key: "payout", label: N_("Bank / UPI for salary"), value: [hr.payoutUpi, hr.payoutBank].filter(Boolean).join(" · "), ok: !!(hr.payoutUpi || hr.payoutBank) },
  ];
};
export const missingDocs = (employee) => documentSlots(employee).filter((s) => !s.ok).length;

