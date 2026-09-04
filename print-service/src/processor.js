// src/processor.js
// ─────────────────────────────────────────────────────────────────────────────
// The heart of the print-service. Everything here is written to be testable
// without real hardware or a real socket connection — see test/processor.test.js,
// which exercises this exact module with a MockDriver and a fake reportStatus.
// ─────────────────────────────────────────────────────────────────────────────
import { renderKot } from "./renderers/kotRenderer.js";
import { renderBill } from "./renderers/billRenderer.js";
import { logger } from "./logger.js";

export class Processor {
  /**
   * @param {PrintQueue} queue
   * @param {PrinterManager} printerManager
   * @param {(jobId:string, jobType:string, status:string, error?:string) => Promise<void>} reportStatus
   * @param {{maxAttempts:number}} opts
   */
  constructor(queue, printerManager, reportStatus, opts = {}) {
    this.queue = queue;
    this.printerManager = printerManager;
    this.reportStatus = reportStatus;
    this.maxAttempts = opts.maxAttempts ?? 5;
    this._processing = new Set(); // jobIds currently mid-print, in THIS process
  }

  /**
   * Called whenever a job becomes known to us — a live socket push
   * (kot:created / bill:print) or a pull-reconciliation from
   * GET /admin/printer/queue after (re)connecting. Either path funnels
   * through here, and either path is a no-op if we've already printed it.
   */
  async ingest(job) {
    if (this.queue.isTerminal(job.jobId)) {
      logger.info(`Skipping job ${job.jobId} (${job.jobType}) — already printed`);
      return;
    }
    const wasKnown = this.queue.has(job.jobId);
    this.queue.upsert({ ...job, status: job.status || "PENDING" });
    if (!wasKnown) logger.info(`Queued new ${job.jobType} job ${job.jobId}`);
    await this.tryPrint(job.jobId);
  }

  /** Attempts to print exactly one job, exactly once, right now. */
  async tryPrint(jobId) {
    if (this._processing.has(jobId)) return; // already mid-flight in this process
    const job = this.queue.get(jobId);
    if (!job) return;
    if (job.status === "PRINTED") return; // duplicate-protection: never re-print

    if ((job.attempts || 0) >= this.maxAttempts) {
      logger.warn(`Job ${jobId} has exhausted ${this.maxAttempts} attempts — needs manual attention`);
      return;
    }

    const entry = this.printerManager.driverFor(job.jobType);
    if (!entry) {
      const msg = `No configured printer for job type ${job.jobType}`;
      logger.error(msg);
      this.queue.markFailed(jobId, msg);
      await this._safeReport(jobId, job.jobType, "FAILED", msg);
      return;
    }

    this._processing.add(jobId);
    this.queue.markPrinting(jobId);
    await this._safeReport(jobId, job.jobType, "PRINTING");

    try {
      const online = await entry.driver.isOnline();
      if (!online) {
        throw new Error(`Printer "${entry.driver.id}" is offline`);
      }

      const lines = job.jobType === "KOT" ? renderKot(job) : renderBill(job);
      await entry.driver.printText(lines);

      this.queue.markPrinted(jobId);
      await this._safeReport(jobId, job.jobType, "PRINTED");
      logger.ok(`Printed ${job.jobType} job ${jobId} on "${entry.driver.id}"`);
    } catch (err) {
      this.queue.markFailed(jobId, err);
      await this._safeReport(jobId, job.jobType, "FAILED", err.message);
      logger.warn(`Print failed for job ${jobId} (${job.jobType}):`, err.message);
      // Left as FAILED in the queue — do not lose it. The retry sweep (or
      // the next reconnect reconciliation) will pick it up again, up to
      // maxAttempts, at which point it just sits there for a human to see
      // via getExhausted() rather than being retried forever.
    } finally {
      this._processing.delete(jobId);
    }
  }

  /** Periodic sweep — retries every eligible PENDING/FAILED job. Also how a
   * printer that just came back online gets its backlog cleared without
   * waiting for a fresh socket push. */
  async retrySweep() {
    const retryable = this.queue.getRetryable(this.maxAttempts);
    if (retryable.length === 0) return;
    logger.info(`Retry sweep: ${retryable.length} job(s) eligible`);
    for (const job of retryable) {
      await this.tryPrint(job.jobId);
    }
  }

  async _safeReport(jobId, jobType, status, error) {
    try {
      await this.reportStatus(jobId, jobType, status, error);
    } catch (err) {
      // Reporting failure must never crash printing — the backend will
      // catch up next time this print-service reconnects and reconciles.
      logger.warn(`Could not report status for job ${jobId} to backend:`, err.message);
    }
  }
}
