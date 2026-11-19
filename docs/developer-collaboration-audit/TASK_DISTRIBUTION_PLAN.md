# Zen OS — Task Distribution Plan

Audit date 2026-11-19. Each task is designed so the contractor works against **contracts + staging**, and the **owner** owns integration into `zen-os-core`. Payment is tied to accepted milestones.

Order of engagement (recommended): **B first** (most isolated, existing design docs), **C second** (clean seam), **A last** (highest exposure; benefits from contracts proven by B and C).

---

## Owner prerequisites (before any contractor starts)

| # | Owner task | Why |
|---|---|---|
| P1 | Rotate the committed printer keys; complete PROJECT_SECURITY_AUDIT §6 | Leaked credentials |
| P2 | Create the GitHub org + repos per REPOSITORY_ISOLATION_STRATEGY | Isolation |
| P3 | Stand up staging + synthetic seed per DEVELOPMENT_ENVIRONMENT_STRATEGY | No production use |
| P4 | Write `zen-os-contracts` v0.1: enums, print contract + golden fixtures, payment adapter interface, realtime event catalogue | Contractors can't start without them |
| P5 | Fix S-1 (PII on anonymous socket room) and S-2 (`/api/test-whatsapp`) | Contractors will see them on staging/production |
| P6 | Legal pack signed (NDA + services agreement with IP assignment) | IP |

---

## B. Android mobile thermal printing — Developer B

**Existing assets:** `docs/audit/zen-os-android-print-agent-{architecture,integration-contract,implementation-roadmap}.md` and the feasibility report (LAN-first, USB OTG as a later phase, Windows service kept as fallback). A Gradle project `D:\Adds_cafe\ZenOS-Android-Printer` exists outside this repo (not inspected) — the owner reviews it for keys/data before using it as a seed.

| Item | Detail |
|---|---|
| Scope | Android app/agent that (1) enrolls with a staging printer-device key, (2) receives KOT/bill jobs (socket `kot:created`, `bill:print`, `get-queue` reconcile) per contract, (3) prints over **LAN (TCP 9100)** first, then **Bluetooth (SPP)**, then **USB OTG**, (4) reports status via `PATCH /admin/printer/kot/:id/status` semantics, (5) persists a local queue keyed by backend job `_id` (never print twice, never lose a job — mirrors `print-service/src/queue.js` contract) |
| Inputs given | Print contract + JSON schemas, golden ESC/POS fixtures and photos (58/80 mm KOT, bill, change slip, Bengali text-as-image, logo, pay QR), staging URL + device key, test printers |
| Not given | Backend source, print-service source (unless fixtures prove insufficient → extract `renderers/` only), restaurant hardware/keys |
| Owner's side | Any backend change the contract requires (e.g., device type field, lease/ack endpoint) — written by owner in core |
| Milestones | **B1** compatibility matrix + POC printing a golden KOT over LAN from a phone · **B2** production-quality LAN agent with durable queue, reconnect reconciliation, foreground service/battery-optimisation handling · **B3** Bluetooth · **B4** USB OTG · **B5** pilot hardening |
| Acceptance | Byte/visual parity with golden fixtures on 2+ printer models per transport; zero duplicate prints across 100 forced disconnect/app-kill cycles; no lost jobs across reboot; works on Android 10–15 target devices; no secrets in repo; signed release built **by owner** from tagged source; README + test plan |
| Out of scope | Changing the Windows print-service; production rollout (owner) |

## C. Payment gateway integration — Developer C

**Existing assets:** PhonePe PG already integrated using the salt-key `/pg/v1/pay` + `/pg/v1/status` flow (`restaurant-server/services/paymentService.js`), callback verified by `X-VERIFY`, atomic `applyPhonePeResult`, pay-first order state. **No refund or reconciliation code exists** (0 matches for "refund").

| Item | Detail |
|---|---|
| Scope | (1) Written evaluation of Indian gateways (e.g., Razorpay, Cashfree, PhonePe PG's newer API, PayU, Paytm) on MDR, settlement time, UPI intent/collect support, refunds API, webhook signing, sandbox quality, KYC for small restaurants; also confirm whether PhonePe's salt-key v1 flow remains supported for new merchants · (2) a **gateway adapter package** implementing the contract interface for the chosen provider(s): `initiate`, `checkStatus`, `verifyWebhook`, `decodeWebhook`, `refund`, `refundStatus`, `mapStatus` → normalized result · (3) reconciliation **spec** (settlement report format → matching rules) |
| Inputs given | Adapter interface + normalized result spec, rules ("amount always from server-side order total", "only a checksum/signature-verified SUCCESS may mark PAID", "FAILED leaves order payable by cash", idempotency via provider txn id), extracted PhonePe provider functions as reference, staging URL, customer test logins |
| Not given | Live keys, merchant dashboards, `Order` model, `applyPhonePeResult`, `payFirstService`, customer app source |
| Owner's side | Wiring the adapter into `paymentService`/`paymentController`/routes, refund admin action, reconciliation job reading `Order`, customer UI |
| Milestones | **C1** evaluation report + recommendation · **C2** adapter with sandbox integration tests · **C3** refunds + webhook replay/duplicate tests · **C4** reconciliation spec + parser for the provider's settlement file |
| Acceptance | 100% of adapter functions unit-tested with recorded sandbox fixtures; signature verification uses constant-time compare and rejects tampered bodies; duplicate/out-of-order webhooks are no-ops at the adapter level; no secret in code, logs or tests; amounts in integer paise; no client-supplied amount accepted anywhere; works with Node version used by core |
| Out of scope | Changing manual UPI / cash / split-payment flows (must keep working unchanged) |

## A. Offline capability & synchronization — Developer A

**Existing assets:** `feature/offline-first` adds PWA shells and a read-only "last loaded data" cache + offline banner for waiter/kitchen/admin (`src/offline/*`, `src/pwa/*`) — no offline **writes**. Order placement already has idempotency (`test/placeOrderIdempotency.test.js`). Print-service already reconciles a disk queue on reconnect.

**The architectural reality:** keeping waiter → kitchen → printer working with no internet requires a server on the restaurant LAN that enforces Zen OS rules (state machine, pricing, stock, KOT idempotency). That server is, in practice, `restaurant-server` running locally ("local hub") with its own MongoDB, syncing to Atlas. That cannot be built without core code. So split the work:

| Phase | Scope | Exposure | Who |
|---|---|---|---|
| **A1 — Architecture & protocol** (contract-only) | Options analysis (client-only outbox vs local hub vs hybrid); sync protocol (outbox/event envelope, idempotency keys, per-entity conflict policy — orders: hub-authoritative while offline; menu/prices: cloud-authoritative; stock: event-sourced deltas re-applied; payments: cloud-verified only); clock/ordering strategy; order-number collision strategy (`utils/orderNumber.js` contract only); failure-mode catalogue; test plan | Contracts + staging only | Dev A |
| **A2 — Generic sync engine** | A standalone library (outbox store, retry/backoff, batching, idempotent upload, cursor-based download, conflict hooks) with property/chaos tests against the **mock server** — knows nothing about Zen OS business rules | None beyond contracts | Dev A |
| **A3 — Integration into Zen OS** | Local hub packaging, wiring the engine into `restaurant-server` and apps, LAN discovery, local printing path | **Core IP** | **Owner** (recommended) — or one trusted developer on a time-boxed **extract**, after A1/A2 acceptance, under signed IP assignment |

| Item | Detail |
|---|---|
| Inputs given (A1/A2) | `sync/` contract draft, enums, realtime event catalogue, authoritative-fields list (CLAUDE.md rule 2, restated — not the file), staging URL + test logins |
| Not given | `orderService.js`, `inventoryService.js`, schema, tests, `CLAUDE.md` |
| Milestones | **A1** architecture doc accepted · **A2a** engine + mock server + tests · **A2b** chaos test report · **A3** (separate contract) |
| Acceptance | Deterministic tests for: duplicate submission (same idempotency key ×N → one record), out-of-order delivery, 24 h offline backlog replay, simultaneous edits on two devices with documented outcome, crash mid-sync, clock skew ±10 min; no data loss across kill/restart; documented storage limits; no business rules hard-coded in the engine |
| Hard rules for any A3 work | Server stays authoritative for price, status, source, payment status, role, stock (CLAUDE.md rule 2); no order is ever marked PAID offline by a gateway; stock deduction stays in the KOT transaction; KOT uniqueness per order preserved across hub↔cloud |

---

## Coordination

- Shared surface between all three is **only** `zen-os-contracts`; changes there are owner-approved PRs with a version bump.
- Weekly 30-minute check-in per contractor; demos on staging, never on production.
- Owner keeps an integration log: which contractor tag went into which core commit.
