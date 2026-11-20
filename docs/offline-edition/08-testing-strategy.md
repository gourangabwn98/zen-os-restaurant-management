# 08 — Testing Strategy

Status: **PROPOSAL.**

## 1. Safety rules for every test
* Only local databases: `mongodb-memory-server` replica set (binary already cached at `~/.cache/mongodb-binaries/mongod-x64-win32-7.0.14.exe`) or a dedicated local `mongod` with a `zen_test_*` DB name.
* Every test harness refuses to start unless the URI matches `^mongodb://127\.0\.0\.1` (pattern already used by `deliveryReplSet.test.js` and `localSandbox.js`).
* All cloud credentials blanked (as in `localSandbox.js`). Never Atlas, never production printers (mock driver or a bench printer).
* "Mock cloud" for sync = a second restaurant-server process on a second local DB.

## 2. Layers
1. **Unit/service** (plain Node + assert, existing style): deployment mode, PIN auth, device auth, guest-table gate, outbox capture, idempotent ingest, conflict guard, invoice numbering.
2. **Replica-set integration**: concurrency, transactions, change streams, resume after kill -9.
3. **Regression**: the full existing suite (`for f in test/*.test.js`) in CLOUD_PRIMARY must pass unchanged; `print-service npm test`; `npm run build` of all four frontends.
4. **E2E on LAN**: real router with WAN unplugged, real phones, real printers.

## 3. Offline test matrix

| # | Scenario | How | Pass criteria |
|---|---|---|---|
| T1 | Cold start without internet | WAN unplugged, reboot PC | Mongo + server + print-service up < 2 min; health green except "cloud: offline" |
| T2 | Admin login offline | PIN on registered admin device | Login ok; unregistered device refused; 5 wrong PINs → lock |
| T3 | Waiter login offline | PIN | Correct role, no admin pages |
| T4 | Kitchen offline | Chef PIN; place order | KOT on board + printer; chef can only CONFIRMED→PREPARING→READY |
| T5 | Customer QR over LAN | Scan QR on guest Wi-Fi | Menu, cart, order → PENDING_CONFIRMATION; waiter confirms; off-LAN request with same token refused |
| T6 | 20 simultaneous orders | scripted, 10 devices | No duplicate order numbers; no oversell; all KOTs once |
| T7 | Inventory updates | adjust, wastage, deduction | Ledger balances = currentStock; low-stock alerts fire on every path |
| T8 | Purchase + receiving | manual + OCR photo | Stock up, ledger PURCHASE rows, OCR works with no internet |
| T9 | Invoice + GST | dine-in with service charge, coupon, AC charge | Totals match `utils/pricing.js` expectations |
| T10 | Cash / manual UPI / Both | settle bills | PAID only by staff action; Both split adds up to total |
| T11 | PhonePe while offline | try to pay online | Option hidden/refused; nothing marked PAID |
| T12 | Thermal + A4 print | print-service → localhost | Each job printed exactly once; reprint works |
| T13 | Employee management | add waiter, deactivate | Deactivated user's live token refused on next request |
| T14 | Role permissions | manager vs admin vs waiter vs chef matrix | Same as online (`managerRole`, `chefPermissions` tests extended) |
| T15 | Delivery on LAN | rider PIN, assign, pickup, OTP drop, COD | DELIVERED; CodCollection once; PAID only after hand-in verify |
| T16 | Delivery claims while offline | rider off-LAN, restaurant offline | Claims queued on device; applied once on reconnect; wrong OTP rejected on site |
| T17 | App restart offline | kill waiter PWA, reopen | Shell loads (HTTPS staff), login token valid, data fresh |
| T18 | Local server restart mid-service | kill node during order placement | Order either fully exists or not; idempotent retry returns same order |
| T19 | Router/internet flap | WAN up/down every 2 min for 1 h | Local ops unaffected; sync backlog drains; no duplicates in mock cloud |
| T20 | Sync after long outage | 3 days offline, 2 000 orders | Full drain; cloud counts match; ordering by syncSeq |
| T21 | Duplicate prevention | replay same batch 5× | Mirror unchanged after first |
| T22 | Conflicting stock updates | stale cloud edit attempt | Cloud write refused (`SITE_IS_LOCAL_PRIMARY`); conflict logged |
| T23 | Invoice number uniqueness | 2 sites, 1 cloud | No collisions; consecutive per site/FY |
| T24 | Backup + restore | restore last night's dump | Service back; reconciliation re-syncs only differences |
| T25 | Online regression | CLOUD_PRIMARY suite | All existing tests pass unchanged |

## 4. Reporting
Each phase report lists: tests run, command, pass/fail counts, what was not tested and why. Nothing is called complete without a run.
