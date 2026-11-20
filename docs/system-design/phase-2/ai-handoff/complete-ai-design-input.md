# Complete AI Design Input — Zen OS

Single self-contained input for an AI assistant doing design, documentation or diagram work on Zen OS. Generated 2026-11-20 from a read-only audit of branch `features/offline-edition` (working tree). Sources: `docs/system-design/PHASE-1-DISCOVERY-REPORT.md` and `docs/system-design/phase-2/`.

## Instructions to the AI

1. Treat every statement labelled IMPLEMENTED as fact about the code. Treat PLANNED, PROPOSED, UNKNOWN and OPEN DECISION exactly as labelled — never upgrade them.
2. Do not invent endpoints, collections, services, cloud products, hostnames, credentials or integrations. If something is not here, say it is unknown.
3. Keep the non-negotiable rules (section A) in every design you propose. A proposal that breaks one must say so explicitly.
4. When you propose something, label it PROPOSED and state what it changes, what it depends on and which open decision it needs.
5. Never include secrets, phone numbers, IP addresses or domains.
6. Prefer the existing patterns: server-side authority, atomic conditional writes, unique indexes for idempotency, one transaction for kitchen send, role-scoped socket rooms, one writer per restaurant database.

---

## A. Project context

_(same content as [project-context.md](project-context.md))_

Read this first. Facts are verified from the repository on 2026-11-20 unless labelled. No secrets, hostnames, phone numbers or IPs are included — never invent them.

### What it is
Zen OS is a **single-restaurant** POS and operations platform (first client brand in UI: "Hotel Khoai"; package prefix "Sohoj"). One deployment = one restaurant = one MongoDB database. Volume ≈ 200 orders/day.

### Parts
| Part | Tech | Status |
|---|---|---|
| `restaurant-server` — the only backend | Node 22, Express 5, Socket.IO 4, Mongoose 9 | IMPLEMENTED |
| `admin` web app | React 19, Vite 8, PWA | IMPLEMENTED |
| `waiter`, `kitchen` web apps | React 18, Vite 5, PWA | IMPLEMENTED |
| `customer` web app | React 18, Vite 5 | IMPLEMENTED |
| `delivery-app` rider app | React Native 0.77 + Kotlin (Android) | IMPLEMENTED (unmerged branch) |
| `print-service` Windows print bridge | Node → `SohojPrintService.exe` | IMPLEMENTED |
| Offline Edition (same backend on a restaurant PC) | `DEPLOYMENT_MODE=LOCAL`, local MongoDB replica set, PIN login | PARTIAL (phases O1/O2, uncommitted) |
| Cloud sync | — | PLANNED, not approved |
| Android print agent | — | PROPOSED (design docs only, no code) |

### People / roles
`admin` (owner), `manager`, `inventory_manager`, `waiter`, `chef`, `customer`, `staff` (no login), `delivery` (rider). All are documents in one `User` collection.

### Non-negotiable rules
1. The server decides price, order status, source, payment status, role and stock.
2. Order status follows a strict state machine (see workflow brief).
3. Exactly one KOT per order; edits after the KOT create change slips.
4. Money is PAID only by a checksum-verified gateway result or an explicit staff action; a UPI link or redirect is never proof.
5. Chefs never receive customer contact or payment data in real time.
6. One writer per restaurant database (also offline).
7. Never hard-code status strings; use the canonical enums.

### Canonical enums
* Order status: `AWAITING_PAYMENT, PENDING_CONFIRMATION, CONFIRMED, PREPARING, READY, DELIVERED, COMPLETED, CANCELLED`
* Order type: `DINE_IN, TAKEAWAY, ONLINE` · Source: `CUSTOMER, WAITER, ADMIN`
* Payment status: `PENDING_VERIFICATION, PAID, FAILED` · Payment method: `Cash, Online, Both` (mixed case is correct)
* Bill status: `OPEN, SETTLED` · Print job: `PENDING, PRINTING, PRINTED, FAILED, SKIPPED`
* PhonePe attempt: `CREATED, PENDING, SUCCESS, FAILED, AMOUNT_MISMATCH`
* Delivery job: `SEARCHING, ASSIGNED, AT_RESTAURANT, PICKED_UP, AT_CUSTOMER, DELIVERED, FAILED, CANCELLED`
* Deployment mode: `CLOUD_PRIMARY` (default), `LOCAL_PRIMARY`

### Open decisions (do not assume an answer)
OD-1 offline scope (restricted: waiter/admin/manager + bill printing, vs full); OD-2 guest ordering; OD-3 printer-key rotation; OD-5 PhonePe V1/V2 and refunds; OD-6 delivery/packing charges; OD-7 Android print agent.

### Status labels you must keep
IMPLEMENTED · PARTIAL · PLANNED · PROPOSED · UNKNOWN · OPEN DECISION. Never present PLANNED/PROPOSED items as existing.

---

## B. System architecture

_(same content as [system-architecture-brief.md](system-architecture-brief.md))_

### Style
Server-authoritative modular monolith + thin clients + on-premises print bridge. Real-time by Socket.IO role-scoped rooms; clients refetch on events.

### Containers and interactions (IMPLEMENTED)
| From | To | Protocol | Auth |
|---|---|---|---|
| admin, waiter, kitchen, customer, delivery-app | restaurant-server REST `/api/*` | HTTPS JSON | Bearer JWT (customers may be guests for some reads; guest order token header) |
| same | restaurant-server Socket.IO | WSS | JWT in handshake, or anonymous guest |
| print-service | restaurant-server Socket.IO | WSS outbound from restaurant | printer key (hash stored server-side) |
| restaurant-server | MongoDB | wire protocol | URI credentials; transactions need a replica set |
| restaurant-server | PhonePe V1 | HTTPS `/pg/v1/pay`, `/pg/v1/status` | X-VERIFY (salt key) |
| PhonePe | restaurant-server `/api/payments/phonepe/callback` | HTTPS | X-VERIFY checked in constant time |
| restaurant-server | Firebase (verify ID tokens, FCM), Twilio/MSG91 (OTP, WhatsApp), Cloudinary (images), Google Routes (ETA) | HTTPS | API keys in backend env |
| print-service | printers | TCP 9100 / Windows share / WinUSB | none |

### Backend layers
routes (25 files, 276 handlers) → middleware (auth, RBAC, manager scope, waiter duty gate, id validation) → thin controllers → services (business rules, transactions) → Mongoose models (55 collections) → MongoDB. `sockets/socket.js` owns handshake, rooms and all emits. Five in-process ticks: offers 30 s, auto-send to kitchen 15 s, pay-first 60 s, delivery 5 s, category reset 60 s.

### Socket rooms
`tenant` (everyone, incl. anonymous), `staff` (admin, manager, waiter), `kitchen` (chef only; PII-stripped), `printers` (print bridges), `order:{id}`, `user:{id}`, `delivery-admin`, `track:{jobId}`.

### Deployment shapes
* CLOUD_PRIMARY (production): backend on Render (inferred), admin/customer/waiter on Vercel (inferred), kitchen hosting UNKNOWN, MongoDB Atlas (inferred), print-service on a restaurant Windows PC.
* LOCAL_PRIMARY (Offline Edition, O1/O2 uncommitted): backend + MongoDB replica set + the four web apps (ports 8080–8083) on a restaurant PC; staff log in with phone + PIN on admin-approved devices.

### Known defects to show honestly
Legacy socket events send full orders to the anonymous `tenant` room; deactivated staff can still open sockets in cloud mode; printer keys committed in git archives; unauthenticated WhatsApp test route; no CI; single backend instance.

### PLANNED / PROPOSED (draw dashed, label)
Sync agent + cloud mirror/relay (PLANNED, not approved); local HTTPS, installer, backups (PLANNED); LAN customer ordering (PLANNED); restricted-offline capability gate (PROPOSED); Android print agent (PROPOSED); PhonePe V2 + refunds (PLANNED); print job lease + station routing (PROPOSED).

---

## C. Database architecture

_(same content as [database-architecture-brief.md](database-architecture-brief.md))_

MongoDB, one database per restaurant, Mongoose 9. Transactions used for kitchen send, edits after KOT, cancellation with stock reversal, delivery accept/hand-over, some menu and inventory operations (requires a replica set). No soft delete. No migrations framework.

### Collections (55)
* Identity/config: User, RestaurantProfile (singleton by convention), Counter (order numbers), PrinterDevice
* Menu: Category, MenuTime, MenuItem, Chef (legacy, unused)
* Orders/floor: Order, Table, TableSession, KOTJob, KOTChangeJob, BillPrintJob, Invoice (legacy), WaitlistEntry, WaiterCall
* Engagement: Coupon, NotificationLog, SupportTicket, StaffReview
* People: AttendanceSession, DutyHistory (append-only), StaffLeave, StaffPay
* Inventory: Supplier, InventoryItem, InventoryBatch, Recipe, StockPurchase, StockLedger (append-only by convention), WastageLog
* Delivery: DeliveryPartnerState, DeliveryJob, DeliveryOffer, DeliveryLocation (TTL 7 d), DeliveryEvent (append-only), CodCollection
* Inventory V3 (feature flag, created by a setup script): 12 companion collections (settings, configs, financial entries, recurring rules, cost schedules, counts, book expectations/confirmations, loss classification, operations, audit)
* Offline Edition only: StaffDevice, StaffPin, LocalSession, LocalRateLimit, LocalAuthEvent (append-only), LocalSetupState

### Key relationships and constraints
| Relationship | Constraint |
|---|---|
| Order → KOTJob | 1:1, unique `order` |
| Order → KOTChangeJob | 1:N, unique `{order, revision}` |
| Order → BillPrintJob | 1:N (reprints); combined bills by `requestKey` (unique) |
| Table → TableSession | one OPEN session per `tableNo` (partial unique) |
| TableSession ↔ Order | many orders per session (two-way references) |
| Order → Order | `parentOrder` = root of follow-up orders |
| MenuItem → Recipe | 1:1, unique |
| Recipe → InventoryItem | ingredients (many) |
| InventoryItem → StockLedger | movements (with related order/purchase/wastage) |
| User → AttendanceSession | one OPEN per employee |
| AttendanceSession → DutyHistory | unique `{session, action, at}` |
| Order → DeliveryJob, CodCollection | 1:1 each, unique |
| DeliveryJob → DeliveryOffer | unique `{job, partner, round}` |
| Order.idempotencyKey | partial unique (string only) |
| MenuItem.category | string section key — **not** a reference |

### Order document (central aggregate)
Identity (`orderId` unique from Counter, `user` = the logged-in caller), lines (menu item ref + name/price/size/add-on snapshots + making cost), money (subtotal, tax, service charge, AC-room charge, discount, total, coupon snapshot), context (type, table, area, session, source, priority, delivery address), lifecycle (status, per-step actor/time, statusHistory, autoPrepareAt, paymentDeadline, revision), payment (paymentStatus, method, split, paidBy/At, PhonePe attempt sub-document), bill (billStatus, settledAt/By), stock (stockDeducted, stockReversed, stockDeductions).

### Known data risks
Table session opened outside the order-insert transaction; hard deletes of referenced documents; missing indexes on `Order.user` and tick queries; Inventory V3 indexes depend on a setup script; legacy `Invoice` enums (`"Dining"`, no `Both`).

### Field-level reference
`docs/system-design/07-database-dictionary.md`, DBML `docs/system-design/diagrams/schema.dbml`.

---

## D. Workflows

_(same content as [workflow-architecture-brief.md](workflow-architecture-brief.md))_

### Order state machine (IMPLEMENTED)
| From → To | Allowed actor |
|---|---|
| (new) → AWAITING_PAYMENT | customer paying online with PhonePe configured |
| (new) → PENDING_CONFIRMATION | customer |
| (new) → CONFIRMED | waiter, manager, admin (staff order) |
| AWAITING_PAYMENT → PENDING_CONFIRMATION | system, after verified payment |
| AWAITING_PAYMENT → CANCELLED | customer, admin, manager, system (15-minute deadline) |
| PENDING_CONFIRMATION → CONFIRMED | admin, manager, waiter |
| PENDING_CONFIRMATION → CANCELLED | admin, manager, waiter, customer |
| CONFIRMED → PREPARING | system timer, admin, manager, waiter, chef — always via one transaction with stock deduction and KOT creation |
| CONFIRMED → CANCELLED | admin, manager, waiter |
| PREPARING → READY | admin, manager, waiter, chef |
| PREPARING → CANCELLED | admin, manager (stock reversed) |
| READY → DELIVERED | admin, manager, waiter, rider (OTP hand-over) |
| READY/DELIVERED → PREPARING | only when items are added after the KOT (not a manual transition) |
| DELIVERED → COMPLETED | system, when the bill is settled and PAID |
| PREPARING/READY/DELIVERED → COMPLETED | admin or manager, only if PAID |
Admin may force any status as a flag change without side effects.

### Main flows
1. **Customer QR order:** scan table QR → menu → server quote → login (Firebase phone) → place order (idempotency key, table token, device location within dine-in range) → staff notified (`order:new`) → staff accepts → edit window (default 3 min from placement) → server auto-sends to kitchen: PREPARING + stock + KOT in one transaction → KOT pushed to kitchen screen and print bridge → chef marks READY → waiter marks served → bill printed → settle (cash / online / split) → COMPLETED → table session closed.
2. **Staff order:** placed as CONFIRMED by an on-duty waiter/manager/admin; same edit window and kitchen send.
3. **Edit after KOT:** staff only, bill open; re-price, give back old stock and deduct new, change slip listing only differences (unique per revision), re-open READY/DELIVERED when items added.
4. **Follow-up order:** new order linked to the root, own KOT, billed together.
5. **Pay-first PhonePe:** order AWAITING_PAYMENT (invisible to staff) → initiate (server amount) → PhonePe → verified callback or status poll → atomic apply (amount must match) → PENDING_CONFIRMATION → normal flow; unpaid cancelled after 15 min.
6. **Printing:** job persisted → pushed to printers room → bridge disk queue → print → status reported; bridge pulls the queue on every connect and every 5 s; jobs older than 30 min are skipped.
7. **Home delivery (branch):** CONFIRMED → delivery job → offers to riders in rounds → atomic accept with capacity → pickup when READY → OTP drop (DELIVERED) → COD custody → management verifies → PAID/SETTLED/COMPLETED.
8. **Duty:** waiter must be on duty for order writes; ON/OFF only by explicit action; every change audited.

### Failure behaviour
Duplicate submit → same order; concurrent accept → 409; concurrent edit → 409 (revision); stock shortage at kitchen send → order parked with reason and staff alert; printer offline → job waits; > 30 min → skipped (no alert yet); paid-then-cancelled → no automatic refund (PLANNED).

### PLANNED / PROPOSED workflows (label them)
LAN guest ordering with signed table tokens (PLANNED O3); restricted-offline capability gate (PROPOSED); sync drain on reconnect (PLANNED); refunds (PLANNED); print skip alerts, station routing, job lease (PROPOSED); Android print agent (PROPOSED).

---

## E. Infrastructure

_(same content as [infrastructure-architecture-brief.md](infrastructure-architecture-brief.md))_

### Production (CLOUD_PRIMARY) — hosting inferred from repo config
| Element | Platform | Evidence | Status |
|---|---|---|---|
| Backend (single instance, in-process ticks) | Render | `RENDER_GIT_COMMIT` read in `server.js` | Inferred |
| admin, customer, waiter | Vercel | `vercel.json` SPA rewrites | Inferred |
| kitchen | — | no hosting config | UNKNOWN |
| Database | MongoDB Atlas | `mongodb+srv` handling | Inferred |
| Print bridge | Windows PC at the restaurant | `.exe` builds | Verified |
| Rider app | Android phones | Gradle project; distribution UNKNOWN | — |
| CI/CD, Docker, IaC, monitoring, alerting | none | — | ABSENT |
| Backups | Atlas config not in repo | — | UNKNOWN |

### Offline Edition (LOCAL_PRIMARY) — O1/O2 implemented, uncommitted
Restaurant PC (Windows): Node 22 running the same backend with `DEPLOYMENT_MODE=LOCAL`; MongoDB 7 single-node replica set bound to 127.0.0.1; four web apps served on ports 8080 (customer), 8081 (admin), 8082 (waiter), 8083 (kitchen); print bridge pointing at localhost; `/local/health` (LAN only). Startup refuses remote/`+srv`/non-replica-set URIs, the sandbox JWT secret, OTP echo, and a missing/short PIN pepper. Setup is manual today; installer, Windows services, scheduled backups and recovery tools are PLANNED (O9). Plain HTTP on the LAN until O5 (PLANNED).

### Configuration (names only)
Backend: `MONGO_URI, JWT_SECRET, FIREBASE_*, CLOUDINARY_*, TWILIO_*, MSG91_*, PHONEPE_ENV, PHONEPE_MERCHANT_ID, PHONEPE_SALT_KEY, PHONEPE_SALT_INDEX, PUBLIC_API_URL, CLIENT_URL, CUSTOMER_FRONTEND_URL, TZ, INVENTORY_V3_ENABLED, GOOGLE_ROUTES_API_KEY, DISABLE_BACKGROUND_JOBS, MONGO_DNS_SERVERS, OTP_DEV_ECHO`. LOCAL: `DEPLOYMENT_MODE, LOCAL_PIN_PEPPER, LOCAL_SITE_ID, LOCAL_SESSION_HOURS, LOCAL_PORT_*, LOCAL_APPS_DIR`. Frontends: `VITE_API_URL, VITE_FIREBASE_*, VITE_GOOGLE_MAPS_KEY` + runtime `public/config.js`. Print bridge: `BACKEND_URL, PRINTER_KEY, MAX_ATTEMPTS, MAX_JOB_AGE_MINUTES, …`. Restaurant settings (GST, UPI, edit window, delivery policy) live in the database, not env.

### Network
All clients connect outbound to the backend; the print bridge dials out (no inbound port at the restaurant). PhonePe calls the backend's public callback URL. CORS currently allows any origin.

### Single points of failure
Cloud backend; restaurant internet (cloud mode); the print PC; the restaurant PC in LOCAL mode; Firebase/SMS for logins in cloud mode.

### PROPOSED target
CI gate (tests, builds, lint, dependency audit) → main-only production deploys → deployed SHA recorded; build artifacts (print bridge, local bundle) distributed outside git; uptime probe and structured logs with alerts; verified Atlas backups with a restore drill; scheduled local backups; stay single-instance (adequate for ~200 orders/day) unless scaling requires a Redis Socket.IO adapter.

---

## F. Security summary

| Priority | Finding | Evidence | Status |
|---|---|---|---|
| Critical | Printer key (`.env`) and customer names/phones (print queue) committed inside `Admin_provider.zip` and `print-service/client-update-2026-10-10.zip`; first reported 2026-11-19 in `docs/developer-collaboration-audit/RISK_REGISTER.md` R01 | `git ls-files` | open — OD-3 |
| High | Legacy socket events send full orders (PII, payment) to the `tenant` room that anonymous sockets join; no client listens to them | `sockets/socket.js:414, 438, 446` | open |
| High | Unauthenticated `GET /api/test-whatsapp/:phone` sends WhatsApp messages | `server.js:151-160` | open |
| High | Socket handshake does not refuse deactivated staff in cloud mode | `sockets/socket.js:108-109` | open |
| High | JWT 7–30 days in `localStorage`, no revocation in cloud mode | `controllers/authController.js` | open |
| Medium | OTP via `Math.random`, in-memory; no helmet; CORS `*`; no global rate limit; 404 returned as 500 | various | open |
| Strong | Server-side pricing; state machine; verified-only payments (constant-time checksum, amount match, final states); idempotent jobs; PII-stripped kitchen room; LOCAL PIN auth with device approval and instant revoke | | implemented |

## G. Offline options (OPEN DECISION OD-1)

| Option | Description | Status |
|---|---|---|
| F — Full | Restaurant PC is the single writer for everything (staff, kitchen, inventory, customers on Wi-Fi after O3); cloud mirror later | approved design; O1/O2 implemented |
| R1 — Restricted | Same infrastructure; a server-side capability gate allows only waiter/admin/manager operations and bill printing (KOT printing to be confirmed) while the internet is down | PROPOSED |
| R2 — Failover | Cloud stays writer; local server takes over during outages and replays later | PROPOSED, not recommended (two writers) |

Sync (any option): change-stream outbox on the site → cloud ingest with `siteId:syncSeq` idempotency; inbox for remote orders, PhonePe callbacks (verified on site), customer upserts and revocations; site wins for site-owned data. PLANNED, production sync not approved.

## H. Open decisions

| ID | Decision |
|---|---|
| OD-1 | Restricted (R1) or Full (F) offline; is KOT printing included offline |
| OD-2 | Is login-required customer ordering intended in the cloud |
| OD-3 | Rotate leaked printer keys now; rewrite git history |
| OD-4 | Correct or retire the earlier `docs/system-design/00–27` package |
| OD-5 | PhonePe V1 or V2 credentials; refund handling until refunds exist |
| OD-6 | Charge delivery fee / packing charge (configured, never applied) |
| OD-7 | Android print agent go/no-go and printer models |

## I. Roadmap summary (PROPOSED, each phase needs approval)

0 Decisions → 1 Security quick fixes → 2 Review/commit current branch, fix docs drift → 3 CI and green tests → 4 Offline core (O5 HTTPS, O9 installer/backup, O4 degrade) → 5A Restricted gate or 5B LAN customers + rider claims → 6 Sync (mock cloud, then cloud with approval) → 7 Payments (refunds, reconciliation, V2) → 8 Printing (skip alerts, routing, lease) → 9 Android print agent pilot → 10 Pilot restaurant.

## J. Where to find more

| Topic | File |
|---|---|
| Verified discovery with evidence | `docs/system-design/PHASE-1-DISCOVERY-REPORT.md` |
| Requirements | `phase-2/01-business-requirements.md`, `02-functional-requirements.md` |
| Architecture by area | `phase-2/03` … `14` |
| Tests, ADRs, roadmap | `phase-2/15`, `16`, `17` |
| Mermaid sources | `phase-2/diagrams/` |
| C4 model | `phase-2/c4/workspace.dsl` |
| Field-level data dictionary, DBML | `docs/system-design/07-database-dictionary.md`, `docs/system-design/diagrams/schema.dbml` |
| Offline design (authoritative) | `docs/offline-edition/` |
| PhonePe plan (authoritative) | `docs/phonepe-integration/` |
| Engineering rules (authoritative) | `CLAUDE.md` |
