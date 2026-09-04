// controllers/printerController.js
import { getRoomConnectionCount } from "../sockets/socket.js";
import { rooms } from "../utils/tenantKey.js";
import {
  createPrinterDevice, listPrinterDevices, revokePrinterDevice,
} from "../services/printerDeviceService.js";

// ── GET /api/admin/printer/status — staff dashboard widget ──────────────────
export const getPrinterStatus = async (req, res) => {
  try {
    const { KOTJob, BillPrintJob, PrinterDevice } = req.models;
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

    const [
      kotPending, kotPrinting, kotPrintedToday, kotFailed, kotRecentFailed,
      billPending, billPrinting, billPrintedToday, billFailed,
      devices,
    ] = await Promise.all([
      KOTJob.countDocuments({ status: "PENDING" }),
      KOTJob.countDocuments({ status: "PRINTING" }),
      KOTJob.countDocuments({ status: "PRINTED", printedAt: { $gte: todayStart } }),
      KOTJob.countDocuments({ status: "FAILED" }),
      KOTJob.find({ status: "FAILED" }).sort({ createdAt: -1 }).limit(10),
      BillPrintJob.countDocuments({ status: "PENDING" }),
      BillPrintJob.countDocuments({ status: "PRINTING" }),
      BillPrintJob.countDocuments({ status: "PRINTED", printedAt: { $gte: todayStart } }),
      BillPrintJob.countDocuments({ status: "FAILED" }),
      PrinterDevice.find({ status: "Active" }).select("-keyHash"),
    ]);

    const connectedCount = await getRoomConnectionCount(rooms.printers(req.tenantKey));

    res.json({
      connectedPrinters: connectedCount,
      online: connectedCount > 0,
      devices,
      kot:  { pending: kotPending, printing: kotPrinting, printedToday: kotPrintedToday, failed: kotFailed },
      bill: { pending: billPending, printing: billPrinting, printedToday: billPrintedToday, failed: billFailed },
      // legacy shape kept for the existing admin dashboard widget (Phase 4)
      queue: { pending: kotPending + billPending, sent: kotPrinting + billPrinting, printedToday: kotPrintedToday + billPrintedToday, failed: kotFailed + billFailed },
      recentFailed: kotRecentFailed,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── GET /api/admin/printer/queue ─────────────────────────────────────────────
// Pulled by the print-service on every connect/reconnect (not just pushed to
// via socket) so a job created while the print-service was offline — or a
// status update it missed — is never lost. This is the reconciliation path
// that makes "reconnect must never print the same job twice, and must never
// lose a job" possible: the print-service diffs this list against its own
// local queue by job _id.
export const getPrintQueue = async (req, res) => {
  try {
    const { KOTJob, BillPrintJob } = req.models;
    const NOT_DONE = { $in: ["PENDING","PRINTING","FAILED"] };

    const [kot, bill] = await Promise.all([
      KOTJob.find({ status: NOT_DONE }).sort({ createdAt: 1 }).lean(),
      BillPrintJob.find({ status: NOT_DONE }).sort({ createdAt: 1 }).lean(),
    ]);

    const jobs = [
      ...kot.map((j) => ({ jobId: String(j._id), jobType: "KOT", status: j.status, attempts: j.attempts,
        orderId: j.orderId, tableNo: j.tableNo, orderType: j.orderType, items: j.items,
        priority: j.priority || "NORMAL", createdAt: j.createdAt })),
      ...bill.map((j) => ({ jobId: String(j._id), jobType: "BILL", status: j.status, attempts: j.attempts,
        orderId: j.orderId, tableNo: j.tableNo, orderType: j.orderType, payload: j.payload, createdAt: j.createdAt })),
    ].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    res.json({ jobs });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── PATCH /api/admin/printer/kot/:id/status — manual staff override ─────────
// (The print-service itself reports status over the socket connection — see
// sockets/socket.js `report-job-status` — this REST path is for a human.)
export const updateKotJobStatus = async (req, res) => {
  try {
    const { KOTJob } = req.models;
    const { status } = req.body;
    if (!["PENDING","PRINTING","PRINTED","FAILED"].includes(status)) {
      return res.status(400).json({ message: "status must be PENDING, PRINTING, PRINTED, or FAILED" });
    }
    const job = await KOTJob.findByIdAndUpdate(
      req.params.id,
      { $set: { status, ...(status === "PRINTED" ? { printedAt: new Date() } : {}) } },
      { new: true }
    );
    if (!job) return res.status(404).json({ message: "KOT job not found" });
    res.json({ job });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── Printer devices (admin-only) ─────────────────────────────────────────────
// POST /api/admin/printer/devices — creates a device and returns the
// plaintext key ONCE. It is never retrievable again.
export const registerPrinterDevice = async (req, res) => {
  try {
    const { PrinterDevice } = req.models;
    const { name, role, connectionType, lanIp, lanPort, usbPrinterName } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: "Printer name is required" });

    const { device, plainKey } = await createPrinterDevice({
      PrinterDevice, name: name.trim(), role, connectionType, lanIp, lanPort, usbPrinterName,
    });

    res.status(201).json({
      device: { _id: device._id, name: device.name, role: device.role, connectionType: device.connectionType },
      printerKey: plainKey, // shown once — the print-service's .env stores this
      warning: "Save this key now — it will not be shown again.",
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

export const getPrinterDevices = async (req, res) => {
  try {
    const { PrinterDevice } = req.models;
    const devices = await listPrinterDevices({ PrinterDevice });
    res.json({ devices });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const deletePrinterDevice = async (req, res) => {
  try {
    const { PrinterDevice } = req.models;
    await revokePrinterDevice({ PrinterDevice, id: req.params.id });
    res.json({ message: "Printer device revoked" });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};
