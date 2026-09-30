// src/printerManager.js
import { LanDriver } from "./drivers/lanDriver.js";
import { UsbDriver } from "./drivers/usbDriver.js";
import { UsbDirectDriver } from "./drivers/usbDirectDriver.js";
import { MockDriver } from "./drivers/mockDriver.js";
import { logger } from "./logger.js";
import { DEFAULT_WIDTH } from "./renderers/layout.js";

export class PrinterManager {
  constructor(printerConfigs, { useMock = false, echoMock = false } = {}) {
    this.drivers = [];
    for (const cfg of printerConfigs) {
      try {
        const driver = useMock ? new MockDriver(cfg, { echo: echoMock }) : this._buildRealDriver(cfg);
        // Characters per line for the ticket layout (src/renderers/layout.js):
        // 48 = 80 mm roll, 32 = 58 mm. Formatting only — routing is unchanged.
        const charsPerLine = Number(cfg.charsPerLine) >= 24 ? Math.floor(Number(cfg.charsPerLine)) : DEFAULT_WIDTH;
        this.drivers.push({ role: cfg.role, driver, status: "unknown", charsPerLine });
      } catch (err) {
        // A single bad printer entry (wrong type, missing field, etc.) must
        // never take down every OTHER printer along with it — log clearly
        // and keep going. This printer just won't be available until fixed.
        logger.error(`Could not initialize printer "${cfg.id}" (${cfg.type}/${cfg.role}): ${err.message}`);
      }
    }
    if (this.drivers.length === 0) {
      logger.error("No printers initialized successfully — check printers.config.json");
    }
  }

  _buildRealDriver(cfg) {
    if (cfg.type === "LAN") return new LanDriver(cfg);
    if (cfg.type === "USB") return new UsbDriver(cfg);
    if (cfg.type === "USB_DIRECT") return new UsbDirectDriver(cfg);
    throw new Error(`Unknown printer type "${cfg.type}" (expected "LAN", "USB" or "USB_DIRECT")`);
  }

  /** KOT jobs prefer a KOT/BOTH printer; BILL jobs prefer a BILL/BOTH printer. */
  driverFor(jobType) {
    const exact = this.drivers.find((d) => d.role === jobType);
    if (exact) return exact;
    return this.drivers.find((d) => d.role === "BOTH") || null;
  }

  async checkAll() {
    for (const entry of this.drivers) {
      const wasOnline = entry.status === "online";
      const online = await entry.driver.isOnline().catch(() => false);
      entry.status = online ? "online" : "offline";
      if (online !== wasOnline) {
        logger[online ? "ok" : "warn"](
          `Printer "${entry.driver.id}" (${entry.role}, ${entry.driver.type}) is now ${online ? "ONLINE" : "OFFLINE"}`
        );
      }
    }
    return this.drivers.map((d) => ({ id: d.driver.id, role: d.role, type: d.driver.type, status: d.status }));
  }

  summary() {
    return this.drivers.map((d) => ({ id: d.driver.id, role: d.role, type: d.driver.type, status: d.status }));
  }
}
