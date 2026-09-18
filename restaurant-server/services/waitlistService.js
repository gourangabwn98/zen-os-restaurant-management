// services/waitlistService.js
// ─────────────────────────────────────────────────────────────────────────────
// Walk-in queue for rush hours: when every table that fits a party is
// occupied, staff add them here instead of turning them away. As tables
// free up (TableSession closes — see tableSessionService.closeTableSession),
// the admin UI is shown the longest-waiting matching party as a suggestion;
// seating is always an explicit staff action (seatWaitlistEntry), never
// automatic, so a walk-in is never assigned to the wrong guest.
//
// Idempotency: every state change (notify/seat/cancel) is a single atomic
// conditional findOneAndUpdate keyed on the entry's CURRENT status, the same
// pattern as KOTJob/TableSession elsewhere in this codebase — so two staff
// members tapping "Seat" on the same entry at once can't both succeed.
// ─────────────────────────────────────────────────────────────────────────────

import { findOrOpenTableSession } from "./tableSessionService.js";

const ACTIVE_STATUSES = ["WAITING", "NOTIFIED"];

export const addToWaitlist = async ({ WaitlistEntry }, { guestName, guestPhone, partySize, notes, actor }) => {
  if (!guestName || !String(guestName).trim()) {
    const err = new Error("Guest name is required");
    err.statusCode = 400;
    throw err;
  }
  const size = Number(partySize);
  if (!Number.isFinite(size) || size < 1) {
    const err = new Error("Party size must be at least 1");
    err.statusCode = 400;
    throw err;
  }

  return WaitlistEntry.create({
    guestName: String(guestName).trim(),
    guestPhone: guestPhone ? String(guestPhone).trim() : "",
    partySize: size,
    notes: notes || "",
    createdBy: actor,
  });
};

/** status omitted → only the entries staff still need to act on. */
export const listWaitlist = ({ WaitlistEntry }, { status } = {}) => {
  const filter = status ? { status } : { status: { $in: ACTIVE_STATUSES } };
  return WaitlistEntry.find(filter).sort({ createdAt: 1 });
};

// Flags an entry as "we've told them a table is about to open up" — purely
// informational for staff (e.g. call out a name), doesn't move it in the
// queue or reserve anything.
export const markNotified = async ({ WaitlistEntry }, entryId) => {
  const entry = await WaitlistEntry.findOneAndUpdate(
    { _id: entryId, status: "WAITING" },
    { $set: { status: "NOTIFIED", notifiedAt: new Date() } },
    { new: true }
  );
  if (!entry) {
    const err = new Error("Waitlist entry not found or no longer waiting");
    err.statusCode = 404;
    throw err;
  }
  return entry;
};

/**
 * Seat a waiting party at a specific free table. Validates the table is
 * usable and actually free (server-side — never trust the client's idea of
 * "free"), then opens its table session the same way a first order would.
 */
export const seatWaitlistEntry = async ({ WaitlistEntry, Table, TableSession }, { entryId, tableNo, actor }) => {
  const table = await Table.findOne({ tableNo: Number(tableNo) });
  if (!table) {
    const err = new Error(`Table ${tableNo} not found`);
    err.statusCode = 404;
    throw err;
  }
  if (table.status !== "Active") {
    const err = new Error(`Table ${tableNo} is inactive`);
    err.statusCode = 400;
    throw err;
  }
  if (table.occupancyStatus === "OCCUPIED") {
    const err = new Error(`Table ${tableNo} is already occupied`);
    err.statusCode = 400;
    err.code = "TABLE_OCCUPIED";
    throw err;
  }

  const entry = await WaitlistEntry.findOneAndUpdate(
    { _id: entryId, status: { $in: ACTIVE_STATUSES } },
    { $set: { status: "SEATED", tableNo: table.tableNo, seatedAt: new Date() } },
    { new: true }
  );
  if (!entry) {
    const err = new Error("Waitlist entry not found or already seated/cancelled");
    err.statusCode = 404;
    throw err;
  }

  const session = await findOrOpenTableSession({ TableSession, Table, table, actor });
  return { entry, session };
};

export const cancelWaitlistEntry = async ({ WaitlistEntry }, entryId) => {
  const entry = await WaitlistEntry.findOneAndUpdate(
    { _id: entryId, status: { $in: ACTIVE_STATUSES } },
    { $set: { status: "CANCELLED", cancelledAt: new Date() } },
    { new: true }
  );
  if (!entry) {
    const err = new Error("Waitlist entry not found or already seated/cancelled");
    err.statusCode = 404;
    throw err;
  }
  return entry;
};

/**
 * Longest-waiting active entry that fits within `seats` (a party of 2 can
 * take a 4-top; a party of 6 can't take a 4-top). Used to suggest who to
 * seat right after a table is cleared — a suggestion only, never applied
 * automatically.
 */
export const findNextMatch = ({ WaitlistEntry }, seats) =>
  WaitlistEntry.findOne({ status: { $in: ACTIVE_STATUSES }, partySize: { $lte: seats } }).sort({ createdAt: 1 });
