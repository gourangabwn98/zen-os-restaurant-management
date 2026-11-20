# 07 — Module-wise Implementation Plan

Status: **O1 and O2 implemented and accepted (2026-11-20, uncommitted). O3 planned in doc 19, awaiting approval.** Reports: doc 10 (O1), doc 18 (O2). Doc 12 approved 2026-11-20. Every item is gated by `DEPLOYMENT_MODE=LOCAL_PRIMARY`; CLOUD_PRIMARY behaviour must stay byte-for-byte the same and its existing tests must keep passing.

## Phase overview

| # | Phase | Outcome | Rough effort | Main risk |
|---|---|---|---|---|
| O1 | Mode switch + local boot | Server runs on local replica set; `DEPLOYMENT_MODE`; conditional DNS; `/local/health`; static hosting of 4 apps | 3–4 days | Accidentally changing cloud defaults |
| O2 | Local auth | PIN login, devices, pairing, lockout, audit; staff app login screens get "PIN" tab | 5–7 days | Security regressions |
| O3 | LAN customer ordering | Table-guest path, LAN-subnet gate, customer app guest flow, QR base URL | 3–4 days | Abuse of guest ordering |
| O4 | Local media + offline deps | Local upload store, Cloudinary mirror job, bundled OCR data, maps/push/SMS/WhatsApp degradation, PhonePe hidden offline | 4–5 days | Broken images after cutover |
| O5 | Local HTTPS + provisioning | Local CA, certs, device CA install guide, PWA install from LAN | 3–4 days | Device-specific trust quirks (iOS/Android) |
| O6 | Sync up (outbox) | Change-stream capture, outbox, push, acks, backoff, Admin → Sync page; **mock cloud locally** | 8–10 days | Resume-token / reconciliation correctness |
| O7 | Cloud ingest + relay + inbox | Cloud module (opt-in), remote orders, PhonePe relay, remote riders | 8–10 days | Touches the cloud deploy — needs approval |
| O8 | Delivery offline | Rider PIN login, LAN base URL, release cleartext/CA config, on-device claim queue, last-known tracking | 6–8 days | GPS/background behaviour on real phones |
| O9 | Installer + backup | WinSW services, bundled Mongo + Node, firewall rules, backup/restore, updater | 6–8 days | Windows variations |
| O10 | Invoice numbering (optional) | GST invoice series `<SITE>-<FY>-<seq>` | 2 days | Affects online bills if enabled there |
| O11 | Test matrix + pilot | Doc 08 executed on real devices at one site | 5+ days | Hardware/printer surprises |

Total ≈ 10–14 developer-weeks to a pilot-ready build. Estimates are planning numbers, not commitments.

## Module notes

**Admin** — No page rewrites. Add: Devices page, PIN controls in Employees, Sync page, "local mode" badge, offline-aware Delivery map (coordinates + last-fix time when tiles fail). Reports read local data.

**Waiter** — PIN login, server URL from provisioning. Everything else unchanged (orders, edits, confirm, bill, payment record per existing roles).

**Kitchen** — PIN login only. KOT board and sound unchanged.

**Customer** — Guest-at-table flow when the server reports `lanGuestOrdering: true` in the public profile; hide PhonePe/login/push/maps when unavailable; track own order via guest token over LAN socket.

**Inventory / purchases / expenses** — Unchanged logic. OCR: ship `eng.traineddata` and point `cachePath`/`langPath` at it.

**Billing / invoices** — Unchanged; optional O10. A4 + thermal printing unchanged (print-service).

**Payments** — Cash, manual UPI verification, `Both` split: unchanged. PhonePe: offered only when the site can reach PhonePe; callbacks via relay (O7) or the site's own status poll. Nothing ever marked PAID without a verified result.

**Delivery** —
* On the LAN: everything as today.
* Outside the LAN with restaurant online: via cloud relay (O7).
* Restaurant offline: rider device queues *claims* (`PICKED_UP`, `DELIVERED_OTP_ENTERED`, `COD_COLLECTED`) with device timestamp + GPS. On reconnect the site validates each claim (OTP checked **on the site**, amount must equal `order.total`), then applies through the normal transaction. Until then the order shows "Delivery reported by rider — awaiting confirmation". Offline assignment: only an admin/manager on the LAN can assign; auto-offers need connectivity. Customer tracking shows last-known location + timestamp, never an invented live update.

**Print service** — No code change planned. Only `.env BACKEND_URL` per site (with approval).

## Exact files changed in the first implementation phase (O1)

New:
* `restaurant-server/config/deploymentMode.js` — reads/validates `DEPLOYMENT_MODE` (`CLOUD_PRIMARY` default), single source of truth.
* `restaurant-server/local/staticApps.js` — mounts built `dist/` folders on configured ports (LOCAL_PRIMARY only).
* `restaurant-server/local/healthRoutes.js` — `/local/health` (LAN only).
* `restaurant-server/test/deploymentMode.test.js`, `restaurant-server/test/localBoot.test.js` (in-memory replica set; refuses non-local URIs like `localSandbox.js`).
* `restaurant-server/.env.local-edition.example`.
* `scripts/offline-edition/build-local-bundle.ps1` — builds the four web apps into one folder (no install of new deps).

Modified:
* `restaurant-server/server.js` — make `dns.setServers` conditional on mode; mount static apps + health in LOCAL_PRIMARY; keep everything else identical.
* `restaurant-server/config/securityCheck.js` — refuse LOCAL_PRIMARY with an Atlas URI, console OTP, or the sandbox JWT secret.
* `restaurant-server/utils/qrLink.js` — no logic change expected (already takes `CUSTOMER_FRONTEND_URL`); test added for a LAN IP base.
* `CLAUDE.md` — a short "Offline Edition / deployment modes" section.

Not touched in O1: any order/inventory/payment service, socket.js, print-service, frontends' logic, production `.env`, any database.

No new npm dependencies are needed for O1.

### O1 as implemented (differences from the list above)
* `config/securityCheck.js` was **not** modified (it carries unrelated uncommitted PhonePe work).
  The local checks live in a new `config/localModeCheck.js`, called from `server.js` right after it.
* `DEPLOYMENT_MODE=LOCAL` is accepted as the short form of `LOCAL_PRIMARY` (decision text). An
  unknown value stops the server.
* The env template is `restaurant-server/local-edition.env.example`. The `.env.*` pattern in
  `.gitignore` would have hidden the planned name.
* No `build-local-bundle.ps1`. The server serves `<repo>/<app>/dist` by default, or `LOCAL_APPS_DIR`.
  Packaging belongs to O9.
* `utils/qrLink.js` is unchanged. It already accepts an `http://` LAN base (covered by its existing tests).
* Added `scripts/localReplicaSet.js` (idempotent single-node replica-set init, loopback only).
* Docs added: 11 (setup and recovery), 12 (HTTPS strategy, decision 4 revision), 13 (numbering, decision 5).
