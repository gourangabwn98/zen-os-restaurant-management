// services/staffReportService.js
// ─────────────────────────────────────────────────────────────────────────────
// Staff performance & payment collections (Admin/Manager: Employees →
// "Staff performance & collections"; Waiter: Activity tab, own figures only).
//
// Each activity is credited to the person the ORDER ITSELF records for it,
// written server-side from the authenticated user (orderService.buildActor) —
// never to whoever took the order, never to an id sent by a client:
//   taken      confirmedBy / confirmedAt — a staff order is confirmed by the
//              person who places it; a customer order by the waiter/admin who
//              accepts it (orderService.placeOrderTx / confirmOrderTx)
//   served     deliveredBy / deliveredAt — whoever tapped "Served"
//   completed  completedBy / completedAt — whoever's action completed it
//   collected  paidBy / paidAt — whoever recorded the Paid (admin PATCH,
//              billing settle, combined-bill pay). Written only in the atomic
//              unpaid → PAID update, so retries can't double-count it.
//
// Collections follow the revenue rule (insightsService.revenueOrderMatch):
// PAID and not CANCELLED. Cash / Online come from paymentMethod; a "Both"
// order adds its paymentSplit.cash to Cash and .online to Online.
//
// Nothing is guessed. An action with no employee on it (system timer, a
// customer, an order from before these fields existed) lands in an
// "Unattributed" row; a verified PhonePe payment (paidBy null, paidAt set)
// in an "Online gateway" row. Orders paid before paidAt existed have no
// payment time, so they are placed by their order date (createdAt) and are
// always Unattributed — never credited to the person who took them.
// ─────────────────────────────────────────────────────────────────────────────
import { ORDER_STATUSES, PAYMENT_STATUSES } from "../utils/orderStateMachine.js";
import { PAYMENT_METHODS, SPLIT_METHOD } from "../utils/paymentMode.js";
import { roundMoney } from "../utils/recipeCost.js";

const pick = (list, v) => { if (!list.includes(v)) throw new Error(`staffReportService: unknown enum ${v}`); return v; };
const PAID = pick(PAYMENT_STATUSES, "PAID");
const CANCELLED = pick(ORDER_STATUSES, "CANCELLED");
const CASH = pick(PAYMENT_METHODS, "Cash");
const ONLINE = pick(PAYMENT_METHODS, "Online");

export const ROW_KINDS = { EMPLOYEE: "EMPLOYEE", GATEWAY: "GATEWAY", UNATTRIBUTED: "UNATTRIBUTED" };
const UNATTRIBUTED_KEY = "unattributed";
const GATEWAY_KEY = "gateway";
// Actor roles that are a person on staff (getModels actorSchema). CUSTOMER /
// GUEST / null (system) are never an employee.
const NON_EMPLOYEE_ACTOR_ROLES = ["CUSTOMER", "GUEST"];
const ACTOR_ROLE_TO_ROLE = { ADMIN: "admin", WAITER: "waiter", CHEF: "chef" };
// Floor roles listed even with no activity, so "₹0" is visible, not missing.
const ALWAYS_LISTED_ROLES = ["manager", "waiter"];
export const MAX_PAYMENT_ROWS = 1000;
export const MAX_RANGE_DAYS = 366;

const ORDER_FIELDS = [
  "orderId", "total", "status", "paymentStatus", "paymentMethod", "paymentSplit",
  "payment.provider", "payment.state", "createdAt",
  "confirmedBy", "confirmedAt", "deliveredBy", "deliveredAt",
  "completedBy", "completedAt", "paidBy", "paidAt",
].join(" ");

const httpError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** The employee an actor sub-doc names, as a string id — or null. */
export const employeeIdOf = (actor) =>
  (actor?.id && !NON_EMPLOYEE_ACTOR_ROLES.includes(actor.role) ? String(actor.id) : null);

/** Pure: one paid order → { cash, online } it brought in. */
export const collectionParts = (order) => {
  const total = num(order.total);
  if (order.paymentMethod === SPLIT_METHOD) {
    return { cash: roundMoney(num(order.paymentSplit?.cash)), online: roundMoney(num(order.paymentSplit?.online)) };
  }
  if (order.paymentMethod === ONLINE) return { cash: 0, online: roundMoney(total) };
  return { cash: roundMoney(total), online: 0 }; // Cash (the schema default)
};

/** Pure: who a paid order's money is credited to → { key, kind, actor }. */
export const collectorOf = (order) => {
  const id = employeeIdOf(order.paidBy);
  if (id) return { key: id, kind: ROW_KINDS.EMPLOYEE, actor: order.paidBy };
  if (order.paidAt && order.payment?.provider === "PHONEPE" && order.payment?.state === "SUCCESS") {
    return { key: GATEWAY_KEY, kind: ROW_KINDS.GATEWAY, actor: null };
  }
  return { key: UNATTRIBUTED_KEY, kind: ROW_KINDS.UNATTRIBUTED, actor: null };
};

/** Pure: does this paid order count as collected money? (revenue rule) */
export const isCollected = (order) => order.paymentStatus === PAID && order.status !== CANCELLED;

const roleOfUser = (u) => (u?.isAdmin ? "admin" : u?.role || null);

/**
 * Pure: the four activity lists (already scoped to the period) + the staff
 * users → { rows, summary, payments, paymentsTruncated }.
 * `users`: [{ _id, name, role, isAdmin, status }] — names/roles shown are the
 * CURRENT account's (a manager is recorded on the order as actor ADMIN, so the
 * account is what tells admin and manager apart); a deleted account falls back
 * to the name/role saved on the order.
 * `listAll`: also list active managers/waiters with no activity (admin view).
 */
export const buildStaffReport = ({ taken = [], served = [], completed = [], collections = [], users = [], listAll = true }) => {
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const rows = new Map();
  const blank = (key, kind, extra) => ({
    key, kind, employeeId: null, name: "", role: null,
    taken: 0, served: 0, completed: 0, collected: 0, cash: 0, online: 0, payments: 0, ...extra,
  });
  const rowFor = (key, kind, actor) => {
    if (!rows.has(key)) {
      if (kind === ROW_KINDS.EMPLOYEE) {
        const u = userById.get(key);
        rows.set(key, blank(key, kind, {
          employeeId: key,
          name: u?.name || actor?.name || "",
          role: roleOfUser(u) || ACTOR_ROLE_TO_ROLE[actor?.role] || null,
        }));
      } else {
        rows.set(key, blank(key, kind, { name: kind === ROW_KINDS.GATEWAY ? "Online gateway (PhonePe)" : "Unattributed" }));
      }
    }
    return rows.get(key);
  };
  const credit = (actor) => {
    const id = employeeIdOf(actor);
    return id ? rowFor(id, ROW_KINDS.EMPLOYEE, actor) : rowFor(UNATTRIBUTED_KEY, ROW_KINDS.UNATTRIBUTED, null);
  };

  if (listAll) {
    for (const u of users) {
      if (ALWAYS_LISTED_ROLES.includes(roleOfUser(u)) && u.status !== "Inactive") rowFor(String(u._id), ROW_KINDS.EMPLOYEE, null);
    }
  }

  // An order appears at most once per list (one confirmedBy, one deliveredBy…),
  // but de-duplicate by _id anyway so a caller merging queries can't double-count.
  const once = (list) => [...new Map(list.map((o) => [String(o._id), o])).values()];
  for (const o of once(taken)) credit(o.confirmedBy).taken += 1;
  for (const o of once(served)) credit(o.deliveredBy).served += 1;
  for (const o of once(completed)) credit(o.completedBy).completed += 1;

  const payments = [];
  for (const o of once(collections)) {
    if (!isCollected(o)) continue; // pending / failed / cancelled never count
    const who = collectorOf(o);
    const row = rowFor(who.key, who.kind, who.actor);
    const { cash, online } = collectionParts(o);
    row.cash += cash; row.online += online; row.payments += 1;
    payments.push({
      _id: o._id, orderId: o.orderId,
      at: o.paidAt || o.createdAt, legacy: !o.paidAt, // legacy: paid before payment times were recorded
      collector: { kind: row.kind, employeeId: row.employeeId, name: row.name, role: row.role },
      method: o.paymentMethod || CASH, cash, online, amount: roundMoney(cash + online),
      paymentStatus: o.paymentStatus,
    });
  }

  const KIND_RANK = { [ROW_KINDS.EMPLOYEE]: 0, [ROW_KINDS.GATEWAY]: 1, [ROW_KINDS.UNATTRIBUTED]: 2 };
  const list = [...rows.values()].map((r) => {
    r.cash = roundMoney(r.cash); r.online = roundMoney(r.online);
    r.collected = roundMoney(r.cash + r.online);
    return r;
  }).filter((r) => r.kind === ROW_KINDS.EMPLOYEE || r.taken || r.served || r.completed || r.payments)
    .sort((a, b) => (KIND_RANK[a.kind] - KIND_RANK[b.kind]) || (b.collected - a.collected)
      || (b.taken - a.taken) || a.name.localeCompare(b.name));

  const summary = list.reduce((s, r) => {
    s.taken += r.taken; s.served += r.served; s.completed += r.completed;
    s.cash += r.cash; s.online += r.online; s.payments += r.payments;
    return s;
  }, { taken: 0, served: 0, completed: 0, collected: 0, cash: 0, online: 0, payments: 0 });
  summary.cash = roundMoney(summary.cash); summary.online = roundMoney(summary.online);
  summary.collected = roundMoney(summary.cash + summary.online);

  payments.sort((a, b) => new Date(b.at) - new Date(a.at));
  return {
    rows: list, summary,
    payments: payments.slice(0, MAX_PAYMENT_ROWS),
    paymentsTruncated: payments.length > MAX_PAYMENT_ROWS,
  };
};

/**
 * The orders behind a report for [start, end] — one indexed query per
 * activity. With `employeeId`, only that person's own actions (a waiter's
 * own dashboard): the id is matched with $eq, and legacy unattributed
 * payments are never fetched (they belong to nobody).
 */
export const fetchStaffActivity = async ({ Order, start, end, employeeId = null }) => {
  const range = { $gte: start, $lte: end };
  const own = (field) => (employeeId ? { [`${field}.id`]: { $eq: employeeId } } : {});
  const q = (filter) => Order.find(filter).select(ORDER_FIELDS).lean();
  const paid = { paymentStatus: PAID, status: { $ne: CANCELLED } };
  const [taken, served, completed, collected, legacy] = await Promise.all([
    q({ confirmedAt: range, ...own("confirmedBy") }),
    q({ deliveredAt: range, ...own("deliveredBy") }),
    q({ completedAt: range, ...own("completedBy") }),
    q({ ...paid, paidAt: range, ...own("paidBy") }),
    employeeId ? [] : q({ ...paid, paidAt: null, createdAt: range }),
  ]);
  return { taken, served, completed, collections: [...collected, ...legacy] };
};

/** Refuses a backwards or over-long period (start/end from employeeService.resolveRange). */
export const assertReportRange = ({ start, end }) => {
  if (!(start instanceof Date) || !(end instanceof Date) || Number.isNaN(+start) || Number.isNaN(+end)) {
    throw httpError("Choose a valid date range");
  }
  if (start > end) throw httpError("The start date must be on or before the end date");
  if (end - start > MAX_RANGE_DAYS * 24 * 3600 * 1000) throw httpError(`Choose at most ${MAX_RANGE_DAYS} days`);
};

/** Admin / manager: everyone's figures for the period. */
export const getStaffReport = async ({ models, start, end }) => {
  assertReportRange({ start, end });
  const { Order, User } = models;
  const activity = await fetchStaffActivity({ Order, start, end });
  const ids = new Set();
  for (const list of Object.values(activity)) {
    for (const o of list) {
      for (const a of [o.confirmedBy, o.deliveredBy, o.completedBy, o.paidBy]) {
        const id = employeeIdOf(a);
        if (id) ids.add(id);
      }
    }
  }
  const users = await User.find({
    $or: [{ _id: { $in: [...ids] } }, { role: { $in: ALWAYS_LISTED_ROLES }, status: { $ne: "Inactive" } }],
  }).select("name role isAdmin status").lean();
  return { range: { from: start, to: end }, ...buildStaffReport({ ...activity, users, listAll: true }) };
};

/** One employee's own figures — `employeeId` is ALWAYS req.user._id. */
export const getMyStaffStats = async ({ models, employeeId, start, end }) => {
  assertReportRange({ start, end });
  const activity = await fetchStaffActivity({ Order: models.Order, start, end, employeeId });
  const { rows } = buildStaffReport({ ...activity, users: [], listAll: false });
  const mine = rows.find((r) => r.employeeId === String(employeeId)) || {};
  return {
    taken: mine.taken || 0, served: mine.served || 0, completed: mine.completed || 0,
    collected: mine.collected || 0, cash: mine.cash || 0, online: mine.online || 0, payments: mine.payments || 0,
  };
};
