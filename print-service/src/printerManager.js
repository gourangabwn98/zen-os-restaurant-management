// src/printerManager.js
import { LanDriver } from "./drivers/lanDriver.js";
import { UsbDriver } from "./drivers/usbDriver.js";
import { MockDriver } from "./drivers/mockDriver.js";
import { logger } from "./logger.js";

export class PrinterManager {
  constructor(printerConfigs, { useMock = false } = {}) {
    this.drivers = [];
    for (const cfg of printerConfigs) {
      try {
        const driver = useMock ? new MockDriver(cfg) : this._buildRealDriver(cfg);
        this.drivers.push({ role: cfg.role, driver, status: "unknown" });
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
    throw new Error(`Unknown printer type "${cfg.type}" (expected "LAN" or "USB")`);
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
