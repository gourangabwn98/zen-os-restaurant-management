// services/menuScheduleService.js
// ─────────────────────────────────────────────────────────────────────────────
// Scheduled menu visibility — the DB-facing half (pure time logic lives in
// utils/menuSchedule.js).
//
// Rule (enforced on the customer/waiter menu read AND at order pricing, so a
// stale page, an old URL or a direct API call can't get around it):
//   visible = item.isAvailable
//             AND category schedule allows now   (category hidden ⇒ all its items hidden)
//             AND item schedule allows now       (item must satisfy BOTH)
// ─────────────────────────────────────────────────────────────────────────────

import mongoose from "mongoose";
import { isScheduleActive, minutesInTimezone, resolveTimezone, validateSchedule } from "../utils/menuSchedule.js";

const MAX_BULK_IDS = 1000;

const httpError = (msg, statusCode = 400) => {
  const e = new Error(msg);
  e.statusCode = statusCode;
  return e;
};

/**
 * Snapshot of "what is scheduled-out right now" — two small queries, built
 * once per request and reused for every item.
 * @param {object} [profile] RestaurantProfile doc if the caller already has it.
 * @returns {{ timezone: string, nowMinutes: number, hiddenCategories: Set<string> }}
 */
export const getScheduleContext = async ({ models, profile, now = new Date() }) => {
  const { RestaurantProfile, Category } = models;
  const prof = profile !== undefined
    ? profile
    : await RestaurantProfile.findOne().select("timezone").lean();
  const timezone = resolveTimezone(prof?.timezone);
  const nowMinutes = minutesInTimezone(now, timezone);

  const scheduledCats = await Category.find({ "schedule.enabled": true }).select("name schedule").lean();
  const hiddenCategories = new Set(
    scheduledCats.filter((c) => !isScheduleActive(c.schedule, nowMinutes)).map((c) => c.name),
  );
  return { timezone, nowMinutes, hiddenCategories };
};

/** Schedule half of the visibility rule (isAvailable is checked separately). */
export const isItemScheduledNow = (item, ctx) =>
  !ctx.hiddenCategories.has(item.category) && isScheduleActive(item.schedule, ctx.nowMinutes);

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
 * Applies one schedule (or clears it, schedule === null) to many categories
 * and/or items. All ids are validated to exist before anything is written, so
 * a bad id rejects the whole request instead of half-applying it.
 */
export const applyBulkSchedule = async ({ models, itemIds, categoryIds, schedule }) => {
  const { MenuItem, Category } = models;
  if (schedule === undefined) throw httpError("schedule is required (object, or null to clear)");
  const normalized = validateSchedule(schedule);

  const items = normalizeIds(itemIds, "itemIds");
  const cats = normalizeIds(categoryIds, "categoryIds");
  if (items.length === 0 && cats.length === 0) throw httpError("Select at least one category or item");
  if (items.length + cats.length > MAX_BULK_IDS) throw httpError(`At most ${MAX_BULK_IDS} entries per request`);

  const [itemCount, catCount] = await Promise.all([
    items.length ? MenuItem.countDocuments({ _id: { $in: items } }) : 0,
    cats.length ? Category.countDocuments({ _id: { $in: cats } }) : 0,
  ]);
  if (itemCount !== items.length) throw httpError(`${items.length - itemCount} selected item(s) no longer exist — refresh and try again`, 404);
  if (catCount !== cats.length) throw httpError(`${cats.length - catCount} selected categor(ies) no longer exist — refresh and try again`, 404);

  const [itemRes, catRes] = await Promise.all([
    items.length ? MenuItem.updateMany({ _id: { $in: items } }, { $set: { schedule: normalized } }) : null,
    cats.length ? Category.updateMany({ _id: { $in: cats } }, { $set: { schedule: normalized } }) : null,
  ]);

  return {
    schedule: normalized,
    itemsUpdated: itemRes?.modifiedCount ?? 0,
    categoriesUpdated: catRes?.modifiedCount ?? 0,
    itemsMatched: items.length,
    categoriesMatched: cats.length,
  };
};
