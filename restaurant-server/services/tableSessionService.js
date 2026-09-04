// services/tableSessionService.js
// ─────────────────────────────────────────────────────────────────────────────
// A "table session" groups every order placed at a table during one seating,
// from the first order until the table is closed out ("cleared"). This is
// the backbone for combined billing and the table occupancy indicator.
//
// Idempotency: TableSession has a partial unique index on
// { tableNo, status: "OPEN" } (see config/getModels.js), so at most one OPEN
// session can ever exist per table — concurrent "first order at this table"
// requests race safely; the loser just fetches the session the winner made.
//
// Occupancy: Table.occupancyStatus is driven ONLY from here (open → OCCUPIED,
// close → AVAILABLE) — never set directly by a client — so it can never
// drift from what sessions/orders actually exist.
// ─────────────────────────────────────────────────────────────────────────────

const NON_TERMINAL_STATUSES = [
  "PENDING_CONFIRMATION", "CONFIRMED", "PREPARING", "READY", "DELIVERED",
];

export const findOrOpenTableSession = async ({ TableSession, Table, table, actor }) => {
  const existing = await TableSession.findOne({ tableNo: table.tableNo, status: "OPEN" });
  if (existing) return existing;

  try {
    const session = await TableSession.create({
      table: table._id,
      tableNo: table.tableNo,
      status: "OPEN",
      openedBy: actor,
      orders: [],
    });
    if (Table) {
      await Table.updateOne({ _id: table._id }, { $set: { occupancyStatus: "OCCUPIED" } });
    }
    return session;
  } catch (err) {
    if (err?.code === 11000) {
      // Race: another request opened it a moment ago — use that one.
      const raced = await TableSession.findOne({ tableNo: table.tableNo, status: "OPEN" });
      if (raced) return raced;
    }
    throw err;
  }
};

/**
 * "Clear table". Only allowed once every order tied to this session has
 * reached a terminal state (COMPLETED or CANCELLED) — a waiter cannot clear
 * a table out from under an order that's still pending/preparing/etc. This
 * is enforced here, server-side, regardless of what any client believes the
 * order states to be.
 */
export const closeTableSession = async ({ TableSession, Order, Table, sessionId, actor }) => {
  const session = await TableSession.findById(sessionId);
  if (!session) {
    const err = new Error("Table session not found");
    err.statusCode = 404;
    throw err;
  }
  if (session.status === "CLOSED") {
    const err = new Error("Table session is already closed");
    err.statusCode = 400;
    throw err;
  }

  const activeCount = await Order.countDocuments({
    _id: { $in: session.orders },
    status: { $in: NON_TERMINAL_STATUSES },
  });
  if (activeCount > 0) {
    const err = new Error(
      `Cannot clear table — ${activeCount} order(s) are still active. Complete or cancel them first.`
    );
    err.statusCode = 400;
    err.code = "TABLE_HAS_ACTIVE_ORDERS";
    throw err;
  }

  session.status   = "CLOSED";
  session.closedAt = new Date();
  session.closedBy = actor;
  await session.save();

  if (Table && session.table) {
    await Table.updateOne({ _id: session.table }, { $set: { occupancyStatus: "AVAILABLE" } });
  }

  return session;
};

export const getOpenSessionForTable = ({ TableSession, tableNo }) =>
  TableSession.findOne({ tableNo: Number(tableNo), status: "OPEN" }).populate("orders");

export const listOpenSessions = ({ TableSession }) =>
  TableSession.find({ status: "OPEN" }).populate("orders").sort({ openedAt: -1 });
