// src/queue.js
// ─────────────────────────────────────────────────────────────────────────────
// The local, disk-persisted print queue. This is what makes every one of the
// hard requirements possible:
//
//   - "A reconnect must never print the same job twice"
//       → every job is keyed by the backend's own job _id. Before printing
//         anything (whether pushed live over the socket or pulled from
//         GET /printer/queue on reconnect), we check this queue first. A
//         job already marked PRINTED here is skipped, full stop — it is
//         never re-sent to a printer, no matter how many times the backend
//         or the socket layer redelivers it.
//
//   - "If printer is offline, do not lose the order — keep the job
//      pending/failed and retry later"
//       → the queue is the durable record. A failed print attempt sets
//         status back to FAILED (never deleted), and it's picked up again
//         by the retry sweep. Nothing is ever silently dropped.
//
//   - "print-service restart" resilience
//       → the whole queue is written to disk after every state change, and
//         reloaded on startup. A restart mid-print just means that job is
//         re-evaluated (see recoverStuckJobs below) rather than lost.
//
// Persistence is a single JSON file, written atomically (temp file + rename)
// so a crash mid-write can't corrupt it.
// ─────────────────────────────────────────────────────────────────────────────
import fs from "fs";
import path from "path";
import { logger } from "./logger.js";

export class PrintQueue {
  constructor(filePath) {
    this.filePath = filePath;
    this.jobs = new Map(); // jobId -> job record
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
        for (const job of raw.jobs || []) this.jobs.set(job.jobId, job);
        logger.info(`Loaded ${this.jobs.size} job(s) from local queue (${this.filePath})`);
      } else {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      }
    } catch (err) {
      logger.error("Failed to load local queue, starting fresh:", err.message);
    }
  }

  _save() {
    try {
      const dir = path.dirname(this.filePath);
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ jobs: [...this.jobs.values()] }, null, 2));
      fs.renameSync(tmp, this.filePath); // atomic on POSIX filesystems
    } catch (err) {
      logger.error("Failed to persist local queue:", err.message);
    }
  }

  has(jobId) {
    return this.jobs.has(jobId);
  }

  get(jobId) {
    return this.jobs.get(jobId) || null;
  }

  /** Is this job already done, i.e. safe (mandatory, in fact) to skip? */
  isTerminal(jobId) {
    return this.get(jobId)?.status === "PRINTED";
  }

  /** Add a job we haven't seen before, or refresh metadata on one we have —
   * but never regress a locally-PRINTED job back to an earlier state. This
   * is what makes reconciling against the server's queue safe. */
  upsert(job) {
    const existing = this.jobs.get(job.jobId);
    if (existing?.status === "PRINTED") {
      return existing; // already done — never overwritten
    }
    const merged = {
      ...existing,
      ...job,
      status: job.status || existing?.status || "PENDING",
      attempts: existing?.attempts ?? job.attempts ?? 0,
      updatedAt: new Date().toISOString(),
      createdAt: existing?.createdAt || job.createdAt || new Date().toISOString(),
    };
    this.jobs.set(job.jobId, merged);
    this._save();
    return merged;
  }

  markPrinting(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    job.status = "PRINTING";
    job.updatedAt = new Date().toISOString();
    this._save();
    return job;
  }

  markPrinted(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    job.status = "PRINTED";
    job.printedAt = new Date().toISOString();
    job.lastError = "";
    this._save();
    return job;
  }

  markFailed(jobId, error) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    job.status = "FAILED";
    job.attempts = (job.attempts || 0) + 1;
    job.lastError = error?.message || String(error || "Unknown error");
    job.updatedAt = new Date().toISOString();
    this._save();
    return job;
  }

  /** On startup, any job left in PRINTING means the process died mid-print
   * (we can't know if the printer actually got the data or not). Treat it
   * as failed so it gets retried — safer to risk a rare double-print (which
   * a human notices immediately at the kitchen pass) than to silently lose
   * an order because we assumed success we never confirmed. */
  recoverStuckJobs() {
    let recovered = 0;
    for (const job of this.jobs.values()) {
      if (job.status === "PRINTING") {
        job.status = "FAILED";
        job.lastError = "Recovered after print-service restart (unconfirmed outcome)";
        recovered++;
      }
    }
    if (recovered > 0) {
      logger.warn(`Recovered ${recovered} job(s) stuck mid-print from a previous run`);
      this._save();
    }
  }

  /** Jobs eligible for a (re)print attempt right now, oldest first. */
  getRetryable(maxAttempts) {
    return [...this.jobs.values()]
      .filter((j) => (j.status === "PENDING" || j.status === "FAILED") && (j.attempts || 0) < maxAttempts)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }

  /** Jobs that have exhausted retries — surfaced for a human, never deleted. */
  getExhausted(maxAttempts) {
    return [...this.jobs.values()].filter((j) => j.status === "FAILED" && (j.attempts || 0) >= maxAttempts);
  }

  stats() {
    const all = [...this.jobs.values()];
    return {
      total: all.length,
      pending: all.filter((j) => j.status === "PENDING").length,
      printing: all.filter((j) => j.status === "PRINTING").length,
      printed: all.filter((j) => j.status === "PRINTED").length,
      failed: all.filter((j) => j.status === "FAILED").length,
    };
  }
}
