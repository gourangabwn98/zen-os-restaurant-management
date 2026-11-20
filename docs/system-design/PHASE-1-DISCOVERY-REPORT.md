# Phase 1 — Project Discovery Report

Date 2026-11-20 · Read-only · Nothing in application code, configuration, databases, printers, payments or git state was changed. This is the only file added in this phase; all existing documents (including the earlier `docs/system-design/` package) were left as they are.

Status labels: IMPLEMENTED / PARTIAL / PLANNED / PROPOSED / UNKNOWN / ABSENT (defined in [01 §2](01-project-overview.md#2-status-legend-used-in-every-document)).

---

## 0. Git state at discovery

| Item | Value | Evidence |
|---|---|---|
| Branch | `features/offline-edition` (local only) | `git branch --show-current` |
| HEAD | `00b8347` "demo"; 32 commits ahead of `main`, 0 behind | `git rev-list --left-right --count main...HEAD` |
| Modified (uncommitted) | 29 files, +689 / −56 lines: Offline Edition O1/O2 wiring, PhonePe hardening, customer policy pages, staff login screens, `CLAUDE.md` (+30 lines: PhonePe amount rules, Offline Edition section) | `git status`, `git diff --stat` |
| Untracked | 24 paths: Offline Edition backend (`config/deploymentMode.js`, `localModeCheck.js`, `localAuthModels.js`, `local/`, `localAuth*`, `utils/localPin.js`, `utils/phonePeEnv.js`, 4 tests), frontend `src/local/` in admin/waiter/kitchen, `SetupPage.jsx`, `DevicesPage.jsx`, `PolicyPage.jsx`, and the docs folders `docs/offline-edition/`, `docs/phonepe-integration/`, `docs/system-design/` | same |
| Changed since the system-design package was written | **Nothing** (same 29 modified paths; only new untracked path is `docs/system-design/`) | same |
| Deployed version | UNKNOWN (`/api/health` exposes `RENDER_GIT_COMMIT`; not called) | `restaurant-server/server.js:113-120` |

Consequence: a large part of what is "implemented" exists **only as uncommitted work on this branch** (Offline Edition, PhonePe fixes) or **only on unmerged branches** (delivery, Inventory V3, dining radius, PWA — per `discovery/fact_sheet.md` §0).

---

## 1. Actual repository structure

Monorepo, no workspace tooling, no shared package. 891 tracked files.

| Path | What it is | Tracked files |
|---|---|---|
| `restaurant-server/` | the only backend | 221 |
| `admin/`, `customer/`, `waiter/`, `kitchen/` | web apps | 235 / 108 / 95 / 50 |
| `delivery-app/` | React Native rider app (**not in `CLAUDE.md`'s repo map**) | 86 |
| `print-service/` | Windows print bridge source + **committed builds** (`client-update-2026-10-09/`, `client-update-2026-10-10.zip`) | 56 |
| `Admin_provider.zip` (tracked, 34 MB) / `Admin_provider/` (gitignored) | print-service install bundle incl. `.env` | 1 |
| `docs/` | offline-edition (15), phonepe-integration (8), delivery (4), audit (5), developer-collaboration-audit (9), 2 standalone + 1 HTML, system-design (this package) | |
| `discovery/` | PRD/TDT/gap spreadsheets (+ an Excel lock file `~$…xlsx`), `fact_sheet.md` | 8 |
| `.claude/agents/` | 6 Claude Code agent definitions | 6 |
| `.github/modernize/` | untracked tooling stub; **no workflows** | 0 |

Evidence: `git ls-files | cut -d/ -f1 | uniq -c`; directory listings. Detail: [02 §1](02-repository-and-technology-inventory.md).

## 2. Applications and services

| Application | Purpose | Status | Entry point |
|---|---|---|---|
| restaurant-server | REST + Socket.IO + 5 background ticks | IMPLEMENTED | `restaurant-server/server.js` |
| admin | back office, POS, embedded kitchen display, delivery board, devices (LOCAL) | IMPLEMENTED | `admin/src/App.jsx`, `pages/admin/AdminLayout.jsx` |
| waiter | floor operations | IMPLEMENTED | `waiter/src/App.jsx` |
| kitchen | KOT board | IMPLEMENTED | `kitchen/src/pages/KitchenBoardPage.jsx` |
| customer | QR / takeaway / delivery ordering, tracking | IMPLEMENTED | `customer/src/App.jsx` |
| delivery-app | rider app (Android; iOS shell) | IMPLEMENTED on branch | `delivery-app/App.tsx`, `android/app/src/main/java/com/zenos/delivery/*` |
| print-service | Windows print bridge (`SohojPrintService.exe`) | IMPLEMENTED | `print-service/src/index.js` |
| Offline Edition local server | same backend in `DEPLOYMENT_MODE=LOCAL` + static app hosting | PARTIAL (O1/O2, uncommitted) | `config/deploymentMode.js`, `local/staticApps.js` |
| Android print agent | PC-free printing | PROPOSED, **no code** | `docs/audit/*` only |
| Sync agent / cloud relay | site↔cloud | PLANNED, not approved | `docs/offline-edition/05-…` |

## 3. Verified technology stack (installed versions from `node_modules/*/package.json`)

| Area | Versions |
|---|---|
| Backend | Node 22.22.1 (local; no `engines`), Express 5.2.1, Mongoose 9.9.4, Socket.IO 4.8.3, jsonwebtoken 9.0.3, firebase-admin 13.10.0, twilio 5.13.1, axios 1.20.0, tesseract.js 7.0.0, node-thermal-printer 4.6.1 (listed, unused server-side) |
| admin | React 19.2.4, react-router-dom 7.13.1, Vite 8.0.0, vite-plugin-pwa 2.0.0, firebase 12.13.0, axios 1.13.6 |
| customer / waiter / kitchen | React 18.3.1, router 6.30.6, Vite 5.4.21; firebase 10.14.1 (customer, waiter); PWA plugin 2.0.0 (waiter, kitchen) |
| All web apps | socket.io-client 4.8.3; no state library, no UI kit |
| delivery-app | React Native 0.77.2, React 18.3.1, react-native-maps ^1.20.1, socket.io-client ^4.8.1, Kotlin native modules |
| print-service | socket.io-client 4.8.3, node-thermal-printer 4.6.1, usb 3.1.0, pngjs, jsqr, qrcode; esbuild + postject (exe) |
| Database | MongoDB Atlas (inferred from `mongodb+srv` handling, `config/env.js`); local replica set (MongoDB 7, doc 10) |

Full table: [02 §2](02-repository-and-technology-inventory.md#2-technology-inventory).

## 4. Backend modules and API routes

* Layers: `routes/` (25) → `controllers/` (29) → `services/` (38) → `config/*Models.js`; `utils/` (36), `middleware/` (10), `sockets/socket.js`, `local/` (4). Evidence: directory listing.
* **276 route handlers** (`grep router.(get|post|put|patch|delete)` per file) + `/api/health` + `/api/test-whatsapp/:phone` in `server.js`. Largest: delivery 36, inventory 28, employees 25, admin 25, inventory v3 24, menu 18, local auth 15, auth 15.
* Mounts: `server.js:123-149`; LOCAL-only mounts `/local` and `/api/local` at `server.js:164-167`.
* Background ticks: offers 30 s, auto-send to kitchen 15 s, pay-first 60 s, delivery 5 s, category reset 60 s (`server.js:203-344`).

Detail: [06](06-backend-architecture.md), [09](09-api-architecture.md).

## 5. Database collections and relationships

* **55 collection definitions:** 31 in `config/getModels.js`, 6 in `config/deliveryModels.js` (always registered), 12 Inventory V3 in `config/inventoryV3Models.js` (`autoCreate/autoIndex: false`, created by `scripts/setup-inventory-v3.js`), 6 LOCAL-only in `config/localAuthModels.js`.
* Central aggregate `Order` (`getModels.js:352-589`): snapshots of lines/coupon/table, actor fields, `statusHistory`, payment sub-document, idempotency key (partial unique index), stock deductions.
* Uniqueness that carries business rules: `KOTJob.order`, `KOTChangeJob {order, revision}`, `TableSession {tableNo, status:OPEN}`, `AttendanceSession {employee, status:OPEN}`, `DutyHistory {session, action, at}`, `DeliveryJob.order`, `CodCollection.order`, `DeliveryOffer {job, partner, round}`, `StaffPay` one SALARY per month, `WaiterCall` one active per order.
* Append-only by model hook: `DutyHistory`, `DeliveryEvent`, `LocalAuthEvent`. No soft delete anywhere. `MenuItem.category` is a string key, not a reference.

Detail: [07](07-database-dictionary.md), [08](08-database-relationships.md), [`diagrams/schema.dbml`](diagrams/schema.dbml).

## 6. Authentication and permissions

| Who | How (cloud) | How (LOCAL) | Evidence |
|---|---|---|---|
| Customer | Firebase phone → backend JWT **30 d**; login required to place orders | not possible yet (O3) | `authController.js` `firebaseVerify` (L574+), `orderService.js:174-180` |
| Admin/manager/inventory_manager | Firebase → JWT **7 d**; or backend OTP → JWT **30 d** | phone + PIN on approved device | `authController.js:337+, 777-780`; `localAuthService.js` |
| Waiter/chef/rider | backend SMS OTP (in-memory, `Math.random`, 5 tries) or Firebase → JWT 7 d | PIN (riders: OTP) | `authController.js:395-500` |
| print-service | printer key (SHA-256 stored) | same | `printerDeviceService.js`, `socket.js:80-95` |

Roles: `admin, manager, inventory_manager, waiter, chef, customer, staff, delivery` (`getModels.js:56`). RBAC: `middleware/rbac.js`, `utils/roles.js`, `managerScope.js`, `dutyMiddleware.js`; order transitions `utils/orderStateMachine.js:112-155`. Detail: [16](16-security-architecture.md).

## 7. Socket.IO events

* Handshake: printer key → JWT → anonymous guest (`socket.js:75-145`). In cloud mode an `Inactive` user is **not** refused at handshake (`socket.js:108-109`).
* Rooms: `tenant` (everyone incl. guests), `staff`, `kitchen` (**chef only** — admin does not join, `socket.js:160-164`), `printers`, `order:{id}`, `user:{id}`, `delivery-admin`, `track:{jobId}`.
* Client events: `join-order`, `join-tracking`, `employee:attendance:heartbeat`, `register-printer`, `get-queue` (ack), `report-job-status`.
* Server events and their **verified consumers** (string search across all clients, this phase):

| Event | Consumers |
|---|---|
| `order:new/confirmed/status_changed/cancelled/payment_changed/needs_attention`, `table:cleared`, `table:freed` | admin + waiter via `ORDER_EVENTS` in `*/src/hooks/useLiveOrders.js`; customer (order events); kitchen (stripped status/cancel) |
| `kot:created` | admin, kitchen, print-service |
| `bill:print` | print-service |
| `kot:status_changed`, `bill:status_changed`, `inventory:alert`, `waiter_call:activity` | admin `src/notifications/model.js` |
| `waiter_call:new/updated` | waiter, customer |
| `delivery:*` | delivery-app, admin, customer |
| **Legacy** `new-order`, `order-status-updated`, `order-rejected` (to `tenant`, full order incl. guest name/phone), `order-approval-request`, `kot-print`, `bill-print` | **none** — dead code; the first three expose PII to anonymous sockets (`socket.js:414, 438, 446`) |

## 8. Order and KOT workflows

* Customer order → `PENDING_CONFIRMATION` (or `AWAITING_PAYMENT` when paying online with PhonePe); staff order → `CONFIRMED` (`orderService.js:340`).
* Accept: `confirmOrderTx` atomic `PENDING_CONFIRMATION→CONFIRMED`, edit window counted from placement (`orderService.js:522-556`).
* At `autoPrepareAt` (default 3 min) the 15 s tick or a staff/chef action runs **`sendToKitchenTx`: one transaction = `PREPARING` + stock deduction + `KOTJob`** (`orderService.js:462-513`). Failure parks the order with `sendError` (`:565-589`).
* Edits after KOT: `modifySentOrderTx` re-prices, restocks/deducts, writes a `KOTChangeJob`, re-opens READY/DELIVERED to PREPARING when items are added.
* Serve → bill print → settle (`billingService.settleBills`, atomic) → `COMPLETED` (system) ; admin/manager hand-complete only when PAID.
* Gap: table session is opened before the order insert, outside a transaction (`orderService.js:327-331, 397, 411-413`).

Detail: [11](11-business-workflows.md), [12](12-order-and-payment-lifecycle.md).

## 9. Complete printing pipeline

1. Job created server-side (`kotService.createKotJobForOrder` in the kitchen-send transaction; `createKotChangeJob`; `adminController.printBill`; `combinedBillService.printCombinedBill`).
2. Pushed to the `printers` room (`emitKotCreated`, `emitBillPrint`, change slips as `jobType:"KOT"`).
3. print-service (`src/socketClient.js`) upserts into its disk queue `data/queue.json` (atomic temp+rename, `src/queue.js`); pulls `get-queue` on every connect and every 5 s.
4. `processor.js` renders (`renderers/*`, logo, pay QR, Bengali via PowerShell GDI+ `textImage.js`) and prints through `printerManager.js` (role KOT/BILL/BOTH only) → LAN TCP 9100 / Windows share `copy /b` / `USB_DIRECT` libusb.
5. Status reported via `report-job-status`; backend updates atomically (`socket.js:297-332`).
6. Waits without using attempts while the printer is offline; FAILED retried with backoff up to `MAX_ATTEMPTS`; **jobs older than 30 min are SKIPPED** by both backend (`printerDeviceService.js:93`) and service (`config.js:48`).

Not prevented: two bridges connected at once both print every job. Android agent: no code. Detail: [13](13-printing-architecture.md).

## 10. Payment integration status

| Path | Status | Evidence |
|---|---|---|
| Cash, manual PAID, settle, split `Both` | IMPLEMENTED | `billingService.js:74-140`, `utils/paymentMode.js` |
| UPI deep link / static QR (never proof) | IMPLEMENTED | customer app, `print-service/src/payQr.js` |
| PhonePe PG **V1** (salt key, `X-VERIFY`, constant-time compare, amount match, final states, pay-first 15 min expiry) | IMPLEMENTED — amount check and env parser are **uncommitted** | `services/paymentService.js`, `utils/phonePeEnv.js` (untracked), `payFirstService.js` |
| PhonePe V2, refunds, admin re-check, wider reconciliation | PLANNED | `docs/phonepe-integration/V2_IMPLEMENTATION_PLAN.md`, `INTEGRATION_GAP_ANALYSIS.md` G1–G12 |
| COD custody → admin verify → PAID | IMPLEMENTED on branch | `deliveryService.js`, `CodCollection` |
| Delivery fee / packing charge | **configured but never applied** (no reader in code) | grep of `deliveryBaseFee|deliveryFeePerKm|freeDeliveryAbove|packingCharge` |

## 11. Existing offline functionality

* **Browser:** read-only IndexedDB cache of GET responses + connectivity banner in admin, waiter, kitchen (`src/offline/savedData.js`, `connectivity.js`, byte-identical). **No write queue** (by design). Customer app: none.
* **Offline Edition (LOCAL_PRIMARY):** O1 (mode switch, local replica set, LAN app hosting, `/local/health`) and O2 (device registration, PIN login, lockout, audit, instant revoke) implemented and **uncommitted**. O3 (LAN customer ordering) planned; O4–O11 planned; **sync not approved**.
* **Requirement "offline = waiter, admin, manager + bill printing only": not implemented**, and it conflicts with the approved Offline Edition scope (doc 02 §3 keeps kitchen, inventory, customer Wi-Fi ordering, on-site delivery). No connectivity-based feature restriction exists anywhere.

Detail: [14](14-offline-first-architecture.md), [15](15-data-synchronization-design.md).

## 12. Deployment infrastructure

| Item | Finding | Confidence |
|---|---|---|
| Backend | Render (`RENDER_GIT_COMMIT`, docs) | Inferred |
| admin, customer, waiter | Vercel (`vercel.json`) | Inferred |
| kitchen | no hosting config | UNKNOWN |
| Database | MongoDB Atlas; tier/backups/network UNKNOWN | Inferred |
| Print bridge | `.exe` copied to a restaurant Windows PC; builds committed to git | Verified |
| Offline Edition | manual setup (doc 11); installer is O9 | PARTIAL |
| CI/CD, Docker, IaC, monitoring | none | ABSENT |
| `.env.example` | `restaurant-server/`, `kitchen/`, `print-service/` (+ copies in `print-service/dist`, `release`, `client-update-2026-10-09`); none for admin/customer/waiter | Verified |

Detail: [17](17-deployment-infrastructure.md).

## 13. Existing tests

| Suite | Files | Last recorded result (not re-run this phase) |
|---|---|---|
| Backend `restaurant-server/test/` | 73 `*.test.js` + `fakeMongo.js` helper + `e2e/deliveryE2E.mjs`; plain Node + assert; `mongodb-memory-server` incl. replica set | 70/72 files pass, 2 pre-existing failures (`editAfterKitchen`, `menuStructure`) — doc 10, 2026-11-20 |
| print-service | 13 suites via `npm test` | PASS — fact sheet, 2026-11-19 |
| admin | `floorState`, `menuCategories` | menuCategories FAIL (fact sheet) |
| customer | `addonQuantity` | FAIL (fact sheet) |
| waiter | `i18n`, `kotReleaseContract`, `orderDetailEdit`, `orderDraft`, `tableSession` | i18n FAIL (fact sheet) |
| kitchen | `i18n` | PASS |
| delivery-app | `__tests__/geo.test.ts` (Jest, 6 tests per doc) | PASS (delivery doc 04) |
| Coverage, contract tests, load tests | none (one waiter contract test) | ABSENT |

## 14. Existing documentation and architecture diagrams

| Document set | Date / branch | Status of content |
|---|---|---|
| `CLAUDE.md` | live; +30 uncommitted lines | Authoritative rules; partly outdated (see §16) |
| `README.md` | Sep 2026 | Outdated |
| `SECURITY_AUDIT.md` | 2026-10-01 | Partly superseded; C2, H6 still open |
| `discovery/fact_sheet.md` + 3 spreadsheets | 2026-11-19, `feature/offline-first` / `main` | Good baseline; a few items now outdated |
| `docs/developer-collaboration-audit/` (9) | 2026-11-19, `feature/offline-first` | Already reports the leaked printer key (RISK_REGISTER R01) |
| `docs/offline-edition/` (01–13, 18, 19; untracked) | 2026-11-20 | Current; several "PROPOSAL" headers stale |
| `docs/phonepe-integration/` (8; untracked) | 2026-11-20 | Current except gaps already fixed in code |
| `docs/delivery/` (4) | 2026-11-19/20 | Current |
| `docs/audit/` (5, Android printing) | 2026-10-28, `feature/inventory-v3` | Design-only; older line references |
| `docs/HOTEL_KHOAI_CHANGE_ROUND.md`, `INVENTORY_V3_ROLLOUT.md`, `inventory-reference.html` | Oct 2026 | Feature-specific |
| App READMEs (admin, customer, delivery-app, print-service) | various | Not compared line by line |
| `docs/system-design/` (00–27 + `diagrams/`, created in the previous turn) | 2026-11-20 | See §16.2 for corrections |

Diagrams that already existed before the system-design package: ASCII topology in `README.md`, `CLAUDE.md` (state machine), `docs/offline-edition/02` (topology) and `18`, `docs/phonepe-integration/PAYMENT_INTEGRATION_WORKFLOW.md`, `docs/developer-collaboration-audit/REPOSITORY_ISOLATION_STRATEGY.md`; Mermaid in `docs/audit/zen-os-android-print-agent-architecture.md`, `…integration-contract.md`, `zen-os-mobile-printing-feasibility-report.md`. The system-design package added 19 Mermaid files, `workspace.dsl` and `schema.dbml`.

## 15. Technical gaps and unanswered questions

**Gaps (verified):** committed printer key + customer data in two zips; PII to anonymous sockets; unauthenticated WhatsApp test route; Inactive staff accepted on sockets (cloud); long-lived tokens without revocation; no CI/monitoring/verified backups; 404→500; table session/order insert not atomic; silent 30-min print skip; double printing with two bridges; role-only printer routing; no refunds; unused delivery/packing charges; legacy `Invoice`/`Chef`; in-memory OTP and rate limits; offline requirement not implemented. Full register: [22](22-technical-debt-and-risks.md) (R-01…R-20).

**Unanswered questions:**
1. Which commit/branch runs in production for each app? Where is kitchen hosted?
2. Offline scope: your requirement (waiter/admin/manager + bill printing) or doc 02's broader scope? Is KOT printing included offline?
3. Is login-required customer ordering intended in the cloud, or only until O3?
4. Atlas tier, backup schedule, network access list?
5. Will PhonePe issue V1 or V2 credentials? How should paid-then-cancelled orders be refunded until refunds exist?
6. Is the `Invoice` collection still used?
7. Should the leaked printer keys be rotated now, and should git history be rewritten?
8. Android print agent: approved? which printer models?
9. Should delivery/packing charges be charged?

---

## 16. Comparison with existing documentation

### 16.1 Outdated / contradictory documents in the repository

| # | Document | Says | Code says | Type |
|---|---|---|---|---|
| 1 | `README.md:10, 54` | backend folder is `backend/` | `restaurant-server/` | Outdated |
| 2 | `README.md:45` | "Direct UPI deep-link only, no payment gateway" | PhonePe V1 implemented | Outdated |
| 3 | `README.md:12`, `CLAUDE.md` repo map | customer orders "guest or logged-in" | placing an order requires login (`orderService.js:174-180`, `CartPage.jsx:177`) | **Contradictory** |
| 4 | `README.md:159` | "5 frontend apps" | 4 web apps + 1 React Native app | Outdated |
| 5 | `README.md` | `npm run seed` | `seed.js` does not exist | Outdated |
| 6 | `CLAUDE.md` repo map | 5 frontends + print-service | `delivery-app/` missing | Incomplete |
| 7 | `CLAUDE.md` rule 3 | roles `admin | manager | waiter | chef | customer` | also `inventory_manager`, `staff`, `delivery` (`getModels.js:56`) | Incomplete (delivery section mentions riders) |
| 8 | `CLAUDE.md` socket table, `utils/tenantKey.js` comment | `kitchen` room = admin + chef | only chef sockets join (`socket.js:162`) | **Contradictory** |
| 9 | `server.js:243`, `orderService.js:563` comments | auto-send "conditional on PENDING_CONFIRMATION" | conditional on `CONFIRMED` (`orderService.js:491`) | Stale comment |
| 10 | `utils/orderStateMachine.js` header | confirmation deducts stock and creates the KOT | done at `sendToKitchenTx` (PREPARING) | Stale comment |
| 11 | `docs/offline-edition/02, 03, 04, 05, 06, 08` headers | "PROPOSAL — awaiting approval. No code written." | O1/O2 approved and built (docs 07, 10, 18) | Outdated status |
| 12 | `docs/offline-edition/10` title | "Phase O1 complete (stopped before O2)" | O2 done (banner added, title not) | Outdated |
| 13 | `docs/offline-edition/02 §3` vs your requirement | broad offline scope | requirement: waiter/admin/manager + bill printing only | **Contradictory (business)** |
| 14 | `docs/phonepe-integration/INTEGRATION_GAP_ANALYSIS.md` G6, G7 | env-selection bug and missing amount check open | fixed in uncommitted code (`utils/phonePeEnv.js`, `checkPaidAmount`) | Outdated |
| 15 | `discovery/fact_sheet.md` §10 H2 | "No verify-attempt limit found" | `MAX_OTP_TRIES = 5` (`authController.js:272`) | Outdated |
| 16 | `discovery/fact_sheet.md` | 223 endpoints / 23 route files; 11 customer pages; `docs/audit/` untracked; "no .github" | 276 / 25 (delivery + local added); 13 pages (+Policy, Track); `docs/audit/` now tracked; `.github/modernize/` untracked stub | Outdated |
| 17 | `docs/delivery/04` vs `docs/offline-edition/10` | backend suite 66/69 vs 70/72 | different dates; both "pre-existing failures" | Inconsistent snapshots |
| 18 | `SECURITY_AUDIT.md` | C1, H3 open | fixed | Partly outdated (header says "do not commit", file is committed) |
| 19 | `docs/audit/*` | line references from `feature/inventory-v3` (Oct 28) | code has moved | Possibly stale references |
| 20 | `docs/offline-edition/` numbering | 01–13, 18, 19 | 14–17 do not exist | Gap (not an error) |

### 16.2 Errors and gaps in the earlier `docs/system-design/` package (found in this phase, **not yet corrected** — preserved as requested)

| # | Package doc | Problem | Correct finding |
|---|---|---|---|
| A | `05` §B (waiter) | says the waiter app does not subscribe to `order:status_changed` and relies on refresh | waiter and admin subscribe to 8 events through `ORDER_EVENTS` (`*/src/hooks/useLiveOrders.js:7-10`) and refetch on each |
| B | `10` §4 event table | `kot:status_changed`, `bill:status_changed`, `inventory:alert`, `waiter_call:activity` marked "no listener found"; `table:cleared` listener missing | all consumed: admin `src/notifications/model.js`; `table:cleared` by admin + waiter `useLiveOrders.js` |
| C | `09` §2/§4, `02` | Offline Edition routes listed incompletely | 15 handlers: also `GET /setup/status` (public, LAN), `GET /devices`, `GET /auth/session`, `GET /auth/events` (admin), `GET /staff/pins`, `PUT /staff/:userId/pin` (`routes/localAuthRoutes.js:35-53`) |
| D | `22` R-01, `00`, `16` | presents the leaked printer key as a new finding | already reported on 2026-11-19 in `docs/developer-collaboration-audit/RISK_REGISTER.md` R01 and `FINAL_CTO_RECOMMENDATION.md` — duplication; should cross-reference |
| E | `22` risk register vs `docs/developer-collaboration-audit/RISK_REGISTER.md` | two risk registers with different IDs and scales | duplicated; needs one owner or a mapping |
| F | `17` §3 | `.env.example` copies inside `print-service/dist`, `release`, `client-update-2026-10-09` not mentioned | minor completeness |
| G | `05` §C | kitchen "listens to `order:confirmed`… never receives" — correct; admin `/kitchen` page listens to `kot:created`, `order:status_changed`, `order:cancelled` and receives them via the **staff** room | confirmed, no change needed |
| H | Package scope | already contains diagrams and recommendations — beyond Phase 1 | kept as is; to be revised in the next phase after your review |

### 16.3 Duplication across documentation sets

* Security findings: `SECURITY_AUDIT.md`, `discovery/fact_sheet.md` §10, `docs/developer-collaboration-audit/PROJECT_SECURITY_AUDIT.md`, `docs/system-design/16` + `22`.
* Repository/tech inventory: `discovery/fact_sheet.md` §1–9, `docs/offline-edition/01`, `docs/system-design/02`.
* Offline architecture: `docs/offline-edition/02–09` and `docs/system-design/14–15` (the latter restates and points to the former).
* PhonePe: `CLAUDE.md` Payment section, `docs/phonepe-integration/*`, `docs/system-design/12`.
* Delivery: `CLAUDE.md` Home delivery, `docs/delivery/*`, `docs/system-design/21`.

Recommendation for the next phase (not done): treat `CLAUDE.md` (rules), `docs/offline-edition/` (offline design) and `docs/phonepe-integration/` (payments) as sources, and make `docs/system-design/` link to them instead of restating them.
