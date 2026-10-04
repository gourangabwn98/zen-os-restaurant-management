// controllers/billingController.js
// BIL-01 / BIL-02 — thin HTTP wrappers over services/billingService.js.
import { settleBills, reopenBill } from "../services/billingService.js";
import { buildActor, getRoleFromUser } from "../services/orderService.js";
import {
  emitPaymentStatusChanged, emitOrderStatusChanged, emitTableCleared, emitTableFreed,
} from "../sockets/socket.js";

const fail = (res, err) => res.status(err.statusCode || 500).json({ message: err.message });

/** Realtime for a settlement: payment/bill change, then any completion + freed table. */
export const emitSettlement = (tenantKey, { changed = [], completions = [] }) => {
  for (const o of changed) emitPaymentStatusChanged(tenantKey, o);
  for (const c of completions) {
    emitOrderStatusChanged(tenantKey, c.order, c.previousStatus);
    if (c.closedTableSession) {
      emitTableCleared(tenantKey, c.closedTableSession);
      if (c.freedTable) emitTableFreed(tenantKey, { tableNo: c.freedTable.tableNo, seats: c.freedTable.seats, suggestedEntry: c.suggestedEntry });
    }
  }
};

// POST /api/admin/orders/settle   { orderIds: [id], paymentMethod?: "Cash"|"Online" }
export const settleOrders = async (req, res) => {
  try {
    const result = await settleBills({
      models: req.models,
      orderIds: req.body?.orderIds,
      paymentMethod: req.body?.paymentMethod,
      actor: buildActor(req.user),
      role: getRoleFromUser(req.user),
    });
    emitSettlement(req.tenantKey, result);
    res.json({
      settled: result.settled,
      alreadySettled: result.alreadySettled,
      rejected: result.rejected,
      completed: result.completions.map((c) => c.order.orderId),
      orders: [...result.changed.map((o) => {
        const done = result.completions.find((c) => String(c.order._id) === String(o._id));
        return done ? done.order : o;
      })],
    });
  } catch (err) { fail(res, err); }
};

// POST /api/admin/orders/:id/reopen-bill   (admin)
export const reopenOrderBill = async (req, res) => {
  try {
    const order = await reopenBill({ models: req.models, orderId: req.params.id, actor: buildActor(req.user) });
    emitPaymentStatusChanged(req.tenantKey, order);
    res.json({ success: true, order });
  } catch (err) { fail(res, err); }
};
