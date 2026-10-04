// controllers/tableController.js
import * as QRCode from "qrcode";
import crypto from "crypto";

import { customerBaseUrl, tableQrUrl, takeawayQrUrl, isQrStale, qrBaseMissingError } from "../utils/qrLink.js";

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

export const getTables = async (req, res) => {
  try {
    const { Table } = req.models;
    const tables = await Table.find().sort({ tableNo: 1 }).lean();
    const base = customerBaseUrl();
    // qrStale: the printed QR doesn't open today's customer app — regenerate it.
    // The token itself is never sent to non-staff (it's what proves a scan).
    const staff = ["admin", "waiter"].includes(req.user?.isAdmin ? "admin" : req.user?.role);
    res.json({
      tables: tables.map((t) => (staff
        ? { ...t, qrStale: isQrStale(t, base) }
        : { _id: t._id, tableNo: t.tableNo, seats: t.seats, status: t.status, label: t.label, occupancyStatus: t.occupancyStatus })),
      qrBaseConfigured: !!base,
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const createTable = async (req, res) => {
  try {
    const { Table } = req.models;
    const { tableNo, label, notes } = req.body;
    const seats = cleanSeats(req.body.seats, 4);
    if (!Number.isInteger(Number(tableNo)) || Number(tableNo) < 1) return res.status(400).json({ message: "Table number must be a whole number" });
    const exists = await Table.findOne({ tableNo });
    if (exists) return res.status(400).json({ message: `Table ${tableNo} already exists` });

    const qrToken = generateToken();
    const qr      = await generateQR(tableNo, qrToken);
    const table   = await Table.create({
      tableNo, seats, label: label||`Table ${tableNo}`, notes: notes||"",
      qrUrl: qr.url, qrCode: qr.dataUri, qrToken,
    });
    res.status(201).json({ table });
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
    const table = await Table.findOneAndUpdate({ tableNo: req.params.tableNo }, { $set: set }, { returnDocument: "after" });
    if (!table) return res.status(404).json({ message: "Table not found" });
    res.json({ table });
  } catch (err) { res.status(err.statusCode || 400).json({ message: err.message }); }
};

export const deleteTable = async (req, res) => {
  try {
    const { Table } = req.models;
    const table = await Table.findOneAndDelete({ tableNo: req.params.tableNo });
    if (!table) return res.status(404).json({ message: "Table not found" });
    res.json({ message: "Deleted" });
  } catch (err) { res.status(500).json({ message: err.message }); }
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
    res.json({ valid, tableNo: table.tableNo, label: table.label });
  } catch (err) {
    res.status(500).json({ valid: false, message: err.message });
  }
};
