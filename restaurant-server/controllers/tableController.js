// controllers/tableController.js
import { isStaffRole } from "../utils/roles.js";
import * as QRCode from "qrcode";
import crypto from "crypto";

import { customerBaseUrl, tableQrUrl, takeawayQrUrl, isQrStale, qrBaseMissingError } from "../utils/qrLink.js";
import { normalizeTableArea, sortTablesByArea, tableDisplayNo, tableDisplayName } from "../utils/diningArea.js";

const generateToken = () => crypto.randomBytes(9).toString("hex");

// TBL-02: any real table size (8, 10, 12 …), not a fixed 2/4/6 list.
const MAX_SEATS = 100;
const cleanSeats = (v, fallback) => {
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > MAX_SEATS) {
    throw Object.assign(new Error(`Number of seats must be a whole number from 1 to ${MAX_SEATS}`), { statusCode: 400 });
  }
  return n;
};

// TBL-01: the QR is a direct link to the customer app (utils/qrLink.js).
const generateQR = async (tableNo, token) => {
  const base = customerBaseUrl();
  if (!base) throw qrBaseMissingError();
  const url     = tableQrUrl(base, tableNo, token);
  const dataUri = await QRCode.toDataURL(url, {
    width: 300, margin: 2,
    color: { dark: "#1a1a2e", light: "#ffffff" },
    errorCorrectionLevel: "H",
  });
  return { url, dataUri };
};

// ── GET /api/admin/tables/takeaway-qr ──────────────────────────────────────
// One shared counter/entrance QR for takeaway. It carries no table/token, so
// the customer app can never treat it as a dine-in scan; `mode=takeaway`
// tells it to drop any table remembered from an earlier visit.
export const getTakeawayQR = async (req, res) => {
  try {
    const base = customerBaseUrl();
    if (!base) throw qrBaseMissingError();
    const url     = takeawayQrUrl(base);
    const dataUri = await QRCode.toDataURL(url, {
      width: 300, margin: 2,
      color: { dark: "#1a1a2e", light: "#ffffff" },
      errorCorrectionLevel: "H",
    });
    res.json({ qrUrl: url, qrCode: dataUri });
  } catch (err) { res.status(err.statusCode || 500).json({ message: err.message }); }
};

// A table with guests / running orders can't be disabled or deleted — its
// open session and orders would disappear from every table map. Uses the
// existing occupancy (TableSession) + order state, nothing new.
const RUNNING = ["PENDING_CONFIRMATION", "CONFIRMED", "PREPARING", "READY", "DELIVERED"];
export const assertTableFree = async (models, tableNo, verb) => {
  const no = Number(tableNo);
  const [session, running] = await Promise.all([
    models.TableSession ? models.TableSession.findOne({ tableNo: no, status: "OPEN" }).select("_id").lean() : null,
    models.Order ? models.Order.findOne({ orderType: "DINE_IN", tableNo: no, status: { $in: RUNNING } }).select("_id").lean() : null,
  ]);
  if (session || running) {
    throw Object.assign(new Error(`Table ${no} is in use — settle and clear it before it can be ${verb}`), { statusCode: 409 });
  }
};

// ── Per-area table numbers ──────────────────────────────────────────────────
// The admin numbers tables within an area (Indoor 1–10, Indoor-AC 1–6 …).
// Each table still gets its own unique internal tableNo — the key every
// order / session / QR / bill already uses — picked here, never typed.
const MAX_TABLE_NO = 9999;
const cleanDisplayNo = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > MAX_TABLE_NO) {
    throw Object.assign(new Error("Table number must be a whole number from 1 to 9999"), { statusCode: 400 });
  }
  return n;
};
/** 400 when another table in this area already has this number. */
const assertNumberFree = async (Table, area, displayNo, exceptTableNo = null) => {
  const sameArea = await Table.find({ diningArea: area === "" ? { $in: ["", null] } : area }).select("tableNo displayNo").lean();
  const taken = sameArea.some((t) => tableDisplayNo(t) === displayNo && Number(t.tableNo) !== Number(exceptTableNo));
  if (taken) throw Object.assign(new Error(`${tableDisplayName(area, displayNo)} already exists`), { statusCode: 400 });
};
/** Internal key: the area number itself when no table uses it yet (so old
 * setups stay "Table 5 = 5"), otherwise the next free number. */
const pickInternalTableNo = async (Table, preferred) => {
  if (!(await Table.findOne({ tableNo: preferred }).select("_id").lean())) return preferred;
  const top = await Table.findOne().sort({ tableNo: -1 }).select("tableNo").lean();
  return Number(top?.tableNo || 0) + 1;
};
const withNames = (t) => {
  const displayNo = tableDisplayNo(t);
  return { displayNo, tableName: tableDisplayName(t.diningArea || "", displayNo) };
};

export const getTables = async (req, res) => {
  try {
    const { Table } = req.models;
    // One ordering for every table map (admin + waiter): by area, then number.
    const tables = sortTablesByArea(await Table.find().sort({ tableNo: 1 }).lean());
    const base = customerBaseUrl();
    // qrStale: the printed QR doesn't open today's customer app — regenerate it.
    // The token itself is never sent to non-staff (it's what proves a scan).
    const staff = isStaffRole(req.user?.isAdmin ? "admin" : req.user?.role);
    res.json({
      tables: tables.map((t) => (staff
        ? { ...t, ...withNames(t), qrStale: isQrStale(t, base) }
        : { _id: t._id, tableNo: t.tableNo, seats: t.seats, status: t.status, label: t.label, occupancyStatus: t.occupancyStatus, diningArea: t.diningArea || "", ...withNames(t) })),
      qrBaseConfigured: !!base,
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const createTable = async (req, res) => {
  try {
    const { Table } = req.models;
    const { label, notes } = req.body;
    const seats = cleanSeats(req.body.seats, 4);
    const diningArea = normalizeTableArea(req.body.diningArea) ?? ""; // Indoor by default
    // The number within the area ("Indoor-AC 1"). Older admin builds send it as tableNo.
    const displayNo = cleanDisplayNo(req.body.displayNo ?? req.body.tableNo);
    await assertNumberFree(Table, diningArea, displayNo);

    const qrToken = generateToken();
    let table = null;
    for (let attempt = 0; attempt < 3 && !table; attempt++) {
      const tableNo = await pickInternalTableNo(Table, displayNo);
      const qr      = await generateQR(tableNo, qrToken);
      try {
        table = await Table.create({
          tableNo, displayNo, seats, label: label || tableDisplayName(diningArea, displayNo), notes: notes || "", diningArea,
          qrUrl: qr.url, qrCode: qr.dataUri, qrToken,
        });
      } catch (err) {
        if (err?.code !== 11000) throw err; // two admins at once took that key → pick again
      }
    }
    if (!table) throw Object.assign(new Error("Couldn't create the table — please try again"), { statusCode: 409 });
    res.status(201).json({ table: { ...(table.toObject ? table.toObject() : table), ...withNames(table) } });
  } catch (err) { res.status(err.statusCode || 400).json({ message: err.message }); }
};

export const updateTable = async (req, res) => {
  try {
    const { Table } = req.models;
    // Only these are editable — never the QR token / occupancy (it used to
    // take req.body wholesale).
    const set = {};
    if (req.body.seats !== undefined) set.seats = cleanSeats(req.body.seats);
    for (const k of ["label", "notes"]) if (typeof req.body[k] === "string") set[k] = req.body[k].trim().slice(0, 60);
    if (["Active", "Inactive"].includes(req.body.status)) set.status = req.body.status;
    const area = normalizeTableArea(req.body.diningArea);
    if (area !== undefined || req.body.displayNo !== undefined) {
      // Moving a table to another area and/or renumbering it: the number must
      // be free in the target area. The internal key never changes.
      const current = await Table.findOne({ tableNo: req.params.tableNo }).select("tableNo displayNo diningArea").lean();
      if (!current) return res.status(404).json({ message: "Table not found" });
      const nextArea = area !== undefined ? area : (current.diningArea || "");
      const nextNo = req.body.displayNo !== undefined ? cleanDisplayNo(req.body.displayNo) : tableDisplayNo(current);
      await assertNumberFree(Table, nextArea, nextNo, current.tableNo);
      set.diningArea = nextArea;
      set.displayNo = nextNo;
    }
    // A table someone is sitting at can't be switched off (it would vanish
    // from the maps with its orders still running) — clear it first.
    if (set.status === "Inactive") await assertTableFree(req.models, req.params.tableNo, "disabled");
    const table = await Table.findOneAndUpdate({ tableNo: req.params.tableNo }, { $set: set }, { returnDocument: "after" });
    if (!table) return res.status(404).json({ message: "Table not found" });
    res.json({ table });
  } catch (err) { res.status(err.statusCode || 400).json({ message: err.message }); }
};

export const deleteTable = async (req, res) => {
  try {
    const { Table } = req.models;
    await assertTableFree(req.models, req.params.tableNo, "deleted");
    const table = await Table.findOneAndDelete({ tableNo: req.params.tableNo });
    if (!table) return res.status(404).json({ message: "Table not found" });
    res.json({ message: "Deleted" });
  } catch (err) { res.status(err.statusCode || 500).json({ message: err.message }); }
};

export const regenerateQR = async (req, res) => {
  try {
    const { Table } = req.models;
    // keepToken: rebuild the link for a stale QR without invalidating the
    // table's token; otherwise a fresh token (old printed QRs stop working).
    const current = await Table.findOne({ tableNo: req.params.tableNo }).select("qrToken").lean();
    if (!current) return res.status(404).json({ message: "Table not found" });
    const qrToken = req.body?.keepToken && current.qrToken ? current.qrToken : generateToken();
    const qr      = await generateQR(req.params.tableNo, qrToken);
    const table   = await Table.findOneAndUpdate(
      { tableNo: req.params.tableNo },
      { qrUrl: qr.url, qrCode: qr.dataUri, qrToken },
      { returnDocument: "after" }
    );
    if (!table) return res.status(404).json({ message: "Table not found" });
    res.json({ table, qrUrl: qr.url, qrCode: qr.dataUri });
  } catch (err) { res.status(err.statusCode || 500).json({ message: err.message }); }
};

// ── GET /api/admin/tables/:tableNo/validate?token=... ─────────────────────
// Public (no auth needed — a guest scanning a QR isn't logged in yet).
// Lets a future customer-app build confirm "yes, this is a real scan of a
// real table" before showing the menu, without exposing the token itself
// anywhere except inside the printed QR code.
export const validateTableToken = async (req, res) => {
  try {
    const { Table } = req.models;
    const { token } = req.query;
    const table = await Table.findOne({ tableNo: Number(req.params.tableNo) });
    if (!table || table.status !== "Active") {
      return res.status(404).json({ valid: false, message: "Table not found or inactive" });
    }
    const valid = !!token && !!table.qrToken && token === table.qrToken;
    res.json({ valid, tableNo: table.tableNo, label: table.label, tableName: tableDisplayName(table.diningArea || "", tableDisplayNo(table)) });
  } catch (err) {
    res.status(500).json({ valid: false, message: err.message });
  }
};
