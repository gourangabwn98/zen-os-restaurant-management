import { clockInTimezone, resolveTimezone } from "../utils/menuSchedule.js";

export const isAfterCategoryResetBoundary = (date, timezone) => {
  const local = clockInTimezone(date, resolveTimezone(timezone));
  return local.minutes >= 4 * 60;
};

export const categoryResetDay = (date, timezone) => {
  const local = clockInTimezone(date, resolveTimezone(timezone));
  return local.date;
};

// Persistent and idempotent: startup plus the periodic tick catches a missed
// 04:00 boundary after restarts, and updateMany is safe across instances.
export const resetCategoryOrdering = async ({ models }) => {
  const result = await models.Category.updateMany(
    { orderingEnabled: false },
    { $set: { orderingEnabled: true } },
  );
  return result.modifiedCount || 0;
};
