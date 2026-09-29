// controllers/waiterCallController.js
// Thin HTTP layer over services/waiterCallService.js ("Call waiter").
import {
  assertCanCallForOrder, getCallState, createCall, cancelCall,
  acknowledgeCall, resolveCall, listCallsForWaiter, toStaffCall,
} from "../services/waiterCallService.js";
import { getRoleFromUser, buildActor } from "../services/orderService.js";
import { emitWaiterCall } from "../sockets/socket.js";

const fail = (res, err) =>
  res.status(err.statusCode || 500).json({ message: err.message, ...(err.code ? { code: err.code } : {}), ...(err.adminPhone ? { adminPhone: err.adminPhone } : {}) });

const adminPhoneOf = async (models) =>
  (await models.RestaurantProfile.findOne().select("phone").lean())?.phone || "";

/** Loads the order and checks the caller owns it (strict — see service). */
const loadOwnedOrder = async (req, orderId) => {
  const order = await req.models.Order.findById(orderId);
  if (!order) throw Object.assign(new Error("Order not found"), { statusCode: 404 });
  assertCanCallForOrder(req, order, getRoleFromUser(req.user));
  return order;
};

/** After a staff action: update every rung waiter + the customer's page. */
const broadcast = async (req, call, event = "waiter_call:updated") => {
  const order = await req.models.Order.findById(call.order).select("_id");
  const customerState = order
    ? await getCallState({ models: req.models, order, adminPhone: await adminPhoneOf(req.models) })
    : null;
  emitWaiterCall(req.tenantKey, {
    event, staffCall: toStaffCall(call), userIds: call.targets || [], orderId: call.order, customerState,
  });
};

// ── GET /api/waiter-calls/order/:orderId  (customer / guest) ────────────────
export const getOrderCallState = async (req, res) => {
  try {
    const order = await loadOwnedOrder(req, req.params.orderId);
    res.json(await getCallState({ models: req.models, order, adminPhone: await adminPhoneOf(req.models) }));
  } catch (err) { fail(res, err); }
};

// ── POST /api/waiter-calls  { orderId }  (customer / guest) ─────────────────
export const callWaiter = async (req, res) => {
  try {
    const order = await loadOwnedOrder(req, req.body?.orderId);
    const adminPhone = await adminPhoneOf(req.models);
    const { call, created, targets, state } = await createCall({ models: req.models, order, adminPhone });
    if (created) {
      emitWaiterCall(req.tenantKey, {
        event: "waiter_call:new", staffCall: toStaffCall(call), userIds: targets, orderId: order._id, customerState: state,
      });
    }
    res.status(created ? 201 : 200).json(state);
  } catch (err) { fail(res, err); }
};

// ── DELETE /api/waiter-calls/order/:orderId  (customer withdraws) ───────────
export const withdrawCall = async (req, res) => {
  try {
    const order = await loadOwnedOrder(req, req.params.orderId);
    const call = await cancelCall({ models: req.models, order });
    if (call) await broadcast(req, call);
    res.json(await getCallState({ models: req.models, order, adminPhone: await adminPhoneOf(req.models) }));
  } catch (err) { fail(res, err); }
};

// ── GET /api/waiter-calls/mine  (waiter app) ────────────────────────────────
export const myCalls = async (req, res) => {
  try {
    res.json({ calls: await listCallsForWaiter({ models: req.models, userId: req.user._id }) });
  } catch (err) { fail(res, err); }
};

// ── PATCH /api/waiter-calls/:id/ack  ("On my way") ──────────────────────────
export const acknowledge = async (req, res) => {
  try {
    const call = await acknowledgeCall({ models: req.models, callId: req.params.id, actor: buildActor(req.user) });
    await broadcast(req, call);
    res.json({ call: toStaffCall(call) });
  } catch (err) { fail(res, err); }
};

// ── PATCH /api/waiter-calls/:id/resolve  ("Done") ───────────────────────────
export const resolve = async (req, res) => {
  try {
    const call = await resolveCall({ models: req.models, callId: req.params.id, actor: buildActor(req.user) });
    await broadcast(req, call);
    res.json({ call: toStaffCall(call) });
  } catch (err) { fail(res, err); }
};
