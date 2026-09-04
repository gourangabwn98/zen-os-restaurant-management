// src/index.js
import { config } from "./config.js";
import { logger } from "./logger.js";
import { PrintQueue } from "./queue.js";
import { PrinterManager } from "./printerManager.js";
import { Processor } from "./processor.js";
import { SocketClient } from "./socketClient.js";

async function main() {
  logger.info("Starting print-service…");
  logger.info(`Backend: ${config.backendUrl}`);
  logger.info(`Printers configured: ${config.printers.map((p) => `${p.id}(${p.role}/${p.type})`).join(", ")}`);
  if (config.useMockPrinter) logger.warn("USE_MOCK_PRINTER=true — no real hardware will be used");

  const queue = new PrintQueue(config.queueFile);
  queue.recoverStuckJobs(); // a prior run may have died mid-print

  const printerManager = new PrinterManager(config.printers, { useMock: config.useMockPrinter });
  await printerManager.checkAll();

  let socketClient; // defined below, referenced by the processor's reportStatus
  const processor = new Processor(
    queue,
    printerManager,
    (jobId, jobType, status, error) => socketClient.reportStatus(jobId, jobType, status, error),
    { maxAttempts: config.maxAttempts }
  );

  socketClient = new SocketClient({ backendUrl: config.backendUrl, printerKey: config.printerKey, processor }).connect();

  // Any jobs recovered from a previous crash, or left PENDING when we shut
  // down last time, get a first attempt as soon as we're up — don't wait
  // for the sweep interval.
  processor.retrySweep();

  const retryTimer = setInterval(() => processor.retrySweep().catch((e) => logger.error("Retry sweep error:", e.message)), config.retrySweepIntervalMs);
  const healthTimer = setInterval(() => printerManager.checkAll().catch((e) => logger.error("Health check error:", e.message)), config.healthCheckIntervalMs);
  const statsTimer = setInterval(() => {
    const s = queue.stats();
    logger.info(`Queue: ${s.pending} pending, ${s.printing} printing, ${s.printed} printed, ${s.failed} failed`);
  }, 60000);

  const shutdown = (signal) => {
    logger.warn(`Received ${signal} — shutting down gracefully…`);
    clearInterval(retryTimer);
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
  process.exit(1);
});
