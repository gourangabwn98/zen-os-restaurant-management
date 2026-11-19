// controllers/deliveryController.js
// Thin HTTP wrappers over services/deliveryService.js: call the service, then
// publish its realtime effects (only after the write committed), and map errors
// to `err.statusCode || 500`.

import * as svc from "../services/deliveryService.js";
import { publishDeliveryEffects } from "../services/deliveryRealtime.js";
import { parseSettingsPatch } from "../utils/delivery.js";
import { resolveTimezone } from "../utils/menuSchedule.js";
import { emitSettlement } from "./billingController.js";

const handle = (fn) => async (req, res) => {
  try {
    const out = await fn(req);
    const { effects, ...body } = out || {};
    if (effects?.length) publishDeliveryEffects(req.tenantKey, effects, { models: req.models });
    res.json(body);
  } catch (err) {
    const status = err.statusCode || 500;
    if (status >= 500) console.error("delivery:", err);
    res.status(status).json({
      message: status >= 500 ? "Something went wrong — please try again" : err.message,
      ...(typeof err.code === "string" && { code: err.code }),
      ...(err.details && { details: err.details }),
    });
  }
};

const tzOf = async (req) => resolveTimezone((await req.models.RestaurantProfile.findOne().select("timezone").lean())?.timezone);
const base = (req) => ({ models: req.models, db: req.db });

// ── Rider (role delivery) ────────────────────────────────────────────────────
export const me          = handle((req) => svc.getRiderSnapshot({ ...base(req), user: req.user }));
export const setOnline   = handle((req) => {
  if (typeof req.body?.online !== "boolean") throw Object.assign(new Error("online must be true or false"), { statusCode: 400 });
  return svc.setOnline({ ...base(req), user: req.user, online: req.body.online });
});
export const heartbeat   = handle((req) => svc.heartbeat({ ...base(req), user: req.user }));
export const addToken    = handle((req) => svc.registerPushToken({ ...base(req), user: req.user, token: req.body?.token }));
export const removeToken = handle((req) => svc.removePushToken({ ...base(req), user: req.user, token: req.body?.token }));
export const locations   = handle((req) => svc.recordLocations({ ...base(req), user: req.user, points: req.body?.points }));
export const offers      = handle(async (req) => ({ offers: await svc.listOpenOffers({ ...base(req), user: req.user }) }));
export const accept      = handle((req) => svc.acceptOffer({ ...base(req), user: req.user, jobId: req.params.jobId }));
export const reject      = handle((req) => svc.rejectOffer({ ...base(req), user: req.user, jobId: req.params.jobId }));
export const myJob       = handle(async (req) => ({ job: await svc.getRiderJob({ ...base(req), user: req.user, jobId: req.params.jobId }) }));

const STEP = { "arrived-restaurant": "AT_RESTAURANT", "picked-up": "PICKED_UP", "arrived-customer": "AT_CUSTOMER", deliver: "DELIVERED", fail: "FAILED" };
export const step = handle((req) => {
  const to = STEP[req.params.step];
  if (!to) throw Object.assign(new Error("Unknown step"), { statusCode: 404 });
  return svc.advanceJob({
    ...base(req), user: req.user, jobId: req.params.jobId, to,
    otp: req.body?.otp, reason: req.body?.reason, cashCollected: req.body?.cashCollected, cashAmount: req.body?.cashAmount,
  });
});

export const myHistory = handle(async (req) => ({
  jobs: await svc.riderHistory({ ...base(req), user: req.user, tz: await tzOf(req), from: req.query.from, to: req.query.to, limit: req.query.limit }),
}));
export const myRoute = handle(async (req) => {
  const { planRiderRoute } = await import("../services/routeService.js");
  return planRiderRoute({ models: req.models, user: req.user, origin: req.body?.origin });
});
export const myCash = handle((req) => svc.riderCash({ ...base(req), user: req.user }));
export const mySummary = handle(async (req) => svc.riderSummary({ ...base(req), user: req.user, tz: await tzOf(req), from: req.query.from, to: req.query.to }));

// ── Customer ─────────────────────────────────────────────────────────────────
export const customerOrderDelivery = handle((req) => svc.getCustomerDelivery({ ...base(req), user: req.user, orderId: req.params.orderId }));
export const track = handle((req) => svc.getTrackingByToken({ ...base(req), token: req.params.token }));

// ── Admin / manager ──────────────────────────────────────────────────────────
export const overview    = handle((req) => svc.overview(base(req)));
export const jobs        = handle(async (req) => ({ jobs: await svc.listJobs({ ...base(req), status: req.query.status, escalated: req.query.escalated, limit: req.query.limit }) }));
export const jobEvents   = handle(async (req) => ({ events: await svc.getJobEvents({ ...base(req), jobId: req.params.jobId }) }));
export const partners    = handle(async (req) => ({ partners: await svc.listPartners(base(req)) }));
export const updatePartner = handle((req) => svc.updatePartner({
  ...base(req), admin: req.user, partnerId: req.params.partnerId,
  capacity: req.body?.capacity, suspended: req.body?.suspended, reason: req.body?.reason,
}));
export const forceOffline = handle((req) => svc.forceOffline({ ...base(req), admin: req.user, partnerId: req.params.partnerId }));
export const assign      = handle((req) => svc.adminAssign({ ...base(req), admin: req.user, jobId: req.params.jobId, partnerId: req.body?.partnerId }));
export const unassign    = handle((req) => svc.adminUnassign({ ...base(req), admin: req.user, jobId: req.params.jobId, reason: req.body?.reason }));
export const rebroadcast = handle((req) => svc.adminRebroadcast({ ...base(req), jobId: req.params.jobId }));
export const cancelJob   = handle((req) => svc.cancelJob({ ...base(req), jobId: req.params.jobId, reason: req.body?.reason || "Cancelled by admin", actor: svc.adminActor(req.user) }));
export const resetOtp    = handle((req) => svc.adminResetOtp({ ...base(req), admin: req.user, jobId: req.params.jobId }));
export const revokeTracking = handle((req) => svc.adminRevokeTracking({ ...base(req), admin: req.user, jobId: req.params.jobId }));
export const live        = handle((req) => svc.liveMap(base(req)));
export const reports     = handle((req) => svc.reports({ ...base(req), from: req.query.from, to: req.query.to, groupBy: req.query.groupBy }));
export const getSettings = handle((req) => svc.getSettings(base(req)));
export const updateSettings = handle(async (req) => {
  const { payment, ...patch } = parseSettingsPatch(req.body);
  const $set = Object.fromEntries(Object.entries(patch).map(([k, v]) => [`delivery.${k}`, v]));
  // One key at a time, so enabling Online never resets COD (and vice versa).
  for (const [k, v] of Object.entries(payment || {})) $set[`delivery.payment.${k}`] = v;
  if (Object.keys($set).length) await req.models.RestaurantProfile.updateOne({}, { $set });
  return svc.getSettings(base(req));
});

// ── Cash on Delivery (admin / manager) ───────────────────────────────────────
export const codList = handle((req) => svc.listCodCollections({ ...base(req), status: req.query.status, partnerId: req.query.partnerId, limit: req.query.limit }));
export const codVerify = handle(async (req) => {
  const out = await svc.verifyCodCollection({ ...base(req), admin: req.user, collectionId: req.params.collectionId, note: req.body?.note });
  emitSettlement(req.tenantKey, out.settle); // same realtime as Invoices → Settle
  const { settle, ...rest } = out;
  return { ...rest, settled: settle.settled, alreadySettled: settle.alreadySettled, completed: settle.completions.map((c) => c.order.orderId) };
});
export const codDispute = handle((req) => svc.disputeCodCollection({ ...base(req), admin: req.user, collectionId: req.params.collectionId, reason: req.body?.reason }));
