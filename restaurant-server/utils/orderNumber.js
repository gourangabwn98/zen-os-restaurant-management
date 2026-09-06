// utils/orderNumber.js
// ─────────────────────────────────────────────────────────────────────────────
// Order-number generation.
//
// THE BUG THIS REPLACES: the old approach was a pre('save') hook doing
//   this.orderId = `ORD${String((await countDocuments()) + 1).padStart(5,"0")}`
// which is a classic non-atomic "read count, then write count+1". Two orders
// placed in the same instant both read the same count and generated the SAME
// orderId. That then collided on the `orderId` unique index, and — because
// placeOrderTx only special-cased an `idempotencyKey` duplicate-key error —
// the collision surfaced as a raw "E11000 duplicate key" 500, or (when a
// keyless order also hit the idempotencyKey path) as a *false success* that
// returned a stale order. Net effect the user saw: the same `ORD00001`
// coming back over and over while nothing new was ever persisted.
//
// The fix is the same "atomic conditional update, never check-then-write"
// pattern the rest of this codebase uses for idempotency (see CLAUDE.md
// rule 5): a single counter document incremented with `$inc` inside one
// findOneAndUpdate. Concurrent callers are serialised by the database and
// each gets a distinct number.
// ─────────────────────────────────────────────────────────────────────────────

export const ORDER_NUMBER_KEY = "orderId";

/** Pure: sequence number → canonical order id. Exported for tests. */
export const formatOrderId = (seq) => `ORD${String(seq).padStart(5, "0")}`;

/**
 * Atomically reserves and returns the next order id, e.g. "ORD00042".
 *
 * Seeds the counter from the current order count the first time it runs so
 * existing numbering continues uninterrupted (no reset, no re-use of a number
 * a legacy order already holds).
 *
 * Gaps are acceptable: if the order that reserved a number is later rolled
 * back (e.g. a staff order whose inventory transaction aborts) the number is
 * simply skipped. Uniqueness — never a collision — is the property that
 * matters.
 *
 * @param {{ Counter: import("mongoose").Model, Order: import("mongoose").Model }}
 */
export const nextOrderId = async ({ Counter, Order }) => {
  const existing = await Counter.findById(ORDER_NUMBER_KEY).lean();
  if (!existing) {
    // First run on this database — start the counter above whatever orders
    // already exist. $setOnInsert makes this a no-op on every later call and
    // safe under a race (either upsert wins with the same seed value).
    const seed = await Order.estimatedDocumentCount();
    await Counter.updateOne(
      { _id: ORDER_NUMBER_KEY },
      { $setOnInsert: { seq: seed } },
      { upsert: true },
    );
  }

  const updated = await Counter.findOneAndUpdate(
    { _id: ORDER_NUMBER_KEY },
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  );

  return formatOrderId(updated.seq);
};
