// utils/menuSchedule.js
// ─────────────────────────────────────────────────────────────────────────────
// Scheduled menu visibility — pure time logic, no DB access.
//
// A schedule is a daily time-of-day window, evaluated in the RESTAURANT's
// timezone (RestaurantProfile.timezone, default Asia/Kolkata) — never the
// customer's device clock:
//
//   { enabled: true, startTime: "HH:MM", endTime: "HH:MM" }   (24h, zero-padded)
//
// Boundaries: start is INCLUSIVE, end is EXCLUSIVE.
//   10:00→12:00  visible at 10:00 and 11:59, hidden at 12:00.
// A window whose end is earlier than its start crosses midnight:
//   22:00→02:00  visible 22:00–23:59 and 00:00–01:59.
// start === end is rejected by validation (ambiguous: "never" or "always").
//
// Scheduling is SEPARATE from `isAvailable` (the manual 86 toggle). Customer
// visibility = isAvailable AND category schedule allows now AND item schedule
// allows now. A missing / disabled schedule always allows.
//
// Future multiple windows: all evaluation goes through isScheduleActive(), so
// supporting e.g. `schedule.windows: [{startTime,endTime}]` later only means
// changing that one function + validateSchedule — callers never read the
// time fields directly.
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_TIMEZONE = "Asia/Kolkata";

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "HH:MM" → minutes since midnight, or null if malformed. */
export const parseHHMM = (s) => {
  if (typeof s !== "string") return null;
  const m = TIME_RE.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

export const isValidTimezone = (tz) => {
  if (typeof tz !== "string" || !tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** The profile's timezone if it's a real IANA zone, else the default. */
export const resolveTimezone = (tz) => (isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE);

/** Minutes since local midnight in `tz` for the given instant. */
export const minutesInTimezone = (date = new Date(), tz = DEFAULT_TIMEZONE) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: resolveTimezone(tz), hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const minute = Number(parts.find((p) => p.type === "minute")?.value);
  return hour * 60 + minute;
};

/**
 * Does `schedule` allow visibility at `nowMinutes` (0–1439)?
 * No schedule / disabled → true. A stored schedule that is somehow malformed
 * is treated as "no restriction" rather than hiding the item forever — the
 * write path (validateSchedule) never stores one, so this is belt-and-braces.
 */
export const isScheduleActive = (schedule, nowMinutes) => {
  if (!schedule || schedule.enabled !== true) return true;
  const start = parseHHMM(schedule.startTime);
  const end = parseHHMM(schedule.endTime);
  if (start === null || end === null || start === end) return true;
  return start < end
    ? nowMinutes >= start && nowMinutes < end
    : nowMinutes >= start || nowMinutes < end; // crosses midnight
};

/**
 * Validates an admin-supplied schedule. Returns the normalized schedule to
 * store, or throws a 400. `null` means "clear the schedule".
 */
export const validateSchedule = (input) => {
  if (input === null) return { enabled: false, startTime: "", endTime: "" };
  const bad = (msg) => { const e = new Error(msg); e.statusCode = 400; return e; };
  if (typeof input !== "object" || Array.isArray(input)) throw bad("schedule must be an object or null");
  const { startTime, endTime } = input;
  if (parseHHMM(startTime) === null) throw bad("startTime must be HH:MM (24-hour)");
  if (parseHHMM(endTime) === null) throw bad("endTime must be HH:MM (24-hour)");
  if (startTime === endTime) throw bad("startTime and endTime cannot be the same");
  return { enabled: true, startTime, endTime };
};

/** "17:00" → "5:00 PM" (display helper). */
export const formatHHMM = (s) => {
  const mins = parseHHMM(s);
  if (mins === null) return s;
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
