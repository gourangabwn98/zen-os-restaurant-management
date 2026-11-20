# 23 — Architecture Recommendations

Evidence-based, kept separate from the discovery documents. Nothing here is implemented. Items that touch payments, printing, production data or git history need explicit owner approval (`CLAUDE.md`, memory decisions).

## 1. Immediate (days, small diffs)

| # | Recommendation | Addresses | Approval needed |
|---|---|---|---|
| 1 | Revoke and reissue the printer keys contained in the two committed zips; stop committing release artifacts (`.exe`, zips, `data/`) — publish them outside git | R-01 | Yes (key rotation on live printers; history purge separately) |
| 2 | Remove the six legacy socket emits (tenant-room PII leak; no listeners) | R-02 | Code review |
| 3 | Delete `GET /api/test-whatsapp/:phone` | R-03 | — |
| 4 | Reject `Inactive` users in the socket handshake in cloud mode too; disconnect on deactivation | R-04 | — |
| 5 | `notFound` → 404 | R-14 | — |
| 6 | Alert staff (admin/waiter banner) when print jobs are auto-SKIPPED; make the 30-min window a profile setting | R-09 | printing change → approval |
| 7 | Update `CLAUDE.md`/README: login-required ordering, roles list, `delivery-app/`, admin not in kitchen room, stale comments in `orderStateMachine.js`/`autoSendDueOrders` | docs drift | — |

## 2. Short term (weeks)

* CI (GitHub Actions): backend tests, four `vite build`s, print-service `npm test`, admin lint; record deployed SHA via `/api/health`.
* Platform hardening: `helmet`, CORS allow-list, rate limit on auth/order/payment routes, `trust proxy`.
* Sessions: shorter JWTs + `tokenVersion` revocation; consider httpOnly cookie for staff apps.
* OTP: `crypto.randomInt`, TTL collection instead of in-memory map (also makes multi-instance possible).
* Wrap table-session open + order insert in one transaction (R-10).
* Add indexes: `Order.user`, `{status, autoPrepareAt}`, `{status, paymentDeadline}`, `KOTJob/BillPrintJob {status, createdAt}`.
* Add `requestKey` to single-bill print.
* Decide the fate of `Invoice` (legacy) and `Chef` models.
* Decide delivery/packing charges (configured but unused).
* Merge strategy: the audited branch carries uncommitted O1/O2 + PhonePe hardening; get it committed/reviewed before more phases.

## 3. Offline requirement (needs a decision first — D-12)

If the business rule "offline = waiter, admin, manager operations + bill printing only" stands:
* Add a server-side **capability flag** derived from connectivity/mode (one module, like `deploymentMode.js`) and enforce it in routes (e.g. refuse customer ordering, delivery dispatch, offers, inventory V3 writes) — never only in the UI.
* Clarify whether **KOT printing** is included (bill-only would remove kitchen tickets).
* Keep the approved local-primary model; do **not** introduce device write queues for staff.

## 4. Target architecture (recommended, consistent with approved decisions)

```
Restaurant site (single writer)            Cloud
  restaurant-server (LOCAL or CLOUD) ───▶  mirror + relay (opt-in, O6/O7)
  MongoDB replica set                       Atlas mirror (read-only for LOCAL sites)
  print-service (Windows) / Android agent   PhonePe relay → site verifies
  staff devices over HTTPS (O5)             remote riders/customers via relay
```

* Keep: one backend codebase, server-authoritative rules, atomic/idempotent patterns, role-scoped rooms.
* Add (in order): CI + security fixes → O3 (if customer LAN ordering is wanted) → O5 HTTPS → O9 backup/installer → O6/O7 sync (after approval) → Android print agent pilot (LAN, single agent first; lease protocol before multi-agent).
* Observability: structured logs (pino) with request ids, uptime probe on `/api/health`, print-job and pay-first anomaly alerts.
* Shared package for enums/labels across apps to remove copy drift.
* PhonePe: implement V2 only when V2 credentials are issued; implement refunds + reconciliation (G8, G10) regardless.

## 5. Explicitly not recommended

Multi-master sync; client-side write queues for staff; trusting any client-sent price/status/payment; adding a second gateway module; cloud-direct-to-printer.
