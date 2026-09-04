// src/drivers/mockDriver.js
// ─────────────────────────────────────────────────────────────────────────────
// In-memory printer simulator implementing the same interface as the real
// drivers (isOnline / printText). Used for:
//   - USE_MOCK_PRINTER=true dry runs (no hardware needed to see the flow work)
//   - the test suite (test/processor.test.js), where it's driven directly to
//     simulate offline printers, printer errors, and recovery.
// ─────────────────────────────────────────────────────────────────────────────
export class MockDriver {
  constructor(printerConfig) {
    this.id = printerConfig.id;
    this.type = printerConfig.type;
    this.online = printerConfig.startOnline ?? true;
    this.failNext = 0; // number of upcoming print attempts to force-fail
    this.printedJobs = []; // for test assertions — every successful print's lines
  }

  setOnline(value) { this.online = value; }
  forceFailNext(n = 1) { this.failNext = n; }

  async isOnline() {
    return this.online;
  }

  async printText(lines) {
    if (!this.online) {
      throw new Error(`Mock printer "${this.id}" is offline`);
    }
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error(`Mock printer "${this.id}" simulated failure`);
    }
    this.printedJobs.push(lines);
    return true;
  }
}
