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
export const resetCategoryOrdering = async ({ models, db }) => {
  const work = async (session) => {
    const categoryResult = await models.Category.updateMany(
      { orderingEnabled: false }, { $set: { orderingEnabled: true } }, { session },
    );
    await models.MenuItem.updateMany(
      {}, { $set: { isAvailable: true, soldOutUntil: null } }, { session },
    );
    return categoryResult.modifiedCount || 0;
  };
  if (!db) return work(undefined);
  const session = await db.startSession();
  try {
    let changed = 0;
    await session.withTransaction(async () => { changed = await work(session); });
    return changed;
  } finally { await session.endSession(); }
};
