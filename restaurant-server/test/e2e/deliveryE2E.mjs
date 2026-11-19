// test/e2e/deliveryE2E.mjs — end-to-end home delivery against the LOCAL
// SANDBOX (scripts/localSandbox.js), through the real HTTP API and Socket.IO
// exactly as the admin, customer and delivery apps use them.
//
//   1) node scripts/localSandbox.js            (separate terminal)
//   2) CUSTOMER_JWT=<from the sandbox banner> node test/e2e/deliveryE2E.mjs
//
// Not a *.test.js file on purpose: it needs the sandbox running. It refuses any
// API that isn't on localhost / 127.0.0.1 — it can never hit production.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const API = process.env.E2E_API || "http://localhost:5055/api";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/api$/.test(API)) throw new Error(`Refusing non-local API ${API}`);
const ROOT = API.replace(/\/api$/, "");
const CUSTOMER_JWT = process.env.CUSTOMER_JWT;
if (!CUSTOMER_JWT) throw new Error("Set CUSTOMER_JWT (printed by the sandbox)");
// socket.io-client is a dependency of the admin app (no new install needed here).
const { io } = createRequire(new URL("../../../admin/package.json", import.meta.url))("socket.io-client");

let passed = 0, failed = 0;
const step = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.stack || err.message}`); throw err; }
};
const call = async (method, path, { token, body } = {}) => {
  const res = await fetch(API + path, {
    method, headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
};
const ok = async (method, path, opts) => {
  const r = await call(method, path, opts);
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const connect = (auth) => new Promise((resolve, reject) => {
  const s = io(ROOT, { auth, transports: ["websocket"], forceNew: true });
  s.events = [];
  s.onAny((ev, payload) => s.events.push({ ev, payload }));
  s.on("connect", () => resolve(s));
  s.on("connect_error", reject);
});
const waitFor = async (sock, ev, pred = () => true, ms = 8000) => {
  const t0 = Date.now();
  for (;;) {
    const hit = sock.events.find((e) => e.ev === ev && pred(e.payload));
    if (hit) return hit.payload;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${ev}`);
    await sleep(100);
  }
};
const staffLogin = async (phone) => {
  const sent = await ok("POST", "/auth/employee/send-otp", { body: { phone } });
  assert.match(String(sent.otp), /^\d{6}$/, "sandbox echoes the OTP");
  return ok("POST", "/auth/employee/verify-otp", { body: { phone, otp: sent.otp } });
};

const sockets = [];
try {
  console.log("── Zen OS delivery E2E (local sandbox) ──");
  let admin, riderA, riderB, sA, sB, sAdmin, menu, order, job, mine;

  await step("admin logs in by OTP", async () => {
    const sent = await ok("POST", "/auth/admin/send-otp", { body: { phone: "9000000001" } });
    admin = await ok("POST", "/auth/admin/verify-otp", { body: { phone: "9000000001", otp: sent.otp } });
    assert.ok(admin.token);
  });

  await step("admin registers two delivery partners (Employees)", async () => {
    for (const [name, phone] of [["Asif Rider", "9000000021"], ["Bina Rider", "9000000022"]]) {
      const e = await ok("POST", "/admin/employees", { token: admin.token, body: { name, phone, role: "delivery" } });
      assert.equal((e.employee || e).role, "delivery");
    }
    const dup = await call("POST", "/admin/employees", { token: admin.token, body: { name: "Dup", phone: "9000000021", role: "delivery" } });
    assert.equal(dup.status, 409, "same phone can't be registered twice");
  });

  await step("partners log in with the same employee OTP flow and get role 'delivery'", async () => {
    riderA = await staffLogin("9000000021");
    riderB = await staffLogin("9000000022");
    assert.equal(riderA.role, "delivery");
    // A rider token is useless on staff endpoints.
    assert.equal((await call("GET", "/admin/orders", { token: riderA.token })).status, 403);
    assert.equal((await call("GET", "/delivery/admin/overview", { token: riderA.token })).status, 403);
  });

  await step("partners connect (own room only) and go online", async () => {
    sA = await connect({ token: riderA.token }); sB = await connect({ token: riderB.token });
    sAdmin = await connect({ token: admin.token });
    sockets.push(sA, sB, sAdmin);
    for (const r of [riderA, riderB]) {
      const on = await ok("POST", "/delivery/me/online", { token: r.token, body: { online: true } });
      assert.equal(on.state.online, true);
      assert.equal(on.state.capacity, 3, "default capacity 3");
    }
  });

  await step("checkout offers COD by default (PhonePe not configured)", async () => {
    const prof = await ok("GET", "/admin/restaurant/profile");
    const dp = (prof.data || prof).deliveryPayment;
    assert.deepEqual(dp.methods, ["Cash"]);
    assert.equal(dp.defaultMethod, "Cash");
  });

  await step("customer places a Home Delivery order with COD", async () => {
    menu = await ok("GET", "/menu");
    const items = (menu.data || menu.items || menu);
    const momo = (Array.isArray(items) ? items : items.items).find((m) => m.name === "Chicken Momo");
    order = await ok("POST", "/orders", {
      token: CUSTOMER_JWT,
      body: {
        items: [{ menuItemId: momo._id, qty: 2 }], orderType: "ONLINE", paymentMethod: "Cash", idempotencyKey: `e2e-${Date.now()}`,
        delivery: { address: "22 Camac Street, Kolkata", landmark: "near the ATM", latitude: 22.5465, longitude: 88.3530, contactName: "Asha", contactPhone: "9000000099" },
      },
    });
    assert.equal(order.status, "PENDING_CONFIRMATION");
    assert.equal(order.paymentMethod, "Cash");
    // Outside the 6 km range → refused.
    const far = await call("POST", "/orders", { token: CUSTOMER_JWT, body: {
      items: [{ menuItemId: momo._id, qty: 1 }], orderType: "ONLINE", idempotencyKey: `e2e-far-${Date.now()}`,
      delivery: { address: "Far away road", latitude: 22.80, longitude: 88.36, contactPhone: "9000000099" } } });
    assert.equal(far.status, 403);
  });

  await step("restaurant confirms → backend broadcasts to BOTH online partners (socket)", async () => {
    await ok("PATCH", `/orders/${order._id}/confirm`, { token: admin.token });
    const [oa, ob] = await Promise.all([
      waitFor(sA, "delivery:request_received"), waitFor(sB, "delivery:request_received"),
    ]);
    assert.equal(oa.offer.orderNo, order.orderId);
    assert.equal(oa.offer.cod, true);
    const s = JSON.stringify(oa.offer);
    assert.ok(!s.includes("Asha") && !s.includes("9000000099") && !s.includes("Camac"), "no customer PII before acceptance");
    job = { jobId: oa.offer.jobId };
    void ob;
  });

  await step("both accept at the same instant → exactly one wins; the other is told it's taken", async () => {
    const [ra, rb] = await Promise.all([
      call("POST", `/delivery/offers/${job.jobId}/accept`, { token: riderA.token }),
      call("POST", `/delivery/offers/${job.jobId}/accept`, { token: riderB.token }),
    ]);
    const wins = [ra, rb].filter((r) => r.status === 200);
    assert.equal(wins.length, 1, `statuses ${ra.status}/${rb.status}`);
    const lose = ra.status === 200 ? rb : ra;
    assert.equal(lose.status, 409);
    assert.equal(lose.data.code, "ALREADY_ASSIGNED");
    if (ra.status !== 200) { [riderA, riderB] = [riderB, riderA]; [sA, sB] = [sB, sA]; } // A = winner from here on
    await waitFor(sB, "delivery:already_assigned", (p) => p.jobId === job.jobId);
    const me = await ok("GET", "/delivery/me", { token: riderA.token });
    assert.equal(me.activeJobs.length, 1);
    assert.equal(me.activeJobs[0].payment.collectCash, true);
    assert.equal(me.activeJobs[0].drop.contactPhone, "9000000099", "address + phone revealed only after acceptance");
    assert.equal((await ok("GET", "/delivery/me", { token: riderB.token })).state.activeCount, 0);
  });

  await step("customer gets a tracking link + OTP (owner only); public link never shows them", async () => {
    mine = await ok("GET", `/delivery/orders/${order._id}`, { token: CUSTOMER_JWT });
    assert.match(mine.otp, /^\d{4}$/);
    assert.ok(mine.trackingToken);
    const pub = await ok("GET", `/delivery/track/${mine.trackingToken}`);
    const s = JSON.stringify(pub);
    assert.ok(!s.includes(mine.otp) && !s.includes("9000000099") && !s.includes(riderA.phone), "no OTP / phones publicly");
    assert.equal((await call("GET", `/delivery/orders/${order._id}`, { token: riderB.token })).status, 403);
  });

  let sCust;
  await step("pickup is blocked until the kitchen marks the order READY", async () => {
    await ok("POST", `/delivery/jobs/${job.jobId}/arrived-restaurant`, { token: riderA.token });
    const early = await call("POST", `/delivery/jobs/${job.jobId}/picked-up`, { token: riderA.token });
    assert.equal(early.status, 409);
    assert.equal(early.data.code, "ORDER_NOT_READY");
    await ok("PUT", `/admin/orders/${order._id}/status`, { token: admin.token, body: { status: "PREPARING" } });
    await ok("PUT", `/admin/orders/${order._id}/status`, { token: admin.token, body: { status: "READY" } });
    await waitFor(sA, "delivery:job_updated", (p) => p.job?.canPickUp === true);
    await ok("POST", `/delivery/jobs/${job.jobId}/picked-up`, { token: riderA.token });
  });

  await step("customer tracks live over Socket.IO with only the link (no login)", async () => {
    sCust = await connect({});
    sockets.push(sCust);
    const ack = await new Promise((r) => sCust.emit("join-tracking", { token: mine.trackingToken }, r));
    assert.equal(ack.ok, true);
    const bad = await new Promise((r) => sCust.emit("join-tracking", { token: mine.trackingToken.slice(0, -2) + "xx" }, r));
    assert.equal(bad.ok, false, "tampered token joins nothing");
    const now = Date.now();
    const pts = [0, 1, 2].map((i) => ({ latitude: 22.5500 - i * 0.0010, longitude: 88.3525, accuracy: 8, at: new Date(now - (2 - i) * 5000).toISOString() }));
    const r = await ok("POST", "/delivery/me/locations", { token: riderA.token, body: { points: pts } });
    assert.equal(r.accepted, 3);
    assert.equal(r.tracking, true);
    const loc = await waitFor(sCust, "delivery:location_updated");
    assert.deepEqual(Object.keys(loc).sort(), ["jobId", "location"]);
    const pub = await ok("GET", `/delivery/track/${mine.trackingToken}`);
    assert.equal(pub.status, "PICKED_UP");
    assert.ok(pub.rider.location, "rider marker position");
    await waitFor(sAdmin, "delivery:location_updated");
  });

  await step("OTP: wrong code refused; COD needs the exact amount; then DELIVERED + one cash record", async () => {
    const wrong = mine.otp === "0000" ? "1111" : "0000";
    const w = await call("POST", `/delivery/jobs/${job.jobId}/deliver`, { token: riderA.token, body: { otp: wrong, cashCollected: true, cashAmount: order.total } });
    assert.equal(w.data.code, "OTP_WRONG");
    const noCash = await call("POST", `/delivery/jobs/${job.jobId}/deliver`, { token: riderA.token, body: { otp: mine.otp } });
    assert.equal(noCash.data.code, "COD_CONFIRM_REQUIRED");
    const done = await ok("POST", `/delivery/jobs/${job.jobId}/deliver`, { token: riderA.token, body: { otp: mine.otp, cashCollected: true, cashAmount: order.total } });
    assert.equal(done.job.status, "DELIVERED");
    const again = await call("POST", `/delivery/jobs/${job.jobId}/deliver`, { token: riderA.token, body: { otp: mine.otp, cashCollected: true, cashAmount: order.total } });
    assert.equal(again.status, 409, "duplicate hand-over refused");
    const cash = await ok("GET", "/delivery/me/cash", { token: riderA.token });
    assert.equal(cash.total, order.total);
    const r = await ok("POST", "/delivery/me/locations", { token: riderA.token, body: { points: [{ latitude: 22.546, longitude: 88.353, at: new Date().toISOString() }] } });
    assert.equal(r.tracking, false, "GPS stops once nothing is active");
    assert.equal((await ok("GET", "/delivery/me", { token: riderA.token })).activeJobs.length, 0);
  });

  await step("order is DELIVERED but unpaid until the admin verifies the cash hand-in", async () => {
    const o = await ok("GET", `/orders/${order._id}`, { token: CUSTOMER_JWT });
    const ord = o.order || o;
    assert.equal(ord.status, "DELIVERED");
    assert.notEqual(ord.paymentStatus, "PAID");
  });

  await step("admin inspects COD + history, verifies → existing billing settles: PAID, SETTLED, COMPLETED", async () => {
    const list = await ok("GET", "/delivery/admin/cod?status=COLLECTED", { token: admin.token });
    assert.equal(list.collections.length, 1);
    assert.equal(list.cashWithRiders[0].amount, order.total);
    const events = await ok("GET", `/delivery/admin/jobs/${job.jobId}/events`, { token: admin.token });
    const types = events.events.map((e) => e.type);
    for (const t of ["JOB_CREATED", "BROADCAST", "ACCEPTED", "AT_RESTAURANT", "PICKED_UP", "OTP_FAILED", "COD_COLLECTED", "DELIVERED"]) assert.ok(types.includes(t), `audit has ${t}`);
    const v = await ok("POST", `/delivery/admin/cod/${list.collections[0].id}/verify`, { token: admin.token });
    assert.deepEqual(v.completed, [order.orderId]);
    const o = await ok("GET", `/orders/${order._id}`, { token: CUSTOMER_JWT });
    const ord = o.order || o;
    assert.equal(ord.status, "COMPLETED");
    assert.equal(ord.paymentStatus, "PAID");
    assert.equal(ord.billStatus, "SETTLED");
    const rep = await ok("GET", "/delivery/admin/reports", { token: admin.token });
    assert.equal(rep.totals.delivered, 1);
    assert.equal(rep.cod.verified, order.total);
  });

  await step("offline partner gets no request; reassignment before pickup goes back to the broadcast", async () => {
    await ok("POST", "/delivery/me/online", { token: riderB.token, body: { online: false } });
    sA.events.length = 0; sB.events.length = 0;
    const momo = (Array.isArray(menu.data || menu) ? (menu.data || menu) : (menu.data || menu).items).find((m) => m.name === "Veg Thali");
    const o2 = await ok("POST", "/orders", { token: CUSTOMER_JWT, body: {
      items: [{ menuItemId: momo._id, qty: 1 }], orderType: "ONLINE", idempotencyKey: `e2e2-${Date.now()}`,
      delivery: { address: "5 Elgin Road, Kolkata", latitude: 22.537, longitude: 88.350, contactPhone: "9000000099" } } });
    await ok("PATCH", `/orders/${o2._id}/confirm`, { token: admin.token });
    const offer = await waitFor(sA, "delivery:request_received");
    await sleep(500);
    assert.equal(sB.events.filter((e) => e.ev === "delivery:request_received").length, 0, "offline rider not offered");
    await ok("POST", `/delivery/offers/${offer.offer.jobId}/accept`, { token: riderA.token });
    await ok("POST", `/delivery/admin/jobs/${offer.offer.jobId}/unassign`, { token: admin.token, body: { reason: "E2E reassign" } });
    await waitFor(sA, "delivery:job_removed", (p) => p.jobId === offer.offer.jobId);
    const board = await ok("GET", "/delivery/admin/jobs?status=SEARCHING", { token: admin.token });
    assert.ok(board.jobs.some((j) => j.jobId === offer.offer.jobId));
    await ok("POST", `/delivery/admin/jobs/${offer.offer.jobId}/cancel`, { token: admin.token, body: { reason: "E2E cleanup" } });
  });

  await step("idempotent order placement: the same key twice → one order", async () => {
    const momo = (Array.isArray(menu.data || menu) ? (menu.data || menu) : (menu.data || menu).items).find((m) => m.name === "Masala Chai");
    const key = `e2e-dup-${Date.now()}`;
    const body = { items: [{ menuItemId: momo._id, qty: 1 }], orderType: "ONLINE", idempotencyKey: key,
      delivery: { address: "5 Elgin Road, Kolkata", latitude: 22.537, longitude: 88.350, contactPhone: "9000000099" } };
    const [a, b] = await Promise.all([ok("POST", "/orders", { token: CUSTOMER_JWT, body }), ok("POST", "/orders", { token: CUSTOMER_JWT, body })]);
    assert.equal(a._id, b._id);
  });
} catch {
  /* reported by step() */
} finally {
  sockets.forEach((s) => s.close());
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
