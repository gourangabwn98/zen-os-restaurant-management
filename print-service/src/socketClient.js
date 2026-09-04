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
    });

    this.socket.on("connect_error", (err) => {
      logger.error("Connection error:", err.message);
    });

    this.socket.on("reconnect_attempt", (n) => {
      logger.info(`Reconnect attempt #${n}…`);
    });

    // Live job pushes.
    this.socket.on("kot:created", (payload) => {
      this.processor.ingest({
        jobId: payload.jobId, jobType: "KOT",
        orderId: payload.orderId, tableNo: payload.tableNo, orderType: payload.orderType,
        items: payload.items,
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
   * ingest() — a no-op for anything we've already printed locally. */
  async reconcileQueue() {
    if (!this.socket?.connected) return;
    try {
      const { jobs, error } = await this._ack("get-queue", {});
      if (error) { logger.error("get-queue failed:", error); return; }
      logger.info(`Reconciling ${jobs.length} job(s) from backend queue`);
      for (const job of jobs) {
        await this.processor.ingest(job);
      }
    } catch (err) {
      logger.error("Queue reconciliation failed:", err.message);
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
