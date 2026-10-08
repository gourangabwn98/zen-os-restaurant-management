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

import { ORDER_SOURCES } from "../utils/orderStateMachine.js";

const SOURCE_CUSTOMER = ORDER_SOURCES.find((s) => s === "CUSTOMER");
if (!SOURCE_CUSTOMER) throw new Error("kotService: ORDER_SOURCES has no CUSTOMER");
const KOT_NAME_MAX = 100; // sanity cap only — the KOT layout wraps long names

/**
 * KH-08 — the CUSTOMER's name for the paper KOT, or "" (line left out).
 * Same rule as the admin app's customerName(): the typed guest name, else —
 * only on a customer-placed order — the account name. On a staff-placed
 * order the account is the waiter, never the customer.
 * @param accountName  name of order.user (caller looks it up), or ""
 */
export const kotCustomerName = (order, accountName = "") => {
  const placedByCustomer = !order?.source || order.source === SOURCE_CUSTOMER;
  const name = String(order?.guestName || (placedByCustomer ? accountName : "") || "").replace(/\s+/g, " ").trim();
  return name.slice(0, KOT_NAME_MAX);
};

/**
 * KH-08 — a KOT job as the Kitchen app may see it: without the customer's
 * name. The name is for the paper ticket only (printers room / print queue);
 * the kitchen room is PII-stripped by design (CLAUDE.md → Socket.IO rooms).
 */
export const kitchenSafeKot = (kotJob) => {
  if (!kotJob) return kotJob;
  const plain = typeof kotJob.toObject === "function" ? kotJob.toObject() : { ...kotJob };
  delete plain.customerName;
  return plain;
};

export const createKotJobForOrder = async ({ KOTJob, order, actor, session, customerName = "" }) => {
  try {
    const created = await KOTJob.create(
      [
        {
          order:     order._id,
          orderId:   order.orderId,
          tableNo:   order.tableNo,
          orderType: order.orderType,
          items:     order.items.map((i) => ({
            name: i.name, nameBn: i.nameBn || "", qty: i.qty, notes: i.notes || "",
            ...(i.addons?.length && { addons: i.addons.map((a) => a.name) }), // KH-12 — printed under the item
          })),
          notes:     order.notes || "",
          customerName: String(customerName || "").slice(0, KOT_NAME_MAX), // KH-08 — paper KOT only
          diningArea: order.diningArea || "", // KH-10
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
