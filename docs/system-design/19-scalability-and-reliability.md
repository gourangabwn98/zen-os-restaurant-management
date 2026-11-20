# 19 — Scalability and Reliability

Analysis only — no redesign. Recommendations are in [23](23-architecture-recommendations.md).

## 1. Load profile vs capacity

At ~200 orders/day (peak maybe 30–60/hour), a single Node process and a small Atlas cluster are far from limits: each order is a handful of documents (Order, TableSession, KOTJob, StockLedger rows), ticks poll indexed queries every 5–60 s, sockets number in the tens. **Throughput is not the concern; availability and correctness under failure are.** (Medium — no load test exists; `test/menuOrderPerf.test.js` is the only perf-flavoured test.)

Watch items as history grows: `Order` lacks an index on `user` and compound indexes for tick queries (`{status, autoPrepareAt}`, `{status, paymentDeadline}`); `KOTJob`/`BillPrintJob` queue queries by `status` without an index on `BillPrintJob`/`KOTJob.status`; admin list endpoints over date ranges use `createdAt` indexes (good).

## 2. Scenario analysis

| Scenario | Behaviour today | Evidence | Rating |
|---|---|---|---|
| Multiple devices / simultaneous users | fine; RBAC + rooms | | Good |
| Concurrent order updates | optimistic `revision`; atomic conditional transitions (409 on lost race); transactions for kitchen send | `orderService` | Good |
| Duplicate requests | idempotencyKey on place; KOT unique; payment `$ne PAID`; combined-bill requestKey; delivery unique indexes; V3 requestKey | | Good (single bill print lacks key) |
| Double confirm / double settle | conditional filters | `confirmOrderTx`, `settleBills` | Good |
| Printer failure | job waits, retries; skipped after 30 min | print-service, `printerDeviceService` | Fair (silent skip R-09) |
| Print PC down | no printing; KOT still on kitchen screen; backlog skipped after 30 min | | Fair |
| Internet outage at restaurant (cloud mode) | staff apps read-only; no new orders; no printing; customers' own data cannot reach backend | `savedData.js` | **Poor** |
| Internet outage (LOCAL mode) | staff operations continue on LAN; no cloud visibility | O1/O2 | Good for staff, customers blocked until O3 |
| Backend outage (Render) | everything stops; no fallback | | Poor (SPOF) |
| Database outage | requests 500/503; ticks log; reconnect on next call | `config/db.js` | Fair |
| Backend restart mid-operation | transactions roll back; ticks resume; in-memory OTPs lost; rate-limit maps reset | | Fair |
| Multiple backend instances | writes safe (atomic), but socket events not shared (no adapter), category-reset marker per process, OTP cache per process → login can fail across instances | | Not supported |
| Multi-device synchronization | via server + sockets; missed events → apps re-fetch | | Fair |
| Clock skew | server clock authoritative (coupons, schedules, edit window); `TZ` should be set (startup warning) | `securityCheck.js` | Good |

## 3. Single points of failure

1. Cloud backend (single Render service) — all functions.
2. Restaurant internet link (cloud mode) — ordering, printing.
3. Print PC (one `SohojPrintService.exe`) — all paper output.
4. Restaurant PC in LOCAL mode — everything, with manual backups only.
5. Firebase (logins) and SMS providers (staff OTP) in cloud mode.
6. Atlas cluster (backup posture unknown).

## 4. Reliability strengths

Consistent use of atomic conditional writes, unique indexes and transactions; append-only audit collections; durable print queue with reconcile; background ticks idempotent and multi-instance safe; startup configuration checks that fail closed.
