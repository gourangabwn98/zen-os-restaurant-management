// src/drivers/mockDriver.js
// ─────────────────────────────────────────────────────────────────────────────
// In-memory printer simulator implementing the same interface as the real
// drivers (isOnline / printText). Used for:
//   - USE_MOCK_PRINTER=true dry runs (no hardware needed to see the flow work)
//   - the test suite (test/processor.test.js), where it's driven directly to
//     simulate offline printers, printer errors, and recovery.
// ─────────────────────────────────────────────────────────────────────────────
export class MockDriver {
  constructor(printerConfig, { echo = false } = {}) {
    this.id = printerConfig.id;
    this.echo = echo; // USE_MOCK_PRINTER dry run: show the ticket on screen
    this.width = Number(printerConfig.charsPerLine) >= 24 ? Number(printerConfig.charsPerLine) : 48;
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
    if (this.echo) {
      const W = this.width; // characters per line (printers.config.json charsPerLine)
      const fit = (l) => {
        if (l.type === "feed") return "";
        if (l.type === "cut") return "-".repeat(W) + " ✂";
        if (l.type === "image") {
          const t = `[ ${l.label || "logo"} ${l.bitmap.width}x${l.bitmap.height} ]`;
          return t.padStart(Math.floor((W + t.length) / 2));
        }
        const t = String(l.text ?? "");
        if (l.align === "center") return t.padStart(Math.floor((W + t.length) / 2)).padEnd(W);
        if (l.align === "right") return t.padStart(W);
        return t;
      };
      const body = lines.map((l) => `   | ${fit(l)}`).join("\n");
      console.log(`\n🖨️  [MOCK ${this.id}] would print:\n${body}\n`);
    }
    return true;
  }
}
