# 02 — Repository and Technology Inventory

Status legend: see [01 §2](01-project-overview.md#2-status-legend-used-in-every-document).

## 1. Repository structure (verified)

```
Restaurant-Management-System/          (git; 891 tracked files at audit time)
├── restaurant-server/   Node backend — the only API/DB writer            221 tracked files
│   ├── server.js        bootstrap, route mounting, 5 background ticks
│   ├── config/          db, models (getModels, delivery, inventoryV3, localAuth), mode checks
│   ├── routes/ (25)  controllers/ (29)  services/ (38)  middleware/ (10)  utils/ (36)
│   ├── sockets/socket.js   all Socket.IO auth, rooms, emitters
│   ├── local/ (4)       Offline Edition: LAN gate, health, static app hosting, login gate
│   ├── scripts/ (5)     importMenu, localReplicaSet, localSandbox, migrate-khoai, setup-inventory-v3
│   └── test/ (73 files + e2e/deliveryE2E.mjs)   plain Node + assert, no jest
├── admin/               React 19 / Vite 8 PWA                            235 tracked files
├── customer/            React 18 / Vite 5 SPA                            108
├── waiter/              React 18 / Vite 5 PWA                             95
├── kitchen/             React 18 / Vite 5 PWA                             50
├── delivery-app/        React Native 0.77.2 + Kotlin (Android; iOS shell) 86   ← not in CLAUDE.md map
├── print-service/       Node CLI → SohojPrintService.exe (Windows)        56
├── docs/                offline-edition (15), phonepe-integration (8), delivery (4),
│                        audit (5, Android printing), developer-collaboration-audit (9), misc
├── discovery/           PRD/TDT/gap spreadsheets + fact_sheet.md
├── Admin_provider/      unpacked print-service install folder (gitignored; contains a .env)
├── Admin_provider.zip   34 MB, TRACKED — contains .env with PRINTER_KEY (see 22, R-01)
├── .claude/agents/      6 Claude Code agent definitions
├── .github/modernize/   untracked tooling stub; no workflows
├── CLAUDE.md  README.md  SECURITY_AUDIT.md (committed despite its own "do not commit" note)
```

There is **no** npm/pnpm workspace, shared library package, Dockerfile, IaC, or CI workflow (ABSENT, High). Each app has its own `package.json` and `node_modules`. Shared constants (status enums, i18n) are **copied** between apps rather than shared (e.g. `admin/src/pages/admin/shared/statusLabels.js`); see technical debt [22](22-technical-debt-and-risks.md).

### Branches (local + origin)
`main`, `dev`, `feature/duty-history`, `feature/inventory-v3`, `feature/khoai-batch-1`, `feature/offline-first`, `feature/waiter-performance-payment-workflow`, and the audited `features/offline-edition` (local only at audit time). No tags. `discovery/fact_sheet.md` §0 records which features are **not on `main`** (dining radius, Inventory V3, `inventory_manager`, PWA/offline, runtime config) — so production may lack them (UNKNOWN which branch is deployed).

## 2. Technology inventory

Installed versions read from each app's `node_modules/*/package.json` on 2026-11-20 (ranges in `package.json` differ). Node v22.22.1 used locally; **no `engines` field** in any web/server package (only `delivery-app`: `node >=18`).

### 2.1 Backend (`restaurant-server/`)

| Technology | Version | Purpose | Where | Status |
|---|---|---|---|---|
| Node.js (ESM) | 22.x local; prod UNKNOWN | Runtime | `"type":"module"` | IMPLEMENTED |
| Express | 5.2.1 | HTTP API | `server.js` | IMPLEMENTED |
| Mongoose | 9.9.4 | ODM, schemas, transactions | `config/getModels.js` etc. | IMPLEMENTED |
| MongoDB | Atlas (cloud, inferred from `mongodb+srv` handling); 7.x replica set (local) | Database | `config/db.js`, `config/deploymentMode.js` | IMPLEMENTED |
| Socket.IO | 4.8.3 | Real-time | `sockets/socket.js` | IMPLEMENTED |
| jsonwebtoken | 9.0.3 | HS256 JWT sessions | `controllers/authController.js`, `middleware/authMiddleware.js` | IMPLEMENTED |
| bcryptjs | ^2.4.3 | Imported; password login is commented out | `authController.js` | PARTIAL (dead) |
| firebase-admin | 13.10.0 | Verify Firebase phone ID tokens; FCM push | `utils/firebaseAdmin.js`, `services/notificationService.js` | IMPLEMENTED |
| twilio | 5.13.1 | SMS OTP, WhatsApp text | `utils/sendOTP.js`, `utils/sendWhatsApp*.js` | IMPLEMENTED |
| MSG91 (REST via axios) | — | SMS OTP fallback | `utils/sendOTP.js` | IMPLEMENTED |
| axios | 1.20.0 | PhonePe, MSG91, Google Routes HTTP | `services/paymentService.js`, `services/routeService.js` | IMPLEMENTED |
| cloudinary + multer + streamifier | ^2.10 / ^2.1 / ^0.1 | Image upload | `config/cloudinary.js`, `middleware/uploadMiddleware.js` | IMPLEMENTED |
| tesseract.js | 7.0.0 | OCR for purchase/menu imports (downloads language data at runtime) | `utils/purchaseImportExtract.js` | IMPLEMENTED |
| pdf-parse | ^2.4.5 | PDF import | same | IMPLEMENTED |
| qrcode | ^1.5.4 | Table QR codes | `controllers/tableController.js` | IMPLEMENTED |
| node-thermal-printer | 4.6.1 | Listed; backend printing is done by print-service | `package.json` | PARTIAL (unused on server — UNKNOWN usage, Low) |
| compression, cors, dotenv | — | gzip, CORS (`origin:"*"`), env | `server.js`, `config/env.js` | IMPLEMENTED |
| mongodb-memory-server (dev) | ^10.4.3 | Tests incl. replica set | `test/` | IMPLEMENTED |
| Test runner | plain `node file.test.js` + `assert` | — | `test/` | IMPLEMENTED |

### 2.2 Web frontends

| Technology | admin | customer | waiter | kitchen | Purpose |
|---|---|---|---|---|---|
| React / react-dom | 19.2.4 | 18.3.1 | 18.3.1 | 18.3.1 | UI |
| react-router-dom | 7.13.1 | 6.30.6 | 6.30.6 | 6.30.6 | Routing |
| Vite | 8.0.0 | 5.4.21 | 5.4.21 | 5.4.21 | Build/dev |
| vite-plugin-pwa / workbox-window | 2.0.0 / 7.4.1 | — | 2.0.0 / 7.4.1 | 2.0.0 / 7.4.1 | Installable PWA, SW |
| firebase (web) | 12.13.0 | 10.14.1 | 10.14.1 | — | Phone auth (+ FCM web push in customer) |
| socket.io-client | 4.8.3 | 4.8.3 | 4.8.3 | 4.8.3 | Real time |
| axios | 1.13.6 | 1.20.0 | 1.20.0 | 1.20.0 | HTTP |
| react-hot-toast | ✓ | ✓ | ✓ | ✓ | Toasts |
| ESLint 9 | ✓ | — | — | — | Lint (admin only) |
| State management | React context + hooks only — **no Redux/Zustand/Query** (by design, `CLAUDE.md`) |||||
| Styling | Hand-rolled CSS/inline styles; no UI kit/CSS framework |||||
| Runtime config | `public/config.js` → `window.__ZEN_CONFIG__` (apiUrl, localServer, maps key), falling back to `VITE_API_URL` |||||
| Server-only deps wrongly listed | `cloudinary`, `multer`, `streamifier` in **admin** `package.json` (debt) |||||

Frontend build-time variables (names only): `VITE_API_URL`, `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_MESSAGING_SENDER_ID` (customer), `VITE_FIREBASE_VAPID_KEY` (customer), `VITE_GOOGLE_MAPS_KEY` (admin, customer), `VITE_INVENTORY_V3_*` (admin).

### 2.3 Delivery app (`delivery-app/`)

| Technology | Version | Purpose | Status |
|---|---|---|---|
| React Native (old architecture) + TypeScript | 0.77.2 / React 18.3.1 | Rider app UI | IMPLEMENTED |
| react-native-maps | ^1.20.1 | Map | IMPLEMENTED |
| socket.io-client | ^4.8.1 | Offers, job updates | IMPLEMENTED |
| Kotlin native modules | — | Foreground location service, Keystore session, FCM service, dialer | IMPLEMENTED (`android/app/src/main/java/com/zenos/delivery/*`) |
| FCM | — | Push offers | PARTIAL (needs `google-services.json`, not in repo) |
| Jest | — | 6 unit tests (route suggestion, polyline) | IMPLEMENTED |
| `debug.keystore` | — | **Tracked in git** (standard RN debug key; not a release key — Low risk) | — |

### 2.4 Print service (`print-service/`)

| Technology | Version | Purpose | Status |
|---|---|---|---|
| Node.js CLI (ESM) | — | Bridge backend → printers | IMPLEMENTED |
| socket.io-client | 4.8.3 | Printer-key socket to backend | IMPLEMENTED |
| node-thermal-printer | 4.6.1 | ESC/POS generation | IMPLEMENTED |
| usb | 3.1.0 (prebuilt N-API) | `USB_DIRECT` WinUSB printers | IMPLEMENTED |
| Windows print share (`copy /b … \\localhost\Share`) | — | `USB` driver-installed printers | IMPLEMENTED |
| PowerShell + GDI+ (`draw-text.ps1`) | — | Bengali/non-Latin text → raster | IMPLEMENTED (Windows only) |
| pngjs, jsqr, qrcode | — | Logo raster, re-render payment QR | IMPLEMENTED |
| esbuild + postject | — | Single-file `SohojPrintService.exe` (Node SEA) | IMPLEMENTED (`scripts/build-exe.mjs`) |
| Tests | 13 suites via `npm test` | — | IMPLEMENTED (PASS on 2026-11-19 per fact sheet) |

### 2.5 External services (summary; full register in [18](18-external-integrations.md))
MongoDB Atlas · Firebase Auth + FCM · PhonePe PG (V1) · Twilio (SMS, WhatsApp) · MSG91 · Cloudinary · Google Maps JS / Directions (browser key) · Google Routes API (server key) · Tesseract language data download · Render (backend host, inferred) · Vercel (frontend host, inferred).

## 3. Build tools and runtime environments

| App | Dev | Build | Output | Hosting evidence |
|---|---|---|---|---|
| restaurant-server | `nodemon server.js` | none (runs source) | — | Render (inferred: `RENDER_GIT_COMMIT` in `server.js:118`; docs) |
| admin / customer / waiter | `vite` | `vite build` | `dist/` | Vercel (`vercel.json` SPA rewrite in each) |
| kitchen | `vite` | `vite build` | `dist/` | **No `vercel.json`** — hosting UNKNOWN |
| delivery-app | `react-native run-android` | Gradle | APK/AAB | Not distributed via repo; UNKNOWN |
| print-service | `node src/index.js` | `node scripts/build-exe.mjs` | `SohojPrintService.exe` (~85 MB) | Copied to restaurant PC manually (`Admin_provider/`, `release/`, `client-update-*`) |
| Offline Edition | same server, `DEPLOYMENT_MODE=LOCAL` | apps' `dist/` served by `local/staticApps.js` on ports 8080–8083 | — | Restaurant PC (manual per doc 11; installer is O9, PLANNED) |

## 4. Authentication / authorization / API / real-time summary
Covered in depth in [16](16-security-architecture.md), [09](09-api-architecture.md), [10](10-realtime-architecture.md). One-line view: Firebase phone auth (customers, admins) or backend SMS-OTP / Firebase (employees) → backend-signed HS256 JWT (7 or 30 days) in `localStorage`; RBAC by `requireRole` middleware; REST under `/api/*`; Socket.IO with JWT, printer key, or anonymous guest handshakes; in LOCAL mode, device-bound PIN sessions re-checked per request.

## 5. Background jobs (all `setInterval` in `server.js`, in-process)

| Job | Interval | Function | Multi-instance safe? |
|---|---|---|---|
| Scheduled offer push | 30 s | `notificationService.runDueOffers` | Yes — atomic SCHEDULED→SENDING claim |
| Edit-window auto-send to kitchen | 15 s | `orderService.autoSendDueOrders` | Yes — conditional on `status: CONFIRMED` |
| Pay-first promote/expire | 60 s | `payFirstService.runPayFirstTick` | Yes — conditional updates |
| Delivery tick | 5 s, non-overlapping | `deliveryService.runDeliveryTick` | Yes — conditional updates |
| Category ordering reset | 60 s | `categoryOrderingService.resetCategoryOrdering` | Partly — in-memory "already reset today" marker per process |
| OCR warm-up | once | `warmUpOcr()` | n/a |
| Smart categories / menu sections ensure | once at boot | `ensureSmartCategories`, `ensureMenuSections` | Idempotent |

All of them are disabled by `DISABLE_BACKGROUND_JOBS=true`. There is **no** job queue (Bull/Agenda) and **no** external scheduler (ABSENT, High).
