// controllers/kitchenController.js
import { transitionOrderStatusTx } from "../services/orderService.js";
import { emitOrderStatusChanged } from "../sockets/socket.js";

const ACTIVE_STATUSES = ["CONFIRMED", "PREPARING", "READY"];

// Deliberately reduced field set — a chef never needs (and per RBAC must
// never receive) customer PII, price, or payment information. This is why
// the Kitchen app uses this endpoint instead of the general admin orders
// list, not just a role check on the same data.
const toKitchenTicket = (order) => ({
  _id: order._id,
  orderId: order.orderId,
  tableNo: order.tableNo,
  orderType: order.orderType,
  status: order.status,
  priority: order.priority,
  waiterName: order.waiterName || "",
  items: (order.items || []).map((i) => ({ name: i.name, qty: i.qty, notes: i.notes || "" })),
  notes: order.notes || "",
  createdAt: order.createdAt,
  preparingAt: order.preparingAt,
  readyAt: order.readyAt,
});

// ── GET /api/kitchen/orders ─────────────────────────────────────────────────
export const getKitchenOrders = async (req, res) => {
  try {
    const { Order } = req.models;
    const orders = await Order.find({ status: { $in: ACTIVE_STATUSES } })
      .sort({ createdAt: 1 })
      .select("orderId tableNo orderType status priority waiterName items notes createdAt preparingAt readyAt");
    res.json({ orders: orders.map(toKitchenTicket) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── PATCH /api/kitchen/orders/:id/status ────────────────────────────────────
// Chef may only drive CONFIRMED->PREPARING and PREPARING->READY — enforced
// again here (not just by the route's RBAC gate) so this endpoint can never
// be used to sneak an order to DELIVERED/COMPLETED/CANCELLED even by a
// scripting mistake, on top of the state machine's own role check.
const KITCHEN_ALLOWED_TARGETS = ["PREPARING", "READY"];

export const updateKitchenOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!KITCHEN_ALLOWED_TARGETS.includes(status)) {
      return res.status(400).json({ message: `Kitchen can only set status to ${KITCHEN_ALLOWED_TARGETS.join(" or ")}` });
    }

    const previousStatus = (await req.models.Order.findById(req.params.id).select("status"))?.status;
    const { order } = await transitionOrderStatusTx({ req, orderId: req.params.id, toStatus: status });

    emitOrderStatusChanged(req.tenantKey, order, previousStatus);
    res.json({ order: toKitchenTicket(order) });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};
