// services/printerDeviceService.js
// ─────────────────────────────────────────────────────────────────────────────
// Printer devices authenticate to the Socket.IO server with a long-lived
// secret key (not a staff JWT — an unattended background service shouldn't
// hold staff-level credentials). Only a hash of the key is ever stored,
// exactly like a password, so a database read alone can't leak working
// credentials.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "crypto";

const KEY_PREFIX = "prn";

const hashKey = (plainKey) => crypto.createHash("sha256").update(plainKey).digest("hex");

export const generatePrinterKey = () => `${KEY_PREFIX}_${crypto.randomBytes(24).toString("hex")}`;

export const createPrinterDevice = async ({ PrinterDevice, name, role, connectionType, lanIp, lanPort, usbPrinterName }) => {
  const plainKey = generatePrinterKey();
  const device = await PrinterDevice.create({
    name,
    keyHash: hashKey(plainKey),
    role: ["KOT","BILL","BOTH"].includes(role) ? role : "BOTH",
    connectionType: connectionType === "USB" ? "USB" : "LAN",
    lanIp: lanIp || "",
    lanPort: lanPort ? Number(lanPort) : 9100,
    usbPrinterName: usbPrinterName || "",
  });
  return { device, plainKey };
};

export const listPrinterDevices = ({ PrinterDevice }) =>
  PrinterDevice.find().select("-keyHash").sort({ createdAt: -1 });

export const revokePrinterDevice = async ({ PrinterDevice, id }) => {
  const device = await PrinterDevice.findById(id);
  if (!device) { const err = new Error("Printer device not found"); err.statusCode = 404; throw err; }
  device.status = "Revoked";
  await device.save();
  return device;
};

/** Used by the Socket.IO auth layer. Returns the device doc or null. */
export const verifyPrinterKey = async ({ PrinterDevice, plainKey }) => {
  if (!plainKey) return null;
  const device = await PrinterDevice.findOne({ keyHash: hashKey(plainKey), status: "Active" });
  return device;
};

export const markPrinterSeen = async ({ PrinterDevice, deviceId, status, error }) => {
  const update = { lastSeenAt: new Date(), lastStatus: status };
  if (error !== undefined) update.lastError = error || "";
  await PrinterDevice.findByIdAndUpdate(deviceId, { $set: update });
};

// ── Stale print jobs ─────────────────────────────────────────────────────────
// A job still waiting when no print service was connected (e.g. none was ever
// set up) would otherwise all print at once the moment one connects — a pile
// of hours-old KOTs. An admin can drop the stale ones first. Atomic and
// conditional on the job still waiting, so a job that a printer has started
// or finished meanwhile is never touched (same pattern as report-job-status).
export const WAITING_STATUSES = ["PENDING", "FAILED"];
export const STALE_MIN_MINUTES = 10;

/** Pure: the cutoff for "older than N minutes" (N clamped to at least 10). */
export const staleCutoff = (olderThanMinutes, now = new Date()) => {
  const m = Number(olderThanMinutes);
  const minutes = Number.isFinite(m) ? Math.max(STALE_MIN_MINUTES, Math.round(m)) : 60;
  return { minutes, cutoff: new Date(now.getTime() - minutes * 60 * 1000) };
};

/** Marks waiting KOT/bill jobs older than the cutoff SKIPPED. → { kot, bill, minutes } */
export const skipStalePrintJobs = async ({ KOTJob, BillPrintJob, olderThanMinutes, actor, now = new Date() }) => {
  const { minutes, cutoff } = staleCutoff(olderThanMinutes, now);
  const filter = { status: { $in: WAITING_STATUSES }, createdAt: { $lt: cutoff } };
  const update = { $set: { status: "SKIPPED", lastError: `Skipped by ${actor?.name || "admin"} — older than ${minutes} min` } };
  const [k, b] = await Promise.all([KOTJob.updateMany(filter, update), BillPrintJob.updateMany(filter, update)]);
  return { kot: k.modifiedCount || 0, bill: b.modifiedCount || 0, minutes };
};
