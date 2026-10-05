// src/index.js
import path from "path";
import { logger } from "./logger.js";
import { PrintQueue } from "./queue.js";
import { PrinterManager } from "./printerManager.js";
import { Processor } from "./processor.js";
import { SocketClient } from "./socketClient.js";
import { LogoProvider } from "./logo.js";
import { RestaurantProfileProvider } from "./restaurantProfile.js";
import { PayQrProvider } from "./payQr.js";
import { TextImageRenderer } from "./textImage.js";
import { disableQuickEdit } from "./consoleMode.js";

// True when running as the packaged .exe (scripts/build-exe.mjs), not `node`.
const PACKAGED = !["node", "node.exe"].includes(path.basename(process.execPath).toLowerCase());

async function main() {
  // Loaded here (not a static import) so a missing .env / printers.config.json
  // is reported by the catch below instead of crashing before it exists.
  const { config } = await import("./config.js");
  logger.info("Starting print-service…");
  // A click inside this window must never pause printing (src/consoleMode.js).
  if (await disableQuickEdit()) logger.info("Console QuickEdit turned off — clicking in this window no longer pauses printing");
  logger.info(`Backend: ${config.backendUrl}`);
  logger.info(`Printers configured: ${config.printers.map((p) => `${p.id}(${p.role}/${p.type})`).join(", ")}`);
  if (config.useMockPrinter) logger.warn("USE_MOCK_PRINTER=true — no real hardware will be used");

  const queue = new PrintQueue(config.queueFile);
  queue.recoverStuckJobs(); // a prior run may have died mid-print

  // Dry run: the mock printer also shows each ticket in this window.
  const printerManager = new PrinterManager(config.printers, { useMock: config.useMockPrinter, echoMock: config.useMockPrinter });
  await printerManager.checkAll();

  let socketClient; // defined below, referenced by the processor's reportStatus
  const profileProvider = new RestaurantProfileProvider({ backendUrl: config.backendUrl, cacheDir: path.dirname(config.queueFile) });
  const processor = new Processor(
    queue,
    printerManager,
    (jobId, jobType, status, error) => socketClient.reportStatus(jobId, jobType, status, error),
    {
      maxAttempts: config.maxAttempts,
      retryBaseDelayMs: config.retryBaseDelayMs,
      profileProvider,
      // Bengali / Hindi / any non-Latin text: printed as images (Windows font).
      textImages: new TextImageRenderer({ cacheDir: path.dirname(config.queueFile), font: config.unicodeFont }),
      footer: config.billFooter,
      payQrProvider: config.printPayQr
        ? new PayQrProvider({
          sizeDots: config.payQrSize,
          cacheDir: path.dirname(config.queueFile),
          // Only if the uploaded QR can't be read: print the image itself,
          // crisp (no dithering) and turned black-on-white if it's inverted.
          imageProvider: new LogoProvider({
            cacheDir: path.dirname(config.queueFile), cacheName: "payment-qr-cache",
            width: config.payQrSize, height: config.payQrSize, invert: "auto", dither: false,
          }),
        })
        : null,
      logoProvider: config.printLogo
        ? new LogoProvider({ cacheDir: path.dirname(config.queueFile), width: config.logoWidth, height: config.logoHeight, invert: config.logoInvert })
        : null,
    }
  );

  // Warm the header / logo / pay-QR now, so the first KOT or bill after a
  // start never waits for a download (each is cached afterwards).
  profileProvider.get()
    .then((h) => Promise.allSettled([
      h?.logo && processor.logoProvider?.get(h.logo),
      processor.payQrProvider?.forBill({ paymentStatus: "PENDING_VERIFICATION", total: 1 }, h),
    ]))
    .catch(() => {});

  socketClient = new SocketClient({ backendUrl: config.backendUrl, printerKey: config.printerKey, processor }).connect();

  // Any jobs recovered from a previous crash, or left PENDING when we shut
  // down last time, get a first attempt as soon as we're up — don't wait
  // for the sweep interval.
  processor.retrySweep();

  const retryTimer = setInterval(() => processor.retrySweep().catch((e) => logger.error("Retry sweep error:", e.message)), config.retrySweepIntervalMs);
  const pollTimer = setInterval(() => socketClient.reconcileQueue({ onlyNew: true }), config.queuePollIntervalMs);
  // A printer that comes back (switched on, paper loaded, cable plugged in)
  // clears its backlog at once — not on the next sweep tick.
  const healthTimer = setInterval(() => printerManager.checkAll()
    .then(() => { if (printerManager.cameOnline) return processor.retrySweep(); })
    .catch((e) => logger.error("Health check error:", e.message)), config.healthCheckIntervalMs);
  // USB plug-in / power-on: give the device a moment to enumerate, then print.
  let plugTimer = null;
  printerManager.onChange(() => {
    clearTimeout(plugTimer);
    plugTimer = setTimeout(() => {
      printerManager.checkAll().then(() => processor.retrySweep()).catch((e) => logger.error("USB change check error:", e.message));
    }, 800);
  });
  const statsTimer = setInterval(() => {
    const s = queue.stats();
    logger.info(`Queue: ${s.pending} pending, ${s.printing} printing, ${s.printed} printed, ${s.failed} failed${s.skipped ? `, ${s.skipped} skipped` : ""}`);
  }, 60000);

  const shutdown = (signal) => {
    logger.warn(`Received ${signal} — shutting down gracefully…`);
    clearInterval(retryTimer);
    clearInterval(pollTimer);
    clearInterval(healthTimer);
    clearInterval(statsTimer);
    socketClient.socket?.disconnect();
    // Queue is persisted after every mutation already (see queue.js), so
    // there's nothing left to flush here — this is exactly why a
    // print-service restart never loses a job.
    logger.ok("Shutdown complete.");
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error("Fatal startup error:", err.message);
  // Double-clicked .exe: keep the window open so the error can be read.
  if (PACKAGED && process.stdin.isTTY) {
    console.log("\nPress Enter to close…");
    process.stdin.once("data", () => process.exit(1));
    return;
  }
  process.exit(1);
});
