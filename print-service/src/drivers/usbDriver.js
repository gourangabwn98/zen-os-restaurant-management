// src/drivers/usbDriver.js
// ─────────────────────────────────────────────────────────────────────────────
// USB thermal printer via its Windows printer name.
//
// WHY THIS DOESN'T USE node-thermal-printer's built-in "printer:<name>"
// interface: that interface requires the `printer` npm package — a native
// (C++) addon that needs a full build toolchain (Python + Visual Studio
// Build Tools on Windows) and is poorly maintained; its own dependency tree
// currently fails to resolve on a fresh install. Requiring that for a
// single-purpose local service is a real reliability risk.
//
// INSTEAD: node-thermal-printer can build the exact same ESC/POS byte buffer
// without ever touching an "interface" (see getBuffer() in the library) —
// we use its formatting API purely to construct bytes, then deliver those
// bytes ourselves with a technique that needs zero extra dependencies:
// writing them to a temp file and copying that file, in binary mode, to the
// printer's Windows share (\\localhost\<ShareName>). This is the standard,
// long-documented way to send raw data to a Windows-attached printer from
// the command line, and it's exactly what a print spooler does internally.
//
// REQUIREMENT: the printer must be shared. On the machine this service runs
// on: Settings → Bluetooth & devices → Printers & scanners → the printer →
// Printer properties → Sharing → "Share this printer", and use that share
// name here (usually the same as the printer's display name).
// ─────────────────────────────────────────────────────────────────────────────
import { ThermalPrinter, PrinterTypes } from "node-thermal-printer";
import { exec as execCb } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import path from "path";
import { renderLinesToPrinter } from "./renderLines.js";

const defaultExec = promisify(execCb);

export class UsbDriver {
  /**
   * @param {object} printerConfig - { id, windowsPrinterName, windowsShareName? }
   * @param {object} [deps] - injectable deps for testing: { exec, platform }
   */
  constructor(printerConfig, deps = {}) {
    this.id = printerConfig.id;
    this.type = "USB";
    if (!printerConfig.windowsPrinterName) {
      throw new Error(`Printer "${printerConfig.id}" is type USB but has no windowsPrinterName configured`);
    }
    this.printerName = printerConfig.windowsPrinterName;
    // The UNC share name defaults to the printer name — override in config
    // if you renamed the share to something different.
    this.shareName = printerConfig.windowsShareName || printerConfig.windowsPrinterName;
    this._exec = deps.exec || defaultExec;
    this._platform = deps.platform || os.platform();

    // No `interface` passed — we only use this instance to build a byte
    // buffer via its formatting methods, never to send anything itself.
    this.printer = new ThermalPrinter({
      type: PrinterTypes.EPSON,
      removeSpecialCharacters: false,
    });
  }

  /** Best-effort presence check via PowerShell. Never throws — if the check
   * itself can't run (e.g. not on Windows, PowerShell unavailable), we
   * report "unknown" as online so a real print attempt is still tried
   * rather than skipped on a false negative. The print attempt itself is
   * always the authoritative test. */
  async isOnline() {
    if (this._platform !== "win32") return true; // nothing meaningful to check off-Windows (e.g. dev/test)
    try {
      const { stdout } = await this._exec(
        `powershell -NoProfile -Command "(Get-Printer -Name '${this._escapeForPowerShell(this.printerName)}').PrinterStatus"`,
        { timeout: 5000 }
      );
      const status = stdout.trim();
      // Get-Printer's PrinterStatus is "Normal" when idle/ready. Anything
      // else (Offline, Error, Paper Out, etc.) — or the command finding no
      // matching printer at all — we treat as offline.
      return status.length > 0 && status.toLowerCase() === "normal";
    } catch {
      return true; // couldn't determine — don't block a real attempt on it
    }
  }

  async printText(lines) {
    renderLinesToPrinter(this.printer, lines);
    const buffer = this.printer.getBuffer();

    if (this._platform !== "win32") {
      throw new Error(
        `USB printing via a Windows printer share is only supported when this service runs on Windows (current platform: ${this._platform})`
      );
    }

    const tmpFile = path.join(os.tmpdir(), `kot-${Date.now()}-${Math.random().toString(36).slice(2)}.prn`);
    fs.writeFileSync(tmpFile, buffer);

    try {
      // /b = binary mode — required so Windows doesn't treat this as a text
      // file and mangle the ESC/POS control bytes.
      await this._exec(`copy /b "${tmpFile}" "\\\\localhost\\${this.shareName}"`, { timeout: 15000 });
    } catch (err) {
      throw new Error(
        `Could not send data to shared printer "${this.shareName}" — is it shared, and is the share name correct? (${err.message})`
      );
    } finally {
      fs.unlink(tmpFile, () => {}); // best-effort cleanup, never block on it
    }
  }

  _escapeForPowerShell(name) {
    return name.replace(/'/g, "''");
  }
}
