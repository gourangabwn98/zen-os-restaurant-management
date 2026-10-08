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
import { addonLabel, lineAddonKey } from "../utils/menuAddons.js";

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
            ...(i.addons?.length && { addons: i.addons.map(addonLabel) }), // KH-12 — printed under the item
          })),
          notes:     order.notes || "",
          customerName: String(customerName || "").slice(0, KOT_NAME_MAX), // KH-08 — paper KOT only
          diningArea: order.diningArea || "", // KH-10
          tableName: order.tableName || "",
          tableDisplayNo: order.tableDisplayNo ?? null,
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

// ── KOT change slips (order edited after it reached the kitchen) ─────────────
// Same item + same add-ons + same note = the same line ("Biryani + 2 x
// Chicken, less spicy"); anything else is a different line, so changing a
// note shows as cancel-old / make-new, which is what the cook must do.
const changeKey = (i) => `${String(i.menuItem)}|${lineAddonKey(i.addons)}|${String(i.notes || "").trim()}`;
const slipLine = (i, qty, cancel = false) => ({
  name: cancel ? `${CANCEL_PREFIX}${i.name}` : i.name,
  nameBn: i.nameBn ? (cancel ? `${CANCEL_PREFIX}${i.nameBn}` : i.nameBn) : "",
  qty, notes: i.notes || "",
  ...(i.addons?.length && { addons: i.addons.map(addonLabel) }),
});

export const CANCEL_PREFIX = "CANCEL - ";
export const CHANGE_NOTE = "ORDER CHANGED - only the changes are listed. CANCEL = stop / don't make.";

/**
 * Pure: what the kitchen must do differently. `added` = extra qty to make,
 * `removed` = qty to stop making. Lines are matched by changeKey.
 */
export const diffOrderLines = (beforeItems = [], afterItems = []) => {
  const sum = (items) => {
    const m = new Map();
    for (const i of items) {
      const k = changeKey(i);
      const prev = m.get(k);
      m.set(k, { line: prev?.line || i, qty: (prev?.qty || 0) + (Number(i.qty) || 0) });
    }
    return m;
  };
  const before = sum(beforeItems);
  const after = sum(afterItems);
  const added = [];
  const removed = [];
  for (const [k, a] of after) {
    const d = a.qty - (before.get(k)?.qty || 0);
    if (d > 0) added.push(slipLine(a.line, d));
  }
  for (const [k, b] of before) {
    const d = b.qty - (after.get(k)?.qty || 0);
    if (d > 0) removed.push(slipLine(b.line, d, true));
  }
  return { added, removed };
};

/**
 * The change slip for one edit — the only place a KOTChangeJob is created.
 * Inside the edit's transaction. Nothing changed for the kitchen (e.g. a
 * price-only re-price) → no slip. Unique (order, revision): a retry returns
 * the existing slip instead of printing the change twice.
 * @returns {{ job: object|null, created: boolean }}
 */
export const createKotChangeJob = async ({ KOTChangeJob, before, after, actor, session }) => {
  const { added, removed } = diffOrderLines(before.items, after.items);
  if (!added.length && !removed.length) return { job: null, created: false };
  try {
    const [job] = await KOTChangeJob.create(
      [{
        order: after._id, revision: after.revision,
        orderId: after.orderId, tableNo: after.tableNo, orderType: after.orderType,
        items: [...added, ...removed],
        notes: `${CHANGE_NOTE} Changed by ${actor?.name || "admin"}.`,
        diningArea: after.diningArea || "",
        tableName: after.tableName || "", tableDisplayNo: after.tableDisplayNo ?? null,
        createdBy: actor,
      }],
      { session },
    );
    return { job, created: true };
  } catch (err) {
    if (err?.code === 11000) {
      const job = await KOTChangeJob.findOne({ order: after._id, revision: after.revision }).session(session || null);
      return { job, created: false };
    }
    throw err;
  }
};
