# 10 — Status Report: Phase O1 complete (stopped before O2)

> **Update 2026-11-20: Phase O2 (staff PIN + devices) is implemented — report: doc 18.**
> Findings 4 (login needs internet) and the "first admin" half of 5 below are resolved by O2.

Date: 2026-11-20 · Branch: `features/offline-edition` · **Nothing committed, pushed or deployed.**

## Decisions on record (from your approval)
| # | Decision | Status |
|---|---|---|
| 1 | Local-primary: PC is the only writer, local MongoDB primary, Atlas a read-only mirror, no multi-master, local never waits on cloud | **Approved.** Enforced in O1 by `config/localModeCheck.js` (local replica set only) |
| 2 | Customer QR guest ordering over Wi-Fi, waiter confirmation mandatory, server pricing authoritative | **Approved.** Implementation is O3 |
| 3 | Staff PIN login on registered devices: hashed PINs, rate limit + lockout, admin revoke (immediate), audit log | **Approved with conditions.** Implementation is O2 |
| 4 | Local HTTPS | **Revised as requested. Strategy written: doc 12. Awaiting your approval before O5** |
| 5 | GST invoice series | **Deferred.** Behaviour unchanged. Implications written: doc 13 |
| 6 | Production cloud sync | **Not approved.** Mock cloud only, later |

## O1 deliverables
| Deliverable | Where | Verified by |
|---|---|---|
| `DEPLOYMENT_MODE=LOCAL` support (cloud default unchanged, unknown value refused) | `restaurant-server/config/deploymentMode.js`, `config/localModeCheck.js`, `server.js` | 20 unit tests + boot tests (cloud & local) |
| Local MongoDB replica-set connection (loopback + `replicaSet` required; Atlas/remote refused) | same, plus `scripts/localReplicaSet.js` | boot test on an in-memory replica set; script run against a real mongod 7.0.14 (check / initiate / repeat / standalone refused) |
| Local server startup | `server.js` (LOCAL branch), `local-edition.env.example` | boot test + manual smoke run |
| Admin, waiter, kitchen, customer over LAN | `local/staticApps.js` (one port per app, generated `/config.js`, SPA fallback, cache headers) | boot test (fake builds) + smoke run with the **real** `dist` builds opened via the PC's LAN IP `192.168.31.186`: all 4 pages, bundles and `config.js` OK |
| `/local/health` | `local/healthRoutes.js`, `local/lanOnly.js` | unit + boot tests: ok / degraded / error (503); LAN-only (403 otherwise); no URI or data leaked; absent in cloud |
| Boot and connectivity tests | `test/deploymentMode.test.js` (20), `test/localBoot.test.js` (16) | **36/36 pass** |
| Setup and recovery docs | `docs/offline-edition/11-local-setup-and-recovery.md` | — |

## Test results
* O1: `deploymentMode.test.js` **20/20**, `localBoot.test.js` **16/16**. The boot test covers DB down at
  boot, then automatic recovery when MongoDB starts, with no server restart.
* Full backend suite (`test/*.test.js`): **70 of 72 files pass.** The 2 failures,
  `editAfterKitchen.test.js` and `menuStructure.test.js`, **fail identically on a clean checkout of HEAD**
  (checked with an extracted HEAD snapshot) and import nothing O1 touched. Pre-existing, not fixed (out of scope).
* Frontends: not rebuilt. No frontend file changed.

## Files
New: `restaurant-server/config/deploymentMode.js`, `config/localModeCheck.js`, `local/lanOnly.js`,
`local/healthRoutes.js`, `local/staticApps.js`, `scripts/localReplicaSet.js`,
`local-edition.env.example`, `test/deploymentMode.test.js`, `test/localBoot.test.js`,
`docs/offline-edition/11-…`, `12-…`, `13-…`.
Modified: `restaurant-server/server.js` (+33/−1), `CLAUDE.md` (new "Offline Edition" section),
`docs/offline-edition/07-…`, `10-…` (this file).
Untouched: every order/inventory/payment/socket service, all frontends, print-service, production `.env`,
any real database, printer settings. No dependency installed.

## Findings you should know about
1. **Customer dine-in over plain HTTP fails today.** Geolocation is blocked outside HTTPS, and the server
   requires a location for customer dine-in. Doc 12 proposes LAN presence instead of GPS in LOCAL mode (O3).
2. **Admin inventory-v3 writes fail over plain HTTP** (`crypto.randomUUID` is HTTPS-only), and so does
   "copy QR link". This is why staff apps must be HTTPS (doc 12 §2).
3. **The server will not start without `FIREBASE_*`** (`utils/firebaseAdmin.js` crashes at import). It
   needs no internet, so a PC with the normal values boots offline. The template says so. Making it
   optional would touch auth/push code, so it was left for a later phase.
4. **Login still needs internet until O2.** Staff signed in beforehand keep working.
5. **A fresh local DB has no admin and no menu.** There is no bootstrap (`npm run seed` points at a missing
   `seed.js`). First-admin creation or a cutover import is needed before a pilot, and an import reads the
   production DB, so it needs your approval.
6. Pre-existing, not changed: in the cloud, unknown routes return **500** "Not Found" (not 404).
   `GET /api/test-whatsapp/:phone` is unauthenticated and sends a WhatsApp message to any number.
7. The in-memory mongod crashed once (`fassert`) during testing and passed on every rerun. There is an
   older crash dump from 2026-11-12 in the binary cache too. It looks like a flaky test binary on this
   PC, not product code, but watch for it.

## Not done (by design)
O2–O11. No HTTPS (awaiting doc 12 approval). No sync. No installer/Windows service. No print-service
`BACKEND_URL` change. No commits.

## Needed from you before O2
* Approve or amend **doc 12** (certificate strategy), especially the customer choice (C1 vs C2).
* Say how the **first admin / restaurant data** should get onto a local DB (finding 5).
* Explicit go-ahead for **O2** (PIN + device registration, with your decision-3 conditions).
