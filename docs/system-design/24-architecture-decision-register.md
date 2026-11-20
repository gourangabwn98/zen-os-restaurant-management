# 24 — Architecture Decision Register

Decisions **already taken** are reconstructed from code comments, `CLAUDE.md` and approved docs (cited). Decisions **pending** are open items surfaced by this audit. No new decision is made here.

## 1. Recorded decisions

| ID | Decision | Rationale (as recorded) | Source | Status |
|---|---|---|---|---|
| D-01 | Single-restaurant mode: one backend, one DB; multi-tenant header/slug resolution removed | apps silently read/wrote different DBs | `CLAUDE.md` rule 1; `authMiddleware.js` header | Accepted, implemented |
| D-02 | Backend authoritative for price, status, source, payment, role, stock | client tampering | `CLAUDE.md` rule 2 | Accepted, implemented |
| D-03 | Employees are `User` docs with roles; no public staff signup | one auth system | `CLAUDE.md` rule 3 | Accepted |
| D-04 | Strict order state machine with explicit role map; admin override as pure status flip | consistency, auditability | `orderStateMachine.js` | Accepted |
| D-05 | Stock deduction + KOT + PREPARING in one transaction at kitchen send (not at confirm) | KOT prints when cooking starts; no stock without ticket | `orderService.sendToKitchenTx` | Accepted |
| D-06 | Print jobs idempotent by unique index and atomic status updates; change slips per revision | never print twice / never lose | `CLAUDE.md` rule 5 | Accepted |
| D-07 | Print bridge on-premises with printer key, disk queue, pull-reconcile; Windows share instead of `printer` addon; `usb` for WinUSB | LAN reachability, no native toolchain | `CLAUDE.md` Print service | Accepted |
| D-08 | Payments marked PAID only on checksum-verified gateway result or explicit staff action; UPI link never proof | fraud | `CLAUDE.md` Payment | Accepted |
| D-09 | Socket rooms scoped by role for data protection; chef gets PII-stripped kitchen room | PII leak to chefs | `socket.js`, `CLAUDE.md` | Accepted (legacy tenant emits contradict it — R-02) |
| D-10 | Duty ends only on explicit action; no heartbeat auto-OFF | phones sleeping turned staff off | `server.js:346-352` | Accepted |
| D-11 | OTP provider auto-detect (Twilio → MSG91 → console) | NODE_ENV switch broke login | `CLAUDE.md` | Accepted |
| D-12 | Offline Edition = local-primary single writer; cloud read-only mirror; no multi-master | invariants depend on one writer | `docs/offline-edition/02`, doc 10 decision 1 | Approved; O1/O2 implemented |
| D-13 | Staff PIN login on registered devices in LOCAL mode | offline login without Firebase/SMS | doc 10 decision 3, doc 18 | Approved; implemented |
| D-14 | Local HTTPS via restaurant CA; customer QR may stay HTTP with signed table tokens (C1) | browser secure-context rules | doc 12, doc 19 §0 | Approved 2026-11-20; not implemented |
| D-15 | GST invoice series per site | accounting | doc 13 | Deferred |
| D-16 | Production cloud sync | — | doc 10 decision 6 | **Not approved** |
| D-17 | Browser cache is read-only; no device write queues | server authority, conflicts | `savedData.js`, doc 02 §5 | Accepted |
| D-18 | No state library / UI kit in frontends | simplicity | `CLAUDE.md` | Accepted |
| D-19 | Delivery: COD custody ≠ payment; accept = one transaction; riders not staff | money integrity, PII | `CLAUDE.md` Home delivery; `docs/delivery/03` | Accepted, implemented |
| D-20 | Customers must log in to place orders | (rationale not recorded in repo) | `orderService.js:174-180` | Implemented; **conflicts with docs** |
| D-21 | PhonePe V2 only after V2 credentials + real UAT webhook | unverified doc details | `V2_IMPLEMENTATION_PLAN.md` | Plan |
| D-22 | Android print agent: LAN first, Windows service kept in parallel | feasibility | `docs/audit/*` | Proposed, not approved |

## 2. Pending decisions surfaced by this audit

| ID | Decision needed | Options | Linked |
|---|---|---|---|
| P-01 | Offline functional scope (requirement vs doc 02) | (a) restrict to waiter/admin/manager + bill printing (+KOT?) with server-side flags; (b) keep doc 02 scope | Q-01, [14 §6](14-offline-first-architecture.md) |
| P-02 | Rotate leaked printer keys; purge history? | rotate only / rotate + rewrite history | R-01 |
| P-03 | Guest ordering in cloud | keep login-only / restore guest with table token | Q-03, D-20 |
| P-04 | Legacy `Invoice`, `Chef` models | retire / align | R-15 |
| P-05 | Delivery and packing charges | implement in `utils/pricing.js` / remove fields | 21 §2 |
| P-06 | Multi-instance backend ever? | stay single / add Redis adapter + shared OTP store | R-11 |
| P-07 | Print-job auto-skip window and alerting | keep 30 min silent / configurable + alert | R-09 |
| P-08 | Android agent go/no-go and printer models | — | 20 |
