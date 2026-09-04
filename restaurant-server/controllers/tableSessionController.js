// controllers/tableSessionController.js
import { getOpenSessionForTable, closeTableSession, listOpenSessions } from "../services/tableSessionService.js";
import { buildActor } from "../services/orderService.js";
import { emitTableCleared } from "../sockets/socket.js";

// ── GET /api/admin/table-sessions ─────────────────────────────────────────
// All currently-open sessions at once — powers the Tables board (which
// tables are occupied, and what orders are tied to each) without an N+1
// per-table lookup.
export const getAllOpenSessions = async (req, res) => {
  try {
    const { TableSession } = req.models;
    const sessions = await listOpenSessions({ TableSession });
    res.json({ sessions });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

// ── GET /api/admin/table-sessions/:tableNo ────────────────────────────────
export const getTableSession = async (req, res) => {
  try {
    const { TableSession } = req.models;
    const session = await getOpenSessionForTable({ TableSession, tableNo: req.params.tableNo });
    if (!session) return res.status(404).json({ message: `No open session for table ${req.params.tableNo}` });
    res.json({ session });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

// ── POST /api/admin/table-sessions/:id/close ──────────────────────────────
// "Clear table" — allowed only when the backend confirms every order tied
// to the session has reached a terminal state (see tableSessionService).
export const closeSession = async (req, res) => {
  try {
    const { TableSession, Order, Table } = req.models;
    const actor = buildActor(req.user);
    const session = await closeTableSession({ TableSession, Order, Table, sessionId: req.params.id, actor });
    emitTableCleared(req.tenantKey, session);
    res.json({ message: "Table cleared", session });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message, code: err.code });
  }
};
