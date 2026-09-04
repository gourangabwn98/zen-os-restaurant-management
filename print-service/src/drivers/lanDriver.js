// src/drivers/lanDriver.js
// LAN thermal printer over tcp://ip:port. Uses node-thermal-printer's
// built-in Network interface, which is pure Node `net` sockets underneath —
// no native modules, no extra install steps.
import { ThermalPrinter, PrinterTypes } from "node-thermal-printer";
import { renderLinesToPrinter } from "./renderLines.js";

export class LanDriver {
  constructor(printerConfig) {
    this.id = printerConfig.id;
    this.type = "LAN";
    if (!printerConfig.ip) throw new Error(`Printer "${printerConfig.id}" is type LAN but has no ip configured`);

    this.printer = new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: `tcp://${printerConfig.ip}:${printerConfig.port || 9100}`,
      removeSpecialCharacters: false,
      options: { timeout: 5000 },
    });
  }

  async isOnline() {
    try {
      return await this.printer.isPrinterConnected();
    } catch {
      return false;
    }
  }

  async printText(lines) {
    renderLinesToPrinter(this.printer, lines);
    const connected = await this.printer.isPrinterConnected();
    if (!connected) throw new Error(`Printer "${this.id}" is not reachable at its configured IP/port`);
    await this.printer.execute();
  }
}
