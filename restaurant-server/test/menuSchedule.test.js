// test/menuSchedule.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Scheduled menu visibility: pure time logic (utils/menuSchedule.js), the
// category+item rule and bulk update (services/menuScheduleService.js), and
// order-time enforcement (utils/pricing.js). No DB — fake models. Run with:
//   node test/menuSchedule.test.js
// ─────────────────────────────────────────────────────────────────────────────

import assert from "node:assert/strict";
import {
  parseHHMM, isScheduleActive, validateSchedule, minutesInTimezone, resolveTimezone, formatHHMM,
  clockInTimezone, nextBusinessDayEnd,
} from "../utils/menuSchedule.js";
import { getScheduleContext, isItemScheduledNow, applyBulkSchedule } from "../services/menuScheduleService.js";
import { priceItems } from "../utils/pricing.js";

let passed = 0;
let failed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL - ${name}`);
    console.error(`         ${err.message}`);
  }
};

const at = (hhmm) => parseHHMM(hhmm);
const S = (startTime, endTime) => ({ enabled: true, startTime, endTime });
// What validateSchedule stores (days / dates empty = every day, no date limit).
const N = (startTime, endTime, extra = {}) => ({ enabled: true, startTime, endTime, days: [], startDate: "", endDate: "", ...extra });
const CLEARED = { enabled: false, startTime: "", endTime: "", days: [], startDate: "", endDate: "" };

// chainable fake for Model.find/findOne(...).select(...).lean()
const chain = (value) => ({ select: () => chain(value), lean: async () => value, then: (r, j) => Promise.resolve(value).then(r, j) });

const run = async () => {
  console.log("── time logic ─────────────────────────────────");

  await test("no schedule / disabled schedule → always visible", () => {
    assert.equal(isScheduleActive(undefined, at("03:00")), true);
    assert.equal(isScheduleActive({ enabled: false, startTime: "10:00", endTime: "11:00" }, at("03:00")), true);
  });

  await test("normal window 09:00→17:00", () => {
    const s = S("09:00", "17:00");
    assert.equal(isScheduleActive(s, at("08:59")), false);
    assert.equal(isScheduleActive(s, at("12:00")), true);
    assert.equal(isScheduleActive(s, at("17:01")), false);
  });

  await test("exact start is visible (inclusive), exact end is hidden (exclusive)", () => {
    const s = S("10:00", "12:00");
    assert.equal(isScheduleActive(s, at("10:00")), true);
    assert.equal(isScheduleActive(s, at("11:59")), true);
    assert.equal(isScheduleActive(s, at("12:00")), false);
  });

  await test("overnight window 22:00→02:00", () => {
    const s = S("22:00", "02:00");
    assert.equal(isScheduleActive(s, at("21:59")), false);
    assert.equal(isScheduleActive(s, at("22:00")), true);
    assert.equal(isScheduleActive(s, at("23:59")), true);
    assert.equal(isScheduleActive(s, at("00:00")), true);
    assert.equal(isScheduleActive(s, at("01:59")), true);
    assert.equal(isScheduleActive(s, at("02:00")), false);
    assert.equal(isScheduleActive(s, at("12:00")), false);
  });

  await test("malformed stored schedule does not hide forever", () => {
    assert.equal(isScheduleActive({ enabled: true, startTime: "bad", endTime: "10:00" }, at("03:00")), true);
  });

  await test("validateSchedule accepts HH:MM and normalizes; null clears", () => {
    assert.deepEqual(validateSchedule({ startTime: "17:00", endTime: "23:00", enabled: false, junk: 1 }),
      N("17:00", "23:00"));
    assert.deepEqual(validateSchedule(null), CLEARED);
  });

  await test("validateSchedule rejects bad formats and start === end", () => {
    for (const bad of [
      { startTime: "5:00", endTime: "11:00" }, { startTime: "24:00", endTime: "11:00" },
      { startTime: "10:60", endTime: "11:00" }, { startTime: "10:00" }, { startTime: "10:00", endTime: "10:00" },
      "10:00-11:00", [], { startTime: { $gt: "" }, endTime: "11:00" },
    ]) {
      assert.throws(() => validateSchedule(bad), (e) => e.statusCode === 400, JSON.stringify(bad));
    }
  });

  await test("minutesInTimezone uses the restaurant zone, not the server clock", () => {
    const d = new Date("2026-01-01T12:30:00Z");               // 18:00 IST
    assert.equal(minutesInTimezone(d, "Asia/Kolkata"), 18 * 60);
    assert.equal(minutesInTimezone(d, "UTC"), 12 * 60 + 30);
    assert.equal(minutesInTimezone(new Date("2026-01-01T18:30:00Z"), "Asia/Kolkata"), 0); // midnight IST
  });

  await test("invalid timezone falls back to Asia/Kolkata", () => {
    assert.equal(resolveTimezone("Not/AZone"), "Asia/Kolkata");
    assert.equal(resolveTimezone(undefined), "Asia/Kolkata");
    assert.equal(resolveTimezone("Europe/London"), "Europe/London");
  });

  await test("formatHHMM renders 12-hour labels", () => {
    assert.equal(formatHHMM("00:05"), "12:05 AM");
    assert.equal(formatHHMM("12:00"), "12:00 PM");
    assert.equal(formatHHMM("23:00"), "11:00 PM");
  });

  console.log("── category + item interaction ────────────────");

  const categories = [
    { _id: "c1", name: "Pizza",    schedule: S("17:00", "23:00") },
    { _id: "c2", name: "Mocktail", schedule: S("12:00", "22:00") },
    { _id: "c3", name: "Breakfast", schedule: { enabled: false, startTime: "", endTime: "" } },
  ];
  const models = (profile = { timezone: "Asia/Kolkata" }) => ({
    RestaurantProfile: { findOne: () => chain(profile) },
    Category: { find: (q) => chain(q?.["schedule.enabled"] ? categories.filter((c) => c.schedule.enabled) : categories) },
  });
  const istAt = (hhmm) => { // an instant whose IST wall-clock is hhmm
    const m = at(hhmm) - 330;
    return new Date(Date.UTC(2026, 0, 2, 0, 0) + m * 60000);
  };
  const ctxAt = (hhmm) => getScheduleContext({ models: models(), now: istAt(hhmm) });

  const cheese = { name: "Cheese Pizza", category: "Pizza", schedule: S("18:00", "21:00") };
  const marg = { name: "Margherita", category: "Pizza" };
  const toast = { name: "Toast", category: "Breakfast" };
  const special = { name: "Special Mocktail", category: "Mocktail", schedule: S("17:00", "20:00") };

  await test("category inactive → its items hidden (even with no own schedule)", async () => {
    const ctx = await ctxAt("10:00");
    assert.ok(ctx.hiddenCategories.has("Pizza"));
    assert.equal(isItemScheduledNow(marg, ctx), false);
  });

  await test("category active + item without schedule → visible", async () => {
    assert.equal(isItemScheduledNow(marg, await ctxAt("17:30")), true);
  });

  // Menu items have no time schedule of their own any more: an old item
  // "schedule" left in the database is ignored — only the category counts.
  await test("an item's own old schedule is ignored: visible whenever its category is", async () => {
    assert.equal(isItemScheduledNow(cheese, await ctxAt("17:30")), true, "outside the old item window → still visible");
    assert.equal(isItemScheduledNow(cheese, await ctxAt("22:30")), true);
    assert.equal(isItemScheduledNow(special, await ctxAt("12:30")), true);
    assert.equal(isItemScheduledNow(cheese, await ctxAt("10:00")), false, "category (Pizza 17–23) closed → hidden");
  });

  await test("unscheduled category/items unchanged at any hour", async () => {
    for (const t of ["00:00", "06:00", "12:00", "23:59"]) {
      assert.equal(isItemScheduledNow(toast, await ctxAt(t)), true);
      assert.equal(isItemScheduledNow({ name: "Orphan", category: "NoSuchCategory" }, await ctxAt(t)), true);
    }
  });

  console.log("── bulk update ────────────────────────────────");

  const oid = (n) => n.toString(16).padStart(24, "0");
  const makeBulkModels = (existingItems, existingCats) => {
    const calls = [];
    const M = (existing, label) => ({
      countDocuments: async (q) => q._id.$in.filter((id) => existing.includes(id)).length,
      updateMany: async (q, u) => { calls.push({ label, ids: q._id.$in, update: u }); return { modifiedCount: q._id.$in.length }; },
    });
    return { calls, models: { MenuItem: M(existingItems, "items"), Category: M(existingCats, "cats") } };
  };

  await test("applies one schedule to many categories in one updateMany (items untouched)", async () => {
    const cats = [9, 10].map(oid);
    const { calls, models: m } = makeBulkModels([], cats);
    const r = await applyBulkSchedule({ models: m, categoryIds: cats, schedule: { startTime: "18:00", endTime: "23:00" } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].label, "cats");
    assert.deepEqual(calls[0].update, { $set: { schedule: N("18:00", "23:00"), menuTime: null } },
      "a hand-set window takes the category out of its Menu time");
    assert.equal(r.categoriesUpdated, 2);
  });

  await test("duplicate ids collapse to one", async () => {
    const { calls, models: m } = makeBulkModels([], [oid(1)]);
    await applyBulkSchedule({ models: m, categoryIds: [oid(1), oid(1)], schedule: S("10:00", "11:00") });
    assert.deepEqual(calls[0].ids, [oid(1)]);
  });

  await test("null schedule clears", async () => {
    const { calls, models: m } = makeBulkModels([], [oid(1)]);
    await applyBulkSchedule({ models: m, categoryIds: [oid(1)], schedule: null });
    assert.deepEqual(calls[0].update.$set.schedule, CLEARED);
  });

  await test("menu ITEMS can no longer be scheduled — refused, nothing written", async () => {
    const { calls, models: m } = makeBulkModels([oid(1)], [oid(9)]);
    await assert.rejects(() => applyBulkSchedule({ models: m, itemIds: [oid(1)], schedule: S("10:00", "11:00") }),
      (e) => e.statusCode === 400 && /no longer have their own time schedule/.test(e.message));
    await assert.rejects(() => applyBulkSchedule({ models: m, itemIds: [oid(1)], categoryIds: [oid(9)], schedule: null }), (e) => e.statusCode === 400);
    assert.equal(calls.length, 0);
  });

  await test("rejects invalid / unknown ids, empty selection, bad schedule — writes nothing", async () => {
    const { calls, models: m } = makeBulkModels([], [oid(1)]);
    const rej = (args, code) => assert.rejects(() => applyBulkSchedule({ models: m, ...args }), (e) => e.statusCode === code);
    await rej({ categoryIds: ["not-an-id"], schedule: S("10:00", "11:00") }, 400);
    await rej({ categoryIds: [oid(1), oid(2)], schedule: S("10:00", "11:00") }, 404);
    await rej({ categoryIds: [], schedule: S("10:00", "11:00") }, 400);
    await rej({ categoryIds: [oid(1)], schedule: { startTime: "9", endTime: "10:00" } }, 400);
    await rej({ categoryIds: [oid(1)] }, 400);
    await rej({ categoryIds: "abc", schedule: null }, 400);
    assert.equal(calls.length, 0);
  });

  console.log("── days of the week, dates, sold-out time ─────");

  // 2026-01-02 is a Friday. clock(day offset, "HH:MM") in IST.
  const clockAt = (dayOffset, hhmm) => {
    const d = new Date(Date.UTC(2026, 0, 2 + dayOffset, 0, 0) + (at(hhmm) - 330) * 60000);
    return clockInTimezone(d, "Asia/Kolkata");
  };

  await test("clockInTimezone gives the restaurant's weekday, date and yesterday", () => {
    const c = clockAt(0, "00:30");
    assert.equal(c.weekday, 5);
    assert.equal(c.date, "2026-01-02");
    assert.equal(c.prevWeekday, 4);
    assert.equal(c.prevDate, "2026-01-01");
    assert.equal(c.minutes, 30);
  });

  await test("days limit a window to those weekdays (Fri–Sun lunch)", () => {
    const s = N("12:00", "22:00", { days: [5, 6, 0] });
    assert.equal(isScheduleActive(s, clockAt(0, "13:00")), true);   // Fri
    assert.equal(isScheduleActive(s, clockAt(2, "13:00")), true);   // Sun
    assert.equal(isScheduleActive(s, clockAt(3, "13:00")), false);  // Mon
    assert.equal(isScheduleActive(s, clockAt(0, "23:00")), false);  // Fri, outside the hours
  });

  await test("an overnight window belongs to the day it starts", () => {
    const s = N("22:00", "02:00", { days: [5] });                     // Friday night
    assert.equal(isScheduleActive(s, clockAt(0, "23:00")), true);   // Fri 23:00
    assert.equal(isScheduleActive(s, clockAt(1, "01:00")), true);   // Sat 01:00 — still Friday night
    assert.equal(isScheduleActive(s, clockAt(1, "23:00")), false);  // Sat night
    assert.equal(isScheduleActive(s, clockAt(0, "01:00")), false);  // Fri 01:00 = Thursday night
  });

  await test("all-day by dates (Puja special), inclusive at both ends", () => {
    const s = validateSchedule({ startDate: "2026-01-03", endDate: "2026-01-04" });
    assert.deepEqual(s, N("", "", { startDate: "2026-01-03", endDate: "2026-01-04" }));
    assert.equal(isScheduleActive(s, clockAt(0, "12:00")), false);  // Jan 2
    assert.equal(isScheduleActive(s, clockAt(1, "00:00")), true);   // Jan 3
    assert.equal(isScheduleActive(s, clockAt(2, "23:59")), true);   // Jan 4
    assert.equal(isScheduleActive(s, clockAt(3, "00:00")), false);  // Jan 5
  });

  await test("bare minutes still work (days/dates not checked) — older callers", () => {
    assert.equal(isScheduleActive(N("12:00", "22:00", { days: [1] }), at("13:00")), true);
  });

  await test("validateSchedule: days and dates", () => {
    assert.deepEqual(validateSchedule({ startTime: "12:00", endTime: "22:00", days: [0, 6, 5, 5] }).days, [0, 5, 6]);
    assert.deepEqual(validateSchedule({ startTime: "12:00", endTime: "22:00", days: [0, 1, 2, 3, 4, 5, 6] }).days, [],
      "all seven days = every day");
    for (const bad of [
      { startTime: "", endTime: "" },                                   // nothing at all
      { startTime: "12:00", endTime: "22:00", days: [7] },
      { startTime: "12:00", endTime: "22:00", days: "5" },
      { startTime: "12:00", endTime: "22:00", days: [1.5] },
      { startDate: "2026-02-30" },
      { startDate: "2026-01-05", endDate: "2026-01-04" },
      { startTime: "12:00", endTime: "" },
    ]) {
      assert.throws(() => validateSchedule(bad), (e) => e.statusCode === 400, JSON.stringify(bad));
    }
  });

  await test("dated window in a category hides its items outside the dates", async () => {
    const cats = [{ _id: "p", name: "Puja", schedule: N("", "", { startDate: "2026-01-03", endDate: "2026-01-03" }) }];
    const m = { RestaurantProfile: { findOne: () => chain({ timezone: "Asia/Kolkata" }) }, Category: { find: () => chain(cats) } };
    const fri = await getScheduleContext({ models: m, now: new Date(Date.UTC(2026, 0, 2, 6, 30)) });
    const sat = await getScheduleContext({ models: m, now: new Date(Date.UTC(2026, 0, 3, 6, 30)) });
    assert.equal(isItemScheduledNow({ category: "Puja" }, fri), false);
    assert.equal(isItemScheduledNow({ category: "Puja" }, sat), true);
  });

  await test("getScheduleContext switches expired Sold-out items back on first", async () => {
    const calls = [];
    const m = {
      RestaurantProfile: { findOne: () => chain({ timezone: "Asia/Kolkata" }) },
      Category: { find: () => chain([]) },
      MenuItem: { updateMany: async (q, u) => { calls.push({ q, u }); return { modifiedCount: 2 }; } },
    };
    const now = new Date(Date.UTC(2026, 0, 2, 6, 30));
    await getScheduleContext({ models: m, now });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].q, { soldOutUntil: { $ne: null, $lte: now } });
    assert.deepEqual(calls[0].u, { $set: { isAvailable: true, soldOutUntil: null } });
  });

  await test("nextBusinessDayEnd = the next 03:00 restaurant time", () => {
    const iso = (d) => d.toISOString();
    // 20:00 IST Jan 2 → 03:00 IST Jan 3 = 21:30 UTC Jan 2
    assert.equal(iso(nextBusinessDayEnd(new Date("2026-01-02T14:30:15Z"), "Asia/Kolkata", "03:00")), "2026-01-02T21:30:00.000Z");
    // 01:00 IST → same night's 03:00
    assert.equal(iso(nextBusinessDayEnd(new Date("2026-01-01T19:30:00Z"), "Asia/Kolkata", "03:00")), "2026-01-01T21:30:00.000Z");
    // exactly 03:00 → tomorrow's, never "now"
    assert.equal(iso(nextBusinessDayEnd(new Date("2026-01-01T21:30:00Z"), "Asia/Kolkata", "03:00")), "2026-01-02T21:30:00.000Z");
  });

  console.log("── order pricing enforcement ──────────────────");

  const catalog = [
    { _id: "m1", name: "Margherita",   price: 300, isAvailable: true, category: "Pizza" },
    { _id: "m2", name: "Cheese Pizza", price: 350, isAvailable: true, category: "Pizza", schedule: S("18:00", "21:00") },
    { _id: "m3", name: "Toast",        price: 60,  isAvailable: true, category: "Breakfast" },
    { _id: "m4", name: "Sold out",     price: 60,  isAvailable: false, category: "Breakfast", schedule: S("00:00", "23:59") },
  ];
  const MenuItem = { findById: async (id) => catalog.find((c) => c._id === id) || null };

  await test("order for an item whose CATEGORY is closed is rejected", async () => {
    const ctx = await ctxAt("10:00");
    await assert.rejects(() => priceItems([{ menuItemId: "m1", qty: 1 }], MenuItem, ctx), /not available at this time/);
  });

  await test("an item's own old schedule never blocks an order (feature removed)", async () => {
    const r = await priceItems([{ menuItemId: "m2", qty: 1 }], MenuItem, await ctxAt("17:30")); // old window 18–21
    assert.equal(r[0].price, 350);
  });

  await test("in-window and unscheduled items still price normally", async () => {
    const r = await priceItems([{ menuItemId: "m2", qty: 1 }, { menuItemId: "m3", qty: 2 }], MenuItem, await ctxAt("19:00"));
    assert.equal(r[0].price, 350);
    assert.equal(r[1].qty, 2);
  });

  await test("isAvailable=false still wins over an active schedule", async () => {
    const ctx = await ctxAt("12:00");
    await assert.rejects(() => priceItems([{ menuItemId: "m4", qty: 1 }], MenuItem, ctx), /currently not available/);
  });

  console.log("──────────────────────────────────────────────");
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("SOME TESTS FAILED");
    process.exit(1);
  }
  console.log("ALL TESTS PASSED");
};

run();
