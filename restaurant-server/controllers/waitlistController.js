// controllers/waitlistController.js
import {
  addToWaitlist, listWaitlist, markNotified, seatWaitlistEntry, cancelWaitlistEntry,
} from "../services/waitlistService.js";
import { buildActor } from "../services/orderService.js";
import { emitWaitlistUpdated } from "../sockets/socket.js";

// ── GET /api/admin/waitlist?status=WAITING ────────────────────────────────
export const getWaitlist = async (req, res) => {
  try {
    const { WaitlistEntry } = req.models;
    const entries = await listWaitlist({ WaitlistEntry }, { status: req.query.status });
    res.json({ entries });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

// ── POST /api/admin/waitlist ───────────────────────────────────────────────
export const createWaitlistEntry = async (req, res) => {
  try {
    const { WaitlistEntry } = req.models;
    const { guestName, guestPhone, partySize, notes } = req.body;
    const actor = buildActor(req.user);
    const entry = await addToWaitlist({ WaitlistEntry }, { guestName, guestPhone, partySize, notes, actor });
    emitWaitlistUpdated(req.tenantKey, entry);
    res.status(201).json({ entry });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

// ── POST /api/admin/waitlist/:id/notify ───────────────────────────────────
export const notifyWaitlistEntry = async (req, res) => {
  try {
    const { WaitlistEntry } = req.models;
    const entry = await markNotified({ WaitlistEntry }, req.params.id);
    emitWaitlistUpdated(req.tenantKey, entry);
    res.json({ entry });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

// ── POST /api/admin/waitlist/:id/seat  { tableNo } ────────────────────────
export const seatWaitlistEntryHandler = async (req, res) => {
  try {
    const { WaitlistEntry, Table, TableSession } = req.models;
    const { tableNo } = req.body;
    if (!tableNo) return res.status(400).json({ message: "tableNo is required" });
    const actor = buildActor(req.user);
    const { entry, session } = await seatWaitlistEntry(
      { WaitlistEntry, Table, TableSession },
      { entryId: req.params.id, tableNo, actor }
    );
    emitWaitlistUpdated(req.tenantKey, entry);
    res.json({ entry, session });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message, code: err.code });
  }
};

// ── POST /api/admin/waitlist/:id/cancel ───────────────────────────────────
export const cancelWaitlistEntryHandler = async (req, res) => {
  try {
    const { WaitlistEntry } = req.models;
    const entry = await cancelWaitlistEntry({ WaitlistEntry }, req.params.id);
    emitWaitlistUpdated(req.tenantKey, entry);
    res.json({ entry });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};
