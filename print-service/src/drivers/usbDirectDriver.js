// src/drivers/usbDirectDriver.js
// ─────────────────────────────────────────────────────────────────────────────
// USB thermal printer driven DIRECTLY over USB — no Windows printer, no
// printer driver, no print share, no Print Spooler, no admin rights.
//
// Many cheap ESC/POS receipt printers (e.g. the common STMicro-based
// "POS-58/80" boards, USB 0483:5720) enumerate on Windows with the generic
// WinUSB driver instead of a printer driver, so they never appear under
// Printers & scanners and the share-based UsbDriver can't reach them. WinUSB
// is exactly what lets a user-mode program talk to the device, so we write
// the ESC/POS bytes straight to the printer's bulk OUT endpoint.
//
// Uses the `usb` package (v3, prebuilt N-API binary — no C++ toolchain; not
// to be confused with the broken native `printer` package the UsbDriver
// comment warns about). It's loaded lazily: only a USB_DIRECT printer needs
// it, and inside the packaged .exe (a Node SEA, which can only `require`
// built-ins) it is loaded from the node_modules folder shipped next to the
// .exe (scripts/build-exe.mjs).
//
// Config (printers.config.json):
//   { "id": "counter", "role": "BOTH", "type": "USB_DIRECT" }
//   optional "vendorId": "0483", "productId": "5720" (hex) to pick one
//   printer when several are attached; otherwise the first USB device with a
//   printer-class (7) interface is used.
// ─────────────────────────────────────────────────────────────────────────────
import { ThermalPrinter, PrinterTypes } from "node-thermal-printer";
import { createRequire } from "module";
import path from "path";
import { renderLinesToPrinter } from "./renderLines.js";

const PRINTER_CLASS = 7;
const USB_CHUNK = 4096;               // bytes per USB write
const USB_CHUNK_TIMEOUT_MS = 20000;   // per chunk — the printer may be busy printing the previous one
const PACKAGED = !["node", "node.exe"].includes(path.basename(process.execPath).toLowerCase());

let usbModule = null;
/** The `usb` package's `usb` export — from the project's node_modules when
 * run with Node, from <exe folder>/node_modules when packaged. */
export const loadUsb = () => {
  if (usbModule) return usbModule;
  const base = PACKAGED ? path.join(path.dirname(process.execPath), "package.json") : import.meta.url;
  try {
    usbModule = createRequire(base)("usb").usb;
  } catch (err) {
    throw new Error(
      `USB support isn't available (${err.message}) — ` +
      (PACKAGED ? "keep the node_modules folder next to SohojPrintService.exe" : "run npm install"));
  }
  return usbModule;
};

const hex = (v) => (v === undefined || v === null || v === "" ? null : typeof v === "number" ? v : parseInt(String(v), 16));

export class UsbDirectDriver {
  /**
   * @param {object} printerConfig - { id, vendorId?, productId? }
   * @param {object} [deps] - injectable for tests: { usb }
   */
  constructor(printerConfig, deps = {}) {
    this.id = printerConfig.id;
    this.type = "USB_DIRECT";
    this.vendorId = hex(printerConfig.vendorId);
    this.productId = hex(printerConfig.productId);
    if ((this.vendorId === null) !== (this.productId === null)) {
      throw new Error(`Printer "${this.id}": set both vendorId and productId, or neither`);
    }
    this._usb = deps.usb || null;
    this._busy = Promise.resolve(); // one USB transfer at a time
    // Only used to build the ESC/POS byte buffer (same as UsbDriver).
    this.printer = new ThermalPrinter({ type: PrinterTypes.EPSON, removeSpecialCharacters: false });
  }

  _lib() { return this._usb || loadUsb(); }

  /** The attached printer, or null. */
  async _find() {
    const usb = this._lib();
    if (this.vendorId !== null) return (await usb.findDeviceByIds(this.vendorId, this.productId)) || null;
    const devices = await usb.getDevices();
    return devices.find((d) => {
      try {
        return (d.configurations || []).some((c) =>
          c.interfaces.some((i) => i.alternates.some((a) => a.interfaceClass === PRINTER_CLASS)));
      } catch {
        return false; // some devices (webcam, Bluetooth…) refuse descriptor reads — not a printer anyway
      }
    }) || null;
  }

  async isOnline() {
    try {
      return Boolean(await this._find());
    } catch {
      return false;
    }
  }

  printText(lines) {
    // Serialize: two jobs must never interleave bytes on the same printer.
    const run = this._busy.then(() => this._print(lines));
    this._busy = run.catch(() => {});
    return run;
  }

  async _print(lines) {
    renderLinesToPrinter(this.printer, lines);
    const data = this.printer.getBuffer();

    const device = await this._find();
    if (!device) {
      throw new Error(`Printer "${this.id}" not found on USB — is it plugged in and switched on?`);
    }
    await device.open();
    let claimed = null;
    try {
      if (!device.configuration) await device.selectConfiguration(1);
      const { itf, endpoint } = this._outEndpoint(device);
      await device.claimInterface(itf);
      claimed = itf;
      // In chunks, each with a generous timeout: the usb package's default is
      // 1 s per write, and a bill with a logo / pay-QR image is far more than
      // a slow thermal printer accepts in 1 s — the write got "Cancelled"
      // half-way and the bill printed cut off.
      for (let off = 0; off < data.length; off += USB_CHUNK) {
        const chunk = data.subarray(off, Math.min(off + USB_CHUNK, data.length));
        const res = await device.transferOut(endpoint, chunk, USB_CHUNK_TIMEOUT_MS);
        if (res.status !== "ok" || res.bytesWritten !== chunk.length) {
          throw new Error(`USB write incomplete (${res.status}, ${off + Math.max(0, res.bytesWritten || 0)}/${data.length} bytes)`);
        }
      }
    } finally {
      if (claimed !== null) await device.releaseInterface(claimed).catch(() => {});
      await device.close().catch(() => {});
    }
  }

  /** Bulk OUT endpoint of the printer-class interface (or the first bulk OUT). */
  _outEndpoint(device) {
    const candidates = [];
    for (const itf of device.configuration.interfaces) {
      for (const alt of itf.alternates) {
        const out = alt.endpoints.find((e) => e.direction === "out" && e.type === "bulk");
        if (out) candidates.push({ itf: itf.interfaceNumber, endpoint: out.endpointNumber, printer: alt.interfaceClass === PRINTER_CLASS });
      }
    }
    const pick = candidates.find((c) => c.printer) || candidates[0];
    if (!pick) throw new Error(`Printer "${this.id}" has no USB output endpoint`);
    return pick;
  }
}
