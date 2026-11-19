# Discovery Fact Sheet — Restaurant Management System ("Zen OS" / "Sohoj")

## 0. Baseline for answers: `main` @ `d6da6f6` (re-run 2026-11-19)

Sections 7–8 below were run on `feature/offline-first`. Per the scope decision, PRD/TDT answers use `main`, re-verified in a detached worktree (same `node_modules`):

| Check | `main` result |
|---|---|
| Backend tests (`for f in test/*.test.js`) | **55/55 files pass** |
| Print-service `npm test` | **PASS** (exit 0, all suites "ALL TESTS PASSED") |
| Frontend tests | admin floorState PASS, admin menuCategories PASS, waiter tableSession PASS, kitchen i18n PASS, **waiter i18n FAIL** (customer has no tests on main) |
| `vite build` admin/customer/waiter/kitchen | all **PASS** (customer and waiter chunk > 500 kB warning) |
| admin `eslint .` | **FAIL**, 5 errors: dup key 'Break' `admin/src/i18n/bn/staff.js:254`; unused vars `admin/src/pages/admin/OrdersPage.jsx:728-729` |
| admin i18n check | **FAIL**, 18 missing Bengali entries (4063 `t()` calls) |
| Backend size | 22 route files, 208 endpoints, 28 services |
| Security on main | C1 fixed (`authController.js:746`). C2 **open** (`sockets/socket.js:341,362,370`). H6 **open** (`server.js:124`). No rate limiter or helmet. `/auth/admin/send-otp` still routed |
| Not on main (unmerged) | `utils/diningRadius.js` (commit `4800c42`), Inventory V3, `inventory_manager` role, PWA/offline, runtime config |

The 3 backend test failures (editAfterKitchen, payFirst, menuStructure) and customer `addonQuantity` exist **only on `feature/offline-first`**.

Audit date: 2026-11-19. Branch inspected: `feature/offline-first` (HEAD `ff0d526`).
All facts below come from the repo, or from commands run during this audit. Secrets are named, never shown.

## 1. Repository and git

| Item | Value |
|---|---|
| Remote | `github.com/gourangabwn98/zen-os-restaurant-management` (origin) |
| Default branch | `main`, latest commit `d6da6f6` (2026-10-12, "print queue fixed") |
| Current branch | `feature/offline-first`, 30 commits ahead of `main` (last 2026-11-16) |
| Other branches | `dev` (+5 vs main, 2026-10-16), `feature/inventory-v3` (+24, 2026-10-28), `feature/waiter-performance-payment-workflow` (+15, 2026-10-27), `feature/duty-history` (merged, 0 ahead), `feature/khoai-batch-1` (merged, 0 ahead) |
| Tags | none |
| History | 168 commits on this branch, 2026-09-05 → 2026-11-16. Authors: `gourangabwn98` (163), `Gouranga Ghosh` (8) |
| Strategy (inferred) | feature branches → `dev` → `main`. No PR or CI metadata in repo. Many recent commit messages are terse ("fixed", "test", "inv") |
| Untracked | `docs/audit/` (5 Android print-agent design docs) |
| Committed binaries | `Admin_provider.zip` (~34 MB), `print-service/client-update-2026-10-09/SohojPrintService.exe`, `print-service/client-update-2026-10-10.zip` + `.exe` |

## 2. Structure, languages, frameworks

All JavaScript (ESM). No TypeScript, Dockerfile, IaC or CI config. Node v22.22.1 was used locally; no `engines` field anywhere.

| App | Package name | Stack (key versions) | Port |
|---|---|---|---|
| `restaurant-server/` | server 1.0.0 | Express ^5.2.1, Mongoose ^9.2.3, Socket.IO ^4.8.3, jsonwebtoken ^9, firebase-admin ^13.9, twilio ^5.12, cloudinary ^2.10, multer ^2.1, tesseract.js ^7, pdf-parse ^2.4, node-thermal-printer, qrcode, compression, cors | env `PORT` |
| `admin/` | adda-admin 0.0.0 | React ^19.2, react-router-dom ^7.13, Vite ^8, vite-plugin-pwa 2.0.0, firebase ^12.13, ESLint 9 | 5173 default |
| `customer/` | sohoj-customer 1.0.0 | React ^18.2, react-router-dom ^6.22, Vite ^5, firebase ^10.12 | 5173 |
| `waiter/` | sohoj-waiter 1.0.0 | React ^18.2, Vite ^5, PWA, firebase ^10.14 | 5174 |
| `kitchen/` | sohoj-kitchen 1.0.0 | React ^18.2, Vite ^5, PWA | 5175 |
| `print-service/` | sohoj-print-service 1.0.0 | Node CLI, socket.io-client, node-thermal-printer, usb ^3.1, esbuild + postject → `SohojPrintService.exe` | n/a |
| `Admin_provider/` | (not a source app) | Unpacked print-service release (`SohojPrintService.exe`, `README.txt`, `printers.config.json`) | n/a |

**Hosting (from docs and config comments, not verified live):** backend on Render (`*.onrender.com` in `*/public/config.js` comments; `docs/INVENTORY_V3_ROLLOUT.md` mentions "Render's `/api/health`"). Frontends on Vercel (`admin|customer|waiter/vercel.json` SPA rewrites; `zen-os-customer.vercel.app` in `docs/HOTEL_KHOAI_CHANGE_ROUND.md`). `kitchen/` has no `vercel.json`. Print service runs on-premises on Windows.
Runtime API/socket URLs come from `public/config.js` (commit `aec6341`).

## 3. Backend inventory

- **Bootstrap:** `restaurant-server/server.js`. Middleware: cors, compression, JSON 10 MB, `sanitizeInput` (drops `$` keys). `/api/health` at L92. `notFound` + `errorHandler`.
- **Route groups (23 files, 223 endpoints):** auth 13, menu 22, orders 9, payments 3, invoices 3, admin/tables 7, admin/table-sessions 3, admin/waitlist 5, admin/inventory 28, admin/inventory/v3 24, admin/chefs 5 (legacy), admin/employees 25, reviews 2, kitchen 2, admin/restaurant (profile) 8, admin 25, categories 12, support 2, admin/printer 7, notifications 5, waiter-calls 3, coupons 3, attendance 7. Plus the unauthenticated `GET /api/test-whatsapp/:phone` (`server.js:129`). There is no OpenAPI/Swagger file.
- **Controllers:** 26. **Services:** 34 (order, inventory, inventoryV3*, payment (PhonePe), payFirst, kot, billing, combinedBill, coupon/couponOffer, menu*, attendance, leave, staffReport, insights, waitlist, waiterCall, notification, printerDevice, etc.). **Utils:** 32.
- **Background jobs (setInterval in `server.js`; off when `DISABLE_BACKGROUND_JOBS=true`):** scheduled offers (30 s), auto-send to kitchen (15 s), pay-first promote/expire (60 s), category-ordering reset (60 s).
- **Realtime:** `sockets/socket.js`. Rooms are tenant / staff / kitchen / printers / order / user.
- **Scripts:** `scripts/importMenu.js`, `scripts/migrate-khoai.js`, `scripts/setup-inventory-v3.js`. `npm run seed` points at `seed.js`, **which does not exist**.

## 4. Data model (MongoDB, single DB via `MONGO_URI`)

There are no migrations framework, ERD or seed data. Schemas live in `config/getModels.js` (47 `Schema(` occurrences, 44 `index(` calls) and `config/inventoryV3Models.js` (12 companion schemas, V3 only).
Registered models: User, RestaurantProfile, Category, Chef (legacy), MenuItem, MenuTime, Order, Counter, Table, TableSession, KOTJob, KOTChangeJob, BillPrintJob, PrinterDevice, Invoice, SupportTicket, WaitlistEntry, NotificationLog, AttendanceSession, DutyHistory, StaffReview, StaffLeave, StaffPay, Supplier, InventoryItem, InventoryBatch, Recipe, StockPurchase, StockLedger, WastageLog, WaiterCall, Coupon.
Transactions are used for order, KOT and stock operations, which needs a replica set (Atlas `mongodb+srv` implied by `.env.example`).

## 5. Auth, roles, permissions

- **Roles** (`utils/roles.js`): admin, manager, waiter, chef, customer, plus `inventory_manager` (L22), which CLAUDE.md doesn't document. Guest ordering uses a per-order guest token (`utils/guestOrderToken.js`).
- **Login:**
  - Customer: Firebase phone OTP, verified server-side (`/auth/firebase-verify`).
  - Admin/manager/inventory_manager: Firebase ID token now verified server-side in `firebaseLogin` (`controllers/authController.js:746`), so audit item C1 is fixed.
  - Employees: backend OTP via Twilio/MSG91/console (`utils/sendOTP.js`) or Firebase.
- **Sessions:** JWT HS256, 7-day expiry, stored in localStorage. No revocation (`tokenVersion` absent).
- **RBAC middleware:** `middleware/rbac.js` (requireAdmin/Management/Staff/Kitchen/Employee), `managerScope.js`, `dutyMiddleware.js`, `validateIds.js`. Startup secret check: `config/securityCheck.js`.
- **OTP abuse:** `utils/otpGuard.js` limits OTP *sends* to 5 per hour per phone. There is no `express-rate-limit`, no `helmet`, and no `trust proxy`.

## 6. External integrations (names only)

Firebase Auth + FCM push (`FIREBASE_*`), Cloudinary images (`CLOUDINARY_*`), Twilio SMS + WhatsApp (`TWILIO_*`), MSG91 SMS (`MSG91_*`), PhonePe PG (`PHONEPE_*`, `PUBLIC_API_URL`), UPI deep link (DB-configured), MongoDB Atlas (`MONGO_URI`), tesseract.js OCR (downloads trained data on first run), thermal printers (LAN/USB/USB_DIRECT, print-service `PRINTER_KEY`).
Real `.env` files exist locally in `admin/`, `customer/` and `waiter/`. They are git-ignored and were not read.

## 7. Tests — run results (2026-11-19, Node v22.22.1)

| Suite | Command | Result |
|---|---|---|
| Backend | `for f in test/*.test.js; do node $f; done` | **61/64 files pass, 3 fail** |
| ↳ `editAfterKitchen.test.js` | | 17 pass / 1 fail: "a manager can do it too (READY)…" throws "A valid device location is required to place a dine-in order" |
| ↳ `payFirst.test.js` | | 13 pass / 1 fail: "pay-first dine-in order does NOT open/join the table session until paid", same dining-radius error |
| ↳ `menuStructure.test.js` | | 7 pass / 1 fail: "GET /menu/structure: customers see only available items outside scheduled-out sections" (expected `true`, got `undefined`) |
| Print-service | `npm test` (13 chained suites) | **PASS**, exit 0, final integration suite 6/6 |
| Admin | `node test/*.test.js` | floorState PASS. **menuCategories FAIL**: missing 'Rice' in expected list |
| Customer | | **addonQuantity FAIL**: "Couldn't update your order" |
| Waiter | | 4/5 PASS. **i18n FAIL**: untranslated key(s), e.g. 'Gazebo' |
| Kitchen | | i18n PASS |
| Admin i18n | `npm run i18n:check` | **FAIL**: 19 missing Bengali entries (4242 `t()` calls) |
| Coverage | — | No coverage tooling configured in any app |

**Root cause of 2 backend failures (inferred):** dining-radius enforcement (`utils/diningRadius.js`, commit `4800c42` "location add for customer", 2026-10-28) now rejects dine-in orders without a device location, and those fixtures don't send one.
README claims "91 assertions, all passing", which is now outdated.

## 8. Builds and lint (2026-11-19)

| App | `vite build` | Notes |
|---|---|---|
| admin | **PASS** | PWA precache 67 entries |
| customer | **PASS** | warning: chunk 604 kB > 500 kB |
| waiter | **PASS** | chunk-size warning, PWA 26 entries |
| kitchen | **PASS** | 312 kB JS, PWA 20 entries |
| admin `npm run lint` | **FAIL** (5 errors) | duplicate key 'Break' `admin/src/i18n/bn/staff.js:254`; 4 unused vars `admin/src/pages/admin/OrdersPage.jsx:752-753` |

Builds were written to a scratch folder, so the repo `dist/` folders are untouched.

## 9. Dependencies (`npm audit`, 2026-11-19)

| App | Critical | High | Moderate | Low |
|---|---|---|---|---|
| restaurant-server | 1 (proxy-addr) | 6 (body-parser, mongoose, multer, follow-redirects, @grpc/grpc-js, brace-expansion) | 11 | 1 |
| admin | 1 (websocket-driver) | 16 (axios, vite, react-router, multer, …) | 6 | 1 |
| customer | 0 | 8 | 9 | 0 |
| waiter | 0 | 8 | 13 | 0 |
| kitchen | 0 | 3 | 7 | 0 |
| print-service | 0 | 1 | 0 | 0 |

Version drift: admin uses React 19 / Vite 8 / router 7; the other three frontends use React 18 / Vite 5 / router 6. `admin` also lists server-only packages (`multer`, `cloudinary`, `streamifier`) as dependencies.

## 10. Security status (vs `SECURITY_AUDIT.md`, 2026-10-01)

| ID | Finding | Current code |
|---|---|---|
| C1 | Admin login without token verification | **Fixed**: `verifyIdToken` in `firebaseLogin` |
| C2 | Orders + PII emitted to anonymous `tenant` room | **Still open**: `sockets/socket.js:342,366,374` emit full `order` to `rooms.tenant`, which guests join (L126) |
| H1 | NoSQL injection via `idempotencyKey` | Mitigated: global `sanitizeInput` strips `$` keys |
| H2 | OTP brute force / no rate limit | Partial: send limit 5/h. No verify-attempt limit found, no rate limiter. `/auth/admin/send-otp` + `verify-otp` still routed |
| H3 | OTP echo | Fixed: only with `OTP_DEV_ECHO=true` and non-production |
| H5 | `POST /invoices/generate` | Partial: still exists, now `requireStaff` |
| H6 | Unauthenticated `/api/test-whatsapp/:phone` | **Still open**: `server.js:129` |
| L8/L9 | helmet / CORS allow-list | helmet absent |

`SECURITY_AUDIT.md` is committed to the repo, although it says not to commit it.

## 11. Ops: CI/CD, logging, monitoring, backup

- **CI/CD:** none (no `.github/`, no pipeline files). Deploys appear to be Vercel/Render git-integrated, but that is not visible in the repo.
- **Logging:** `console.*` only on the backend. Print-service has `src/logger.js`.
- **Monitoring / APM / error tracking:** none (no Sentry, pino, winston or similar).
- **Backup:** no backup config or scripts. That is Atlas-side if anything, and not determinable from the repo.
- **Load testing:** no scripts. A single perf-flavoured test exists (`test/menuOrderPerf.test.js`).
- **Environments:** `.env.example` for server, kitchen and print-service. README says admin and customer also have one, but the repo has none for admin/customer/waiter.

## 12. Docs, tech debt

- **Docs:** `README.md`, `CLAUDE.md`, `SECURITY_AUDIT.md`, `docs/HOTEL_KHOAI_CHANGE_ROUND.md` (client change round, 2026-10-04), `docs/INVENTORY_V3_ROLLOUT.md`, `docs/inventory-reference.html`, untracked `docs/audit/*` (Android print agent: feasibility, architecture, roadmap, contract, exec summary), and per-app READMEs.
- **README is stale.** It names a `backend/` folder, says "no payment gateway" (PhonePe now exists), says "5 frontend apps", and points `npm run seed` at a file that doesn't exist.
- **TODO/FIXME/HACK:** 0 occurrences in source.
- **Legacy code kept:** `Chef` model, `chefRoutes.js`, `ChefsPage.jsx`, legacy socket emits, commented-out old `firebaseLogin` (`authController.js` ~L676-730).
- **Open owner decisions** (`docs/HOTEL_KHOAI_CHANGE_ROUND.md:171`): ORD-01 (manager override after KOT), EMP-02 (leave carry-forward cap), INV-02 (`AUTO-` bill prefix), AUD-01 (pure-veg mode). There is also a known issue: a customer Firebase login with an employee phone returns the employee's token (L184).
- **Inventory V3:** P1–P5 implemented on `feature/inventory-v3`, off by default (`INVENTORY_V3_ENABLED`). Its doc says "The actual deployed SHA has not been verified."
- **Frontend pages:**
  - Customer (11): Home, Menu, Offers, Cart, Favorites, Orders, OrderDetail, Help, Profile, Notifications, Login.
  - Waiter (7): Login, Tables, Orders, NewOrder, OrderDetail, Profile, Activity.
  - Kitchen (3): Login, KitchenBoard, Profile.
  - Admin (`/admin/*` layout): Dashboard, Orders, Invoices, Tables, Menu, Inventory (legacy, V3, manager), Employees, Coupons, Offers/Notifications, Analytics/Insights, Profile, Users, Help, Chefs (legacy), plus a KitchenDisplay page.
