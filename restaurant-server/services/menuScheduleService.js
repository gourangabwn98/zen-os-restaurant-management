// services/menuScheduleService.js
// ─────────────────────────────────────────────────────────────────────────────
// Scheduled menu visibility — the DB-facing half (pure time logic lives in
// utils/menuSchedule.js).
//
// Rule (enforced on the customer/waiter menu read AND at order pricing, so a
// stale page, an old URL or a direct API call can't get around it):
//   visible = item.isAvailable
//             AND category schedule allows now   (category hidden ⇒ all its items hidden)
// Menu items have NO time schedule of their own (removed) — an old item
// "schedule" value left in the database is ignored.
// ─────────────────────────────────────────────────────────────────────────────

import mongoose from "mongoose";
import { isScheduleActive, clockInTimezone, resolveTimezone, validateSchedule } from "../utils/menuSchedule.js";
import { restoreSoldOutItems } from "./menuItemService.js";

const MAX_BULK_IDS = 1000;

const httpError = (msg, statusCode = 400) => {
  const e = new Error(msg);
  e.statusCode = statusCode;
  return e;
};

/**
 * Snapshot of "what is scheduled-out right now" — two small queries, built
 * once per request and reused for every item. Every menu read and every order
 * pricing builds one first, so this is also where expired "Sold out today"
 * items are switched back on (before anything reads `isAvailable`).
 * @param {object} [profile] RestaurantProfile doc if the caller already has it.
 * @returns {{ timezone: string, nowMinutes: number, clock: object, hiddenCategories: Set<string> }}
 */
export const getScheduleContext = async ({ models, profile, now = new Date() }) => {
  const { RestaurantProfile, Category } = models;
  // Independent reads run together (one DB round trip instead of three). The
  // sold-out restore only touches MenuItem, and it still completes before this
  // returns — i.e. before any caller reads menu items or prices an order.
  const [, prof, scheduledCats] = await Promise.all([
    typeof models.MenuItem?.updateMany === "function" ? restoreSoldOutItems({ models, now }) : null,
    profile !== undefined ? profile : RestaurantProfile.findOne().select("timezone").lean(),
    Category.find({ "schedule.enabled": true }).select("name schedule").lean(),
  ]);
  const timezone = resolveTimezone(prof?.timezone);
  const clock = clockInTimezone(now, timezone);

  const hiddenCategories = new Set(
    scheduledCats.filter((c) => !isScheduleActive(c.schedule, clock)).map((c) => c.name),
  );
  return { timezone, nowMinutes: clock.minutes, clock, hiddenCategories };
};

/** Category half of the visibility rule (isAvailable is checked separately):
 * an item is hidden by time only when its category is scheduled out. */
export const isItemScheduledNow = (item, ctx) => !ctx.hiddenCategories.has(item.category);

const normalizeIds = (raw, label) => {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw httpError(`${label} must be an array`);
  const ids = [...new Set(raw.map((id) => String(id)))]; // duplicates collapse to one update
  for (const id of ids) {
    if (!mongoose.isValidObjectId(id)) throw httpError(`Invalid id in ${label}: ${id}`);
  }
  return ids;
};

/**
 * Applies one schedule (or clears it, schedule === null) to many CATEGORIES.
 * All ids are validated to exist before anything is written, so a bad id
 * rejects the whole request instead of half-applying it. Menu items can't be
 * scheduled (that feature was removed) — item ids are refused.
 */
export const applyBulkSchedule = async ({ models, itemIds, categoryIds, schedule }) => {
  const { Category } = models;
  if (schedule === undefined) throw httpError("schedule is required (object, or null to clear)");
  if (normalizeIds(itemIds, "itemIds").length) {
    throw httpError("Menu items no longer have their own time schedule — set a time on the category instead");
  }
  const normalized = validateSchedule(schedule);

  const cats = normalizeIds(categoryIds, "categoryIds");
  if (cats.length === 0) throw httpError("Select at least one category");
  if (cats.length > MAX_BULK_IDS) throw httpError(`At most ${MAX_BULK_IDS} entries per request`);

  const catCount = await Category.countDocuments({ _id: { $in: cats } });
  if (catCount !== cats.length) throw httpError(`${cats.length - catCount} selected categor(ies) no longer exist — refresh and try again`, 404);

  // A hand-set window takes the category out of its Menu time.
  const catRes = await Category.updateMany({ _id: { $in: cats } }, { $set: { schedule: normalized, menuTime: null } });

  return {
    schedule: normalized,
    categoriesUpdated: catRes?.modifiedCount ?? 0,
    categoriesMatched: cats.length,
  };
};
