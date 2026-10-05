// src/socketClient.js
// ─────────────────────────────────────────────────────────────────────────────
// Everything the "SECURE SOCKET" leg of the architecture needs:
//   CENTRAL BACKEND → SECURE SOCKET → LOCAL PRINT SERVICE
//
// Auth: a printer-device key (see backend services/printerDeviceService.js),
// never a staff login — this process runs unattended, indefinitely, on a
// machine at the restaurant, so it gets its own narrowly-scoped credential
// that can be revoked independently of any human account.
//
// Reconnect handling: socket.io-client's built-in exponential backoff is
// used as-is (safe, well-tested defaults). The important part is what
// happens on every single connect event, including the very first one and
// every reconnect after a drop: we ALWAYS pull the current queue from the
// backend (via the get-queue socket ack) and feed every job through
// processor.ingest(), which is itself idempotent (see queue.js). This is
// what guarantees a reconnect can never cause a duplicate print, and can
// never silently miss a job that was created while we were offline.
// ─────────────────────────────────────────────────────────────────────────────
import { io } from "socket.io-client";
import { logger } from "./logger.js";

export class SocketClient {
  constructor({ backendUrl, printerKey, processor }) {
    this.backendUrl = backendUrl;
    this.printerKey = printerKey;
    this.processor = processor;
    this.socket = null;
    this.connected = false;
  }

  connect() {
    this.socket = io(this.backendUrl, {
      auth: { printerKey: this.printerKey },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      randomizationFactor: 0.5,
      transports: ["websocket", "polling"],
    });

    this.socket.on("connect", async () => {
      this.connected = true;
      logger.ok(`Connected to backend (${this.backendUrl}) — socket ${this.socket.id}`);
      await this.reconcileQueue();
    });

    this.socket.on("disconnect", (reason) => {
      this.connected = false;
      logger.warn(`Disconnected from backend: ${reason}. Reconnecting automatically…`);
      // socket.io-client does NOT reconnect by itself after a server-side
      // disconnect (e.g. the server restarting gracefully) — without this the
      // service would sit disconnected, printing nothing, until restarted.
      if (reason === "io server disconnect") setTimeout(() => this.socket.connect(), 2000);
    });

    this.socket.on("connect_error", (err) => {
      logger.error("Connection error:", err.message);
      // Say what to fix — this runs unattended and nothing prints until it connects.
      if (/printer key/i.test(err.message)) {
        logger.error("→ PRINTER_KEY in .env is wrong or revoked. Make a new one in Admin → Profile → Print service.");
      } else if (/namespace/i.test(err.message)) {
        logger.error("→ BACKEND_URL must be the server address only, e.g. https://your-server.com (no /api).");
      } else if (/xhr poll error|websocket error|ECONNREFUSED|timeout/i.test(err.message)) {
        logger.error(`→ Can't reach ${this.backendUrl}. Is the server running, and is BACKEND_URL in .env right?`);
      }
    });

    this.socket.on("reconnect_attempt", (n) => {
      logger.info(`Reconnect attempt #${n}…`);
    });

    // Live job pushes.
    this.socket.on("kot:created", (payload) => {
      this.processor.ingest({
        jobId: payload.jobId, jobType: "KOT",
        orderId: payload.orderId, tableNo: payload.tableNo, orderType: payload.orderType,
        items: payload.items, notes: payload.notes || "",
      });
    });

    this.socket.on("bill:print", (payload) => {
      if (!payload.jobId) return; // legacy shape without a job id — ignore, queue pull will catch up
      this.processor.ingest({
        jobId: payload.jobId, jobType: "BILL",
        orderId: payload.orderId, tableNo: payload.tableNo, orderType: payload.orderType,
        payload: payload.payload,
      });
    });

    return this;
  }

  /** Pull the backend's current view of the queue and feed every job through
   * ingest() — a no-op for anything we've already printed locally.
   *
   * `onlyNew` (the periodic poll, index.js): only jobs this service has
   * never seen. A job can be created on a backend instance this socket isn't
   * connected to (several servers / a local + a deployed one sharing the
   * database) — its live push never reaches us, so we'd otherwise only find
   * it on the next reconnect. Known jobs are left to the retry sweep and its
   * backoff, so polling never speeds up or repeats their attempts. */
  async reconcileQueue({ onlyNew = false } = {}) {
    if (!this.socket?.connected) return;
    if (this._reconciling) return; // a slow pull is still running — never overlap
    this._reconciling = true;
    try {
      const startedAt = Date.now();
      const { jobs, error } = await this._ack("get-queue", {});
      if (error) { logger.error("get-queue failed:", error); return; }
      const list = Array.isArray(jobs) ? jobs : [];
      const queue = this.processor.queue;

      // Done/skipped on the backend (admin "skip old jobs", marked printed by
      // hand, printed by another print-service) → never print it here.
      const dropped = queue.dropMissing(new Set(list.map((j) => j.jobId)), startedAt);
      for (const j of dropped) logger.info(`Not printing ${j.jobType} job ${j.jobId} — the server no longer lists it (skipped or already printed)`);

      // The poll: new jobs, plus ones we printed whose PRINTED report was
      // lost, plus ones we'd dropped that the server wants again.
      const todo = onlyNew
        ? list.filter((j) => !queue.has(j.jobId) || queue.isTerminal(j.jobId) || queue.get(j.jobId)?.status === "SKIPPED")
        : list;
      const fresh = todo.filter((j) => !queue.has(j.jobId)).length;
      if (!onlyNew || fresh) logger.info(`Reconciling ${onlyNew ? fresh : todo.length} job(s) from backend queue`);
      for (const job of todo) {
        await this.processor.ingest(job);
      }
    } catch (err) {
      logger.error("Queue reconciliation failed:", err.message);
    } finally {
      this._reconciling = false;
    }
  }

  async reportStatus(jobId, jobType, status, error) {
    if (!this.socket?.connected) {
      // Offline — the local queue already has the correct state (see
      // queue.js); the backend will be brought up to date on next connect
      // via reconcileQueue(), or by a human checking the admin dashboard.
      logger.warn(`Not connected — status for job ${jobId} (${status}) will sync once reconnected`);
      return;
    }
    this.socket.emit("report-job-status", { jobId, jobType, status, error });
  }

  _ack(event, payload, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`"${event}" timed out`)), timeoutMs);
      this.socket.emit(event, payload, (response) => {
        clearTimeout(timer);
        resolve(response || {});
      });
    });
  }
}
