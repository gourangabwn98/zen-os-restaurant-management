// src/processor.js
// ─────────────────────────────────────────────────────────────────────────────
// The heart of the print-service. Everything here is written to be testable
// without real hardware or a real socket connection — see test/processor.test.js,
// which exercises this exact module with a MockDriver and a fake reportStatus.
// ─────────────────────────────────────────────────────────────────────────────
import { renderKot } from "./renderers/kotRenderer.js";
import { renderBill } from "./renderers/billRenderer.js";
import { logger } from "./logger.js";

// KH-01 — copies per bill (single and combined). KOTs always print once.
export const BILL_COPIES = 2;

export class Processor {
  /**
   * @param {PrintQueue} queue
   * @param {PrinterManager} printerManager
   * @param {(jobId:string, jobType:string, status:string, error?:string) => Promise<void>} reportStatus
   * @param {{maxAttempts:number, logoProvider?:{get(url:string):Promise<object|null>},
   *          profileProvider?:{get():Promise<object>}, footer?:string,
   *          payQrProvider?:{forBill(payload:object, profile:object):Promise<object|null>}}} opts
   */
  constructor(queue, printerManager, reportStatus, opts = {}) {
    this.queue = queue;
    this.printerManager = printerManager;
    this.reportStatus = reportStatus;
    this.maxAttempts = opts.maxAttempts ?? 5;
    // FAILED-job backoff (queue.getRetryable); 0 = retry on every sweep.
    this.retryBaseDelayMs = opts.retryBaseDelayMs ?? 0;
    this.logoProvider = opts.logoProvider || null; // restaurant logo on bills (src/logo.js)
    this.profileProvider = opts.profileProvider || null; // header: name/address/phone (src/restaurantProfile.js)
    this.footer = opts.footer || "";
    this.payQrProvider = opts.payQrProvider || null; // "Scan & Pay" QR on unpaid bills (src/payQr.js)
    this.textImages = opts.textImages || null; // non-Latin text as images (src/textImage.js)
    this._processing = new Set(); // jobIds currently mid-print, in THIS process
    this._sweep = null; // the running retry sweep, if any (never two at once)
  }

  /**
   * Called whenever a job becomes known to us — a live socket push
   * (kot:created / bill:print) or a pull-reconciliation from
   * GET /admin/printer/queue after (re)connecting. Either path funnels
   * through here, and either path is a no-op if we've already printed it.
   */
  async ingest(job) {
    if (this.queue.isTerminal(job.jobId)) {
      // The backend still lists it, so our PRINTED report never reached it
      // (sent while disconnected) — send it again, or the admin keeps seeing
      // it as not printed and it comes back on every reconnect.
      logger.info(`Skipping job ${job.jobId} (${job.jobType}) — already printed`);
      await this._safeReport(job.jobId, job.jobType, "PRINTED");
      return;
    }
    const wasKnown = this.queue.has(job.jobId);
    this.queue.upsert({ ...job, status: job.status || "PENDING" });
    if (!wasKnown) logger.info(`Queued new ${job.jobType} job ${job.jobId}`);
    await this.tryPrint(job.jobId);
  }

  /** Restaurant header details, or null — never fails a print. */
  async _header() {
    if (!this.profileProvider) return null;
    try {
      return await this.profileProvider.get();
    } catch (err) {
      logger.warn("Header details skipped:", err.message);
      return null;
    }
  }

  /** The bill's "Scan & Pay" QR, or null — a QR problem never fails a bill. */
  async _payQrFor(job, header) {
    if (!this.payQrProvider || !header) return null;
    try {
      return await this.payQrProvider.forBill(job.payload || {}, header);
    } catch (err) {
      logger.warn("Payment QR skipped:", err.message);
      return null;
    }
  }

  /** The bill's logo bitmap, or null — a logo problem never fails a bill. */
  async _logoFor(job, header) {
    const url = (job.payload || {}).logoUrl || header?.logo;
    if (!this.logoProvider || !url) return null;
    try {
      return await this.logoProvider.get(url);
    } catch (err) {
      logger.warn("Logo skipped:", err.message);
      return null;
    }
  }

  /** Attempts to print exactly one job, exactly once, right now.
   * → "printed" | "offline" | "failed" | "skipped" (nothing to do). */
  async tryPrint(jobId) {
    if (this._processing.has(jobId)) return "skipped"; // already mid-flight in this process
    const job = this.queue.get(jobId);
    if (!job) return "skipped";
    if (job.status === "PRINTED" || job.status === "SKIPPED") return "skipped"; // never re-print

    if ((job.attempts || 0) >= this.maxAttempts) {
      logger.warn(`Job ${jobId} has exhausted ${this.maxAttempts} attempts — needs manual attention`);
      return "skipped";
    }

    const entry = this.printerManager.driverFor(job.jobType);
    if (!entry) {
      const msg = `No configured printer for job type ${job.jobType}`;
      logger.error(msg);
      this.queue.markFailed(jobId, msg);
      await this._safeReport(jobId, job.jobType, "FAILED", msg);
      return "failed";
    }

    this._processing.add(jobId);
    // Printer off / unplugged / out of paper → the job waits (no attempt used,
    // see queue.markWaiting); the retry sweep prints it once it's back.
    const online = await entry.driver.isOnline().catch(() => false);
    if (!online) {
      // Say WHY when the driver knows (e.g. USB support missing next to the
      // .exe) — "offline" alone sent people looking at a working printer.
      const why = entry.driver.lastProblem ? ` (${entry.driver.lastProblem})` : "";
      const msg = `Printer "${entry.driver.id}" is offline — waiting for it${why}`;
      if (job.lastError !== msg) logger.warn(`Job ${jobId} (${job.jobType}): ${msg}`);
      this.queue.markWaiting(jobId, msg);
      this._processing.delete(jobId);
      return "offline";
    }
    this.queue.markPrinting(jobId);
    await this._safeReport(jobId, job.jobType, "PRINTING");

    try {

      const header = await this._header();
      const width = entry.charsPerLine;
      let lines = job.jobType === "KOT"
        ? renderKot(job, { header, width })
        : renderBill(job, {
          header, width, footer: this.footer,
          logo: await this._logoFor(job, header),
          payQr: await this._payQrFor(job, header),
        });
      // Bengali/other non-Latin text → drawn as images (src/textImage.js).
      if (this.textImages) lines = await this.textImages.apply(lines, { charsPerLine: width });
      // KH-01: a bill prints BILL_COPIES identical copies (each ends with its
      // own cut) in ONE printer write — still one job, one status, one
      // PRINTED report, so the duplicate protection is unchanged. KOT: 1.
      if (job.jobType === "BILL") lines = Array.from({ length: BILL_COPIES }, () => lines).flat();
      await entry.driver.printText(lines);

      this.queue.markPrinted(jobId);
      await this._safeReport(jobId, job.jobType, "PRINTED");
      logger.ok(`Printed ${job.jobType} job ${jobId} on "${entry.driver.id}"`);
      return "printed";
    } catch (err) {
      this.queue.markFailed(jobId, err);
      await this._safeReport(jobId, job.jobType, "FAILED", err.message);
      logger.warn(`Print failed for job ${jobId} (${job.jobType}):`, err.message);
      // Left as FAILED in the queue — do not lose it. The retry sweep (or
      // the next reconnect reconciliation) will pick it up again, up to
      // maxAttempts, at which point it just sits there for a human to see
      // via getExhausted() rather than being retried forever.
      return "failed";
    } finally {
      this._processing.delete(jobId);
    }
  }

  /** Periodic sweep — retries every eligible PENDING/FAILED job. Also how a
   * printer that just came back online gets its backlog cleared without
   * waiting for a fresh socket push. Never runs twice at once (a slow print
   * must not let the next tick start a second pass over the same jobs); a
   * printer found offline is not asked again for the rest of this pass. */
  retrySweep() {
    if (this._sweep) return this._sweep;
    this._sweep = this._runSweep().finally(() => { this._sweep = null; });
    return this._sweep;
  }

  async _runSweep() {
    const retryable = this.queue.getRetryable(this.maxAttempts, { baseDelayMs: this.retryBaseDelayMs });
    if (retryable.length === 0) return;
    const offline = new Set();
    let tried = 0;
    for (const job of retryable) {
      const entry = this.printerManager.driverFor(job.jobType);
      if (entry && offline.has(entry)) continue;
      tried++;
      const outcome = await this.tryPrint(job.jobId);
      if (outcome === "offline" && entry) offline.add(entry);
    }
    if (tried && !(offline.size && tried === offline.size)) logger.info(`Retry sweep: ${retryable.length} job(s) eligible`);
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
