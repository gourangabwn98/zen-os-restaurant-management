// services/kotService.js
// ─────────────────────────────────────────────────────────────────────────────
// Creates the kitchen-order-ticket job for an order. This is deliberately the
// ONLY place that ever creates a KOTJob document.
//
// Idempotency: KOTJob.order has a `unique` index (see config/getModels.js).
// If a second attempt to create a job for the same order happens — e.g. two
// admins tap "confirm" within milliseconds of each other — Mongo rejects the
// second insert with a duplicate-key error (11000), which we catch here and
// treat as success by returning the job that already exists. The caller can
// tell the two cases apart via `created`.
// ─────────────────────────────────────────────────────────────────────────────

export const createKotJobForOrder = async ({ KOTJob, order, actor, session }) => {
  try {
    const created = await KOTJob.create(
      [
        {
          order:     order._id,
          orderId:   order.orderId,
          tableNo:   order.tableNo,
          orderType: order.orderType,
          items:     order.items.map((i) => ({ name: i.name, qty: i.qty, notes: i.notes || "" })),
          priority:  order.priority === "URGENT" ? "URGENT" : "NORMAL",
          status:    "PENDING",
          createdBy: actor,
        },
      ],
      { session }
    );
    return { created: true, job: created[0] };
  } catch (err) {
    if (err?.code === 11000) {
      const existing = await KOTJob.findOne({ order: order._id }).session(session || null);
      return { created: false, job: existing };
    }
    throw err;
  }
};
