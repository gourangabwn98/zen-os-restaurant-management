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
