// controllers/combinedBillController.js
// Admin → Orders → table → "Generate Combine Bill" (services/combinedBillService.js).
// Thin HTTP wrappers; admin-only routes in routes/adminRoutes.js.
import {
  previewCombinedBill, printCombinedBill, markSelectedPaid, completeSelected,
} from "../services/combinedBillService.js";
import { buildActor, getRoleFromUser } from "../services/orderService.js";
import { settleBills } from "../services/billingService.js";
import { emitSettlement } from "./billingController.js";
import { canSetPaymentStatus } from "../utils/orderStateMachine.js";
import { emitBillPrint, emitPaymentStatusChanged } from "../sockets/socket.js";

const fail = (res, err) => res.status(err.statusCode || 500).json({ message: err.message });

// POST /api/admin/combined-bill/preview  { tableNo, orderIds }
export const previewCombined = async (req, res) => {
  try { res.json(await previewCombinedBill({ models: req.models, body: req.body || {} })); } catch (err) { fail(res, err); }
};

// POST /api/admin/combined-bill/print  { tableNo, orderIds, requestKey }
export const printCombined = async (req, res) => {
  try {
    const { job, duplicate, rejected, payload } = await printCombinedBill({ models: req.models, body: req.body || {}, actor: buildActor(req.user) });
    if (!duplicate) emitBillPrint(req.tenantKey, { jobId: String(job._id), ...payload });
    res.json({ success: true, jobId: job._id, duplicate, rejected,
      message: duplicate ? "This combined bill was already sent to the printer" : "Combined bill sent to printer" });
  } catch (err) { fail(res, err); }
};

// POST /api/admin/combined-bill/pay  { tableNo, orderIds, paymentMethod }
export const paySelected = async (req, res) => {
  try {
    const { paid, alreadyPaid, rejected, changed } = await markSelectedPaid({
      models: req.models, body: req.body || {}, canPay: canSetPaymentStatus("PAID", getRoleFromUser(req.user)),
    });
    for (const o of changed) emitPaymentStatusChanged(req.tenantKey, o);
    res.json({ paid, alreadyPaid, rejected });
  } catch (err) { fail(res, err); }
};

// POST /api/admin/combined-bill/complete  { tableNo, orderIds, paymentMethod? }
// BIL-01/BIL-02: settles the selected bills (services/billingService.js);
// served orders complete as a result — never by hand.
export const completeSelectedOrders = async (req, res) => {
  try {
    const r = await completeSelected({
      req, body: req.body || {}, settle: settleBills,
      actor: buildActor(req.user), role: getRoleFromUser(req.user),
    });
    emitSettlement(req.tenantKey, r);
    res.json({
      settled: r.settled, alreadySettled: r.alreadySettled, completed: r.completed, rejected: r.rejected,
      // kept for older admin builds that read these names
      alreadyCompleted: r.alreadySettled,
    });
  } catch (err) { fail(res, err); }
};
