// test/integration.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Unlike processor.test.js (which drives Processor directly with fake
// callbacks), this spins up a REAL socket.io server on localhost and
// connects the REAL SocketClient class to it — exercising the actual auth
// handshake, the get-queue acknowledgement round-trip, live event delivery,
// and report-job-status, over an actual (loopback) network socket. This is
// the layer unit tests can't reach: wire-format mismatches, event name
// typos, and ack-callback plumbing between the two real modules.
// ─────────────────────────────────────────────────────────────────────────────
import assert from "node:assert/strict";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import os from "os";

import { SocketClient } from "../src/socketClient.js";
import { PrintQueue } from "../src/queue.js";
import { PrinterManager } from "../src/printerManager.js";
import { Processor } from "../src/processor.js";

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}`); console.error(`         ${err.stack}`); }
};

const VALID_KEY = "prn_integration_test_key";
const tmpFile = () => path.join(os.tmpdir(), `print-integration-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** A faithful-enough fake of the real backend's printer-auth + queue +
 * report-status contract (see server: sockets/socket.js). */
function startFakeBackend(initialQueue) {
  const httpServer = createServer();
  const io = new Server(httpServer, { cors: { origin: "*" } });
  const state = { reports: [], queue: initialQueue, connectedSockets: 0 };

  io.use((socket, next) => {
    const { printerKey } = socket.handshake.auth || {};
    if (printerKey !== VALID_KEY) return next(new Error("Invalid or revoked printer key"));
    next();
  });

  io.on("connection", (socket) => {
    state.connectedSockets++;
    socket.on("get-queue", (_payload, callback) => {
      if (typeof callback === "function") callback({ jobs: state.queue });
    });
    socket.on("report-job-status", (payload) => {
      state.reports.push(payload);
    });
    socket.on("disconnect", () => { state.connectedSockets--; });
  });

  return new Promise((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => {
      const port = httpServer.address().port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        io, state,
        close: () => new Promise((r) => { io.close(); httpServer.close(() => r()); }),
      });
    });
  });
}

function makeClientStack() {
  const manager = new PrinterManager(
    [{ id: "kitchen", role: "KOT", type: "LAN", startOnline: true }],
    { useMock: true }
  );
  const queue = new PrintQueue(tmpFile());
  let socketClient;
  const processor = new Processor(
    queue, manager,
    (jobId, jobType, status, error) => socketClient.reportStatus(jobId, jobType, status, error),
    { maxAttempts: 3 }
  );
  return { manager, queue, processor, driver: manager.drivers[0].driver, setClient: (c) => (socketClient = c) };
}

const run = async () => {
  console.log("── Real Socket.IO integration ──────────────────────────────");

  await test("connects successfully with a valid printer key", async () => {
    const backend = await startFakeBackend([]);
    const { processor, setClient } = makeClientStack();
    const client = new SocketClient({ backendUrl: backend.url, printerKey: VALID_KEY, processor }).connect();
    setClient(client);

    await wait(400);
    assert.equal(client.connected, true);
    assert.equal(backend.state.connectedSockets, 1);

    client.socket.disconnect();
    await backend.close();
  });

  await test("rejects an invalid printer key", async () => {
    const backend = await startFakeBackend([]);
    const { processor, setClient } = makeClientStack();
    const client = new SocketClient({ backendUrl: backend.url, printerKey: "prn_totally_wrong", processor }).connect();
    setClient(client);

    await wait(400);
    assert.equal(client.connected, false, "must not report connected with a bad key");

    client.socket.disconnect();
    await backend.close();
  });

  await test("on connect, pulls the backend queue via get-queue and prints what's pending", async () => {
    const backend = await startFakeBackend([
      { jobId: "int-1", jobType: "KOT", status: "PENDING", orderId: "ORD00001", items: [{ name: "Dosa", qty: 1 }] },
    ]);
    const { processor, queue, driver, setClient } = makeClientStack();
    const client = new SocketClient({ backendUrl: backend.url, printerKey: VALID_KEY, processor }).connect();
    setClient(client);

    await wait(600); // allow connect + async reconcileQueue to finish
    assert.equal(queue.get("int-1")?.status, "PRINTED");
    assert.equal(driver.printedJobs.length, 1);
    assert.ok(backend.state.reports.some((r) => r.jobId === "int-1" && r.status === "PRINTED"), "must report PRINTED back to the backend");

    client.socket.disconnect();
    await backend.close();
  });

  await test("a live kot:created push is printed immediately", async () => {
    const backend = await startFakeBackend([]);
    const { processor, queue, driver, setClient } = makeClientStack();
    const client = new SocketClient({ backendUrl: backend.url, printerKey: VALID_KEY, processor }).connect();
    setClient(client);
    await wait(400);

    backend.io.emit("kot:created", { jobId: "int-2", jobType: "KOT", orderId: "ORD00002", items: [{ name: "Idli", qty: 2 }] });
    await wait(300);

    assert.equal(queue.get("int-2")?.status, "PRINTED");
    assert.equal(driver.printedJobs.length, 1);

    client.socket.disconnect();
    await backend.close();
  });

  await test("a live kot:created push keeps the customer phone/name, area and per-area table number", async () => {
    const backend = await startFakeBackend([]);
    const { processor, queue, driver, setClient } = makeClientStack();
    const client = new SocketClient({ backendUrl: backend.url, printerKey: VALID_KEY, processor }).connect();
    setClient(client);
    await wait(400);

    // Exactly the shape the backend emits (sockets/socket.js emitKotCreated).
    backend.io.emit("kot:created", {
      jobId: "int-ph", jobType: "KOT", orderId: "ORD00142", orderType: "DINE_IN", tableNo: 23,
      diningArea: "AC_ROOM", tableName: "Indoor-AC 2", tableDisplayNo: 2,
      customerName: "Rahul", customerPhone: "9876543210", items: [{ name: "Biryani", qty: 1 }],
    });
    backend.io.emit("kot:created", {
      jobId: "int-ta", jobType: "KOT", orderId: "ORD00143", orderType: "TAKEAWAY", tableNo: null,
      customerName: "Priya", customerPhone: "9123456780", items: [{ name: "Tea", qty: 1 }],
    });
    await wait(400);

    assert.equal(queue.get("int-ph")?.status, "PRINTED");
    assert.equal(queue.get("int-ta")?.status, "PRINTED");
    const texts = driver.printedJobs.map((lines) => lines.map((l) => l.text || "").join("\n"));
    const ac = texts.find((t) => t.includes("ORD00142"));
    assert.match(ac, /Customer {3}: +Rahul/);
    assert.match(ac, /Phone {6}: +9876543210/);
    assert.match(ac, /Type {7}: +Indoor-AC$/m);
    assert.match(ac, /Table {6}: +2$/m, "per-area number, not the internal 23");
    const ta = texts.find((t) => t.includes("ORD00143"));
    assert.match(ta, /Phone {6}: +9123456780/);
    assert.match(ta, /Type {7}: +Takeaway/);
    assert.doesNotMatch(ta, /Table {6}:/);

    // A push without customer details still prints, with no empty lines for them.
    backend.io.emit("kot:created", { jobId: "int-np", jobType: "KOT", orderId: "ORD00144", orderType: "TAKEAWAY", items: [{ name: "Tea", qty: 1 }] });
    await wait(300);
    const np = driver.printedJobs.map((lines) => lines.map((l) => l.text || "").join("\n")).find((t) => t.includes("ORD00144"));
    assert.doesNotMatch(np, /Phone {6}:|Customer {3}:|undefined|null/);

    client.socket.disconnect();
    await backend.close();
  });

  await test("reconnect never reprints: backend still lists an already-printed job, client must skip it", async () => {
    const backend = await startFakeBackend([
      { jobId: "int-3", jobType: "KOT", status: "PENDING", orderId: "ORD00003", items: [{ name: "Vada", qty: 1 }] },
    ]);
    const { processor, queue, driver, setClient } = makeClientStack();
    const client = new SocketClient({ backendUrl: backend.url, printerKey: VALID_KEY, processor }).connect();
    setClient(client);

    await wait(600);
    assert.equal(driver.printedJobs.length, 1, "sanity: printed once on first connect");
    assert.equal(queue.get("int-3")?.status, "PRINTED");

    // Simulate the backend not yet having processed our status report (or a
    // genuine reconnect) — it still shows the job as PENDING. Force a
    // reconnect by disconnecting the transport and letting socket.io's
    // built-in reconnection bring it back up.
    client.socket.io.engine.close();
    await wait(1500); // allow reconnection + reconcileQueue to run again

    assert.equal(driver.printedJobs.length, 1, "must still be exactly one physical print after reconnect");
    assert.equal(queue.get("int-3")?.status, "PRINTED");

    client.socket.disconnect();
    await backend.close();
  });

  console.log("──────────────────────────────────────────────");
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) { console.error("SOME TESTS FAILED"); process.exit(1); }
  console.log("ALL TESTS PASSED");
};

run();
