// controllers/tableController.js
import * as QRCode from "qrcode";
import crypto from "crypto";

const generateToken = () => crypto.randomBytes(9).toString("hex");

const generateQR = async (tableNo, token) => {
  const url     = `${process.env.CLIENT_URL}/?table=${tableNo}&t=${token}`;
  const dataUri = await QRCode.toDataURL(url, {
    width: 300, margin: 2,
    color: { dark: "#1a1a2e", light: "#ffffff" },
    errorCorrectionLevel: "H",
  });
  return { url, dataUri };
};

export const getTables = async (req, res) => {
  try {
    const { Table } = req.models;
    const tables = await Table.find().sort({ tableNo: 1 });
    res.json({ tables });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const createTable = async (req, res) => {
  try {
    const { Table } = req.models;
    const { tableNo, seats, label, notes } = req.body;
    const exists = await Table.findOne({ tableNo });
    if (exists) return res.status(400).json({ message: `Table ${tableNo} already exists` });

    const qrToken = generateToken();
    const qr      = await generateQR(tableNo, qrToken);
    const table   = await Table.create({
      tableNo, seats: seats||4, label: label||`Table ${tableNo}`, notes: notes||"",
      qrUrl: qr.url, qrCode: qr.dataUri, qrToken,
    });
    res.status(201).json({ table });
  } catch (err) { res.status(400).json({ message: err.message }); }
};

export const updateTable = async (req, res) => {
  try {
    const { Table } = req.models;
    const table = await Table.findOneAndUpdate({ tableNo: req.params.tableNo }, req.body, { new: true });
    if (!table) return res.status(404).json({ message: "Table not found" });
    res.json({ table });
  } catch (err) { res.status(400).json({ message: err.message }); }
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
    const qrToken = generateToken();
    const qr      = await generateQR(req.params.tableNo, qrToken);
    const table   = await Table.findOneAndUpdate(
      { tableNo: req.params.tableNo },
      { qrUrl: qr.url, qrCode: qr.dataUri, qrToken },
      { new: true }
    );
    if (!table) return res.status(404).json({ message: "Table not found" });
    res.json({ table, qrUrl: qr.url, qrCode: qr.dataUri });
  } catch (err) { res.status(500).json({ message: err.message }); }
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
