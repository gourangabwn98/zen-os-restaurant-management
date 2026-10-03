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
// Optional limits on top of the daily window (used by named Menu times such as
// "Weekend special" or "Puja special"):
//   days:      [0..6]  (0 = Sunday) — empty = every day
//   startDate / endDate: "YYYY-MM-DD", both inclusive — "" = open-ended
// Times may both be "" (all day) when days or dates are set. An overnight
// window belongs to the day it STARTS on: Fri 22:00→02:00 still shows at
// Sat 01:00, and not at Sun 01:00.
//
// All evaluation goes through isScheduleActive(), so callers never read the
// time fields directly. Pass it a clock from clockInTimezone(); a bare
// minutes number still works (days/dates are then not checked).
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

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const isValidDate = (s) => {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; // rejects 2026-02-30
};
const shiftDate = (ymd, days) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * The restaurant's wall clock at `date`:
 *   { minutes, weekday (0 = Sun), date "YYYY-MM-DD", prevWeekday, prevDate }
 * prev* is "yesterday", for the after-midnight half of an overnight window.
 */
export const clockInTimezone = (date = new Date(), tz = DEFAULT_TIMEZONE) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: resolveTimezone(tz), year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const ymd = `${get("year")}-${get("month")}-${get("day")}`;
  const weekday = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  return {
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
    weekday, date: ymd,
    prevWeekday: (weekday + 6) % 7, prevDate: shiftDate(ymd, -1),
  };
};

/**
 * Does `schedule` allow visibility at `now` — a clock from clockInTimezone(),
 * or bare minutes since midnight (0–1439; days/dates then not checked)?
 * No schedule / disabled → true. A stored schedule that is somehow malformed
 * is treated as "no restriction" rather than hiding the item forever — the
 * write path (validateSchedule) never stores one, so this is belt-and-braces.
 */
export const isScheduleActive = (schedule, now) => {
  if (!schedule || schedule.enabled !== true) return true;
  const clock = typeof now === "number" ? { minutes: now } : (now || {});
  const mins = clock.minutes;
  const allDay = !schedule.startTime && !schedule.endTime;
  let fromYesterday = false;
  if (!allDay) {
    const start = parseHHMM(schedule.startTime);
    const end = parseHHMM(schedule.endTime);
    if (start !== null && end !== null && start !== end) {
      if (start < end) {
        if (!(mins >= start && mins < end)) return false;
      } else if (mins < end) {
        fromYesterday = true; // after-midnight half of an overnight window
      } else if (mins < start) {
        return false;
      }
    }
  }
  const weekday = fromYesterday ? clock.prevWeekday : clock.weekday;
  const ymd = fromYesterday ? clock.prevDate : clock.date;
  const days = Array.isArray(schedule.days) ? schedule.days : [];
  if (days.length && weekday !== undefined && !days.includes(weekday)) return false;
  if (ymd !== undefined) {
    if (isValidDate(schedule.startDate) && ymd < schedule.startDate) return false;
    if (isValidDate(schedule.endDate) && ymd > schedule.endDate) return false;
  }
  return true;
};

export const EMPTY_SCHEDULE = Object.freeze({ enabled: false, startTime: "", endTime: "", days: [], startDate: "", endDate: "" });

/**
 * Validates an admin-supplied schedule. Returns the normalized schedule to
 * store, or throws a 400. `null` means "clear the schedule".
 */
export const validateSchedule = (input) => {
  if (input === null) return { ...EMPTY_SCHEDULE, days: [] };
  const bad = (msg) => { const e = new Error(msg); e.statusCode = 400; return e; };
  if (typeof input !== "object" || Array.isArray(input)) throw bad("schedule must be an object or null");
  const { startTime = "", endTime = "", days = [], startDate = "", endDate = "" } = input;

  if (!Array.isArray(days)) throw bad("days must be an array of weekday numbers (0 = Sunday)");
  const daySet = new Set();
  for (const d of days) {
    if (!Number.isInteger(d) || d < 0 || d > 6) throw bad("days must be whole numbers from 0 (Sunday) to 6 (Saturday)");
    daySet.add(d);
  }
  const cleanDays = daySet.size === 7 ? [] : [...daySet].sort((a, b) => a - b); // all seven = every day
  for (const [label, v] of [["startDate", startDate], ["endDate", endDate]]) {
    if (v !== "" && !isValidDate(v)) throw bad(`${label} must be a real date as YYYY-MM-DD`);
  }
  if (startDate && endDate && endDate < startDate) throw bad("endDate cannot be before startDate");

  const allDay = startTime === "" && endTime === "";
  if (allDay) {
    if (!cleanDays.length && !startDate && !endDate) throw bad("startTime must be HH:MM (24-hour)");
  } else {
    if (parseHHMM(startTime) === null) throw bad("startTime must be HH:MM (24-hour)");
    if (parseHHMM(endTime) === null) throw bad("endTime must be HH:MM (24-hour)");
    if (startTime === endTime) throw bad("startTime and endTime cannot be the same");
  }
  return { enabled: true, startTime, endTime, days: cleanDays, startDate, endDate };
};

/**
 * When a "Sold out today" item comes back: the next time the restaurant's
 * clock reads `dayEnd` ("HH:MM", default 03:00 — the end of the business day).
 */
export const nextBusinessDayEnd = (now = new Date(), tz = DEFAULT_TIMEZONE, dayEnd = "03:00") => {
  const target = parseHHMM(dayEnd) ?? 180;
  const mins = minutesInTimezone(now, tz);
  const ahead = ((target - mins) + 1440) % 1440 || 1440;
  const startOfMinute = now.getTime() - (now.getUTCSeconds() * 1000 + now.getUTCMilliseconds());
  return new Date(startOfMinute + ahead * 60000);
};

/** "17:00" → "5:00 PM" (display helper). */
export const formatHHMM = (s) => {
  const mins = parseHHMM(s);
  if (mins === null) return s;
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
