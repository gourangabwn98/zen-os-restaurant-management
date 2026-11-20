# 01 — Complete Existing System Audit (Offline Edition, Phases 1–3)

Audit date: 2026-11-20 · Branch audited: `feature/offline-first` @ `00b8347` (now also `features/offline-edition`).
Everything below was checked in the code. Where something was **run**, it says so.

---

## 1. Git / repository audit (Phase 1)

| Item | Finding |
|---|---|
| Branch at start | `feature/offline-first` @ `00b8347 "demo"`, tracking `origin/feature/offline-first`, in sync |
| Working tree | **Clean** — no modified, staged or untracked files. No stashes. One worktree. |
| Target branch `features/offline-edition` | Did not exist → created with `git switch -c` from the clean HEAD (no checkout of other content, nothing overwritten). Not pushed, nothing committed. |
| Why base on `feature/offline-first` | It strictly contains every other branch: ahead of `main` by 32, `dev` by 27, `feature/inventory-v3` by 8, `feature/khoai-batch-1` by 54, behind all of them by 0. It carries the delivery module and all prior offline work. |
| Other branches | `main`, `dev`, `feature/duty-history`, `feature/inventory-v3`, `feature/khoai-batch-1` (local is 6 ahead of its origin — those 6 commits are already inside `feature/offline-first`), `feature/waiter-performance-payment-workflow`. None touched. |
| Untracked-looking artefacts in repo | `Admin_provider/` (packaged print service exe + config), `print-service/release*.zip`, `client-update-*` folders, `delivery-app/android/app/debug.keystore`, a built `app-debug.apk`. Left as is. |

---

## 2. System inventory (Phase 2)

### 2.1 Applications

| App | Stack | Size / pages | Talks to |
|---|---|---|---|
| `restaurant-server` | Node (ESM), Express 5, Socket.IO 4, Mongoose 9 | 24 route files, ~270 endpoints, 37 services, ~45 Mongoose models, 75 test files (plain Node + assert, `fakeMongo`, `mongodb-memory-server`) | MongoDB (`MONGO_URI`), PhonePe, Twilio/MSG91, Firebase Admin, Cloudinary, Google Routes API |
| `admin` | React 19 / Vite 8, **PWA** (vite-plugin-pwa) | Dashboard, Orders, Invoices, Tables, Menu, Inventory (v1, v3, inventory-manager), Employees, Delivery, Coupons, Offers/Notifications, Analytics/Insights, Profile/Settings, Users, Help, (legacy Chefs) | REST + Socket.IO, Firebase (login), Google Maps JS |
| `waiter` | React 18 / Vite 5, **PWA** | Tables, New order, Orders, Order detail, Activity, Profile | REST + Socket.IO, Firebase (login) |
| `kitchen` | React 18 / Vite 5, **PWA** | Kitchen board (KOT), Profile | REST + Socket.IO |
| `customer` | React 18 / Vite 5, manifest only (no app service worker; FCM SW only) | Home, Menu, Cart, Orders, Order detail, Track, Offers, Favorites, Notifications, Profile, Login | REST + Socket.IO, **Firebase phone auth (required to order)**, FCM, Google Maps JS |
| `delivery-app` | React Native 0.77 (Android native module: foreground location service, FCM) | Login, Home, Deliveries, Job detail, Offer overlay, History, Profile | REST + Socket.IO, FCM, react-native-maps |
| `print-service` | Node CLI → Windows `.exe` (SEA via esbuild + postject), `Admin_provider/` is a packaged copy | LAN / Windows-share USB / USB_DIRECT drivers, disk-persisted queue | Backend Socket.IO + `GET /api/admin/restaurant/profile` |

### 2.2 Backend modules (status)

| Module | Where | Status |
|---|---|---|
| Restaurant settings | `RestaurantProfile`, `profileRoutes` | Working; DB-held config (GST, service charge, UPI, paymentMode, timezone, delivery, banners) |
| Menu / sections / subcategories / add-ons / schedules / menu times / sold-out / import / bulk edit | `menuRoutes`, `catagoryRoutes`, `menu*Service`, `utils/menuSections.js` | Working |
| Tables, QR, table sessions, waitlist, dining area/radius | `tableRoutes`, `tableSessionService`, `utils/qrLink.js`, `utils/diningRadius.js` | Working |
| Orders + state machine + idempotent place | `orderService.js`, `utils/orderStateMachine.js`, `placeOrderIdempotency.test.js` | Working; `idempotencyKey` unique index already exists |
| Order numbering | `utils/orderNumber.js` — single atomic `Counter` `$inc` → `ORD00042` | Working, **single-writer assumption** |
| Kitchen / KOT / KOT change slips | `kotService`, `KOTJob` (unique `order`), `KOTChangeJob` (unique `{order,revision}`) | Working |
| Billing, combined bill, split payment (`Both`) | `billingService`, `combinedBillService`, `utils/paymentMode.js` | Working |
| Invoices | `Invoice` model, `invoiceRoutes` | Working; **no dedicated invoice number series** — bills are identified by `orderId`. (Pre-existing GST-numbering gap, see doc 04.) |
| Payments: PhonePe PG | `paymentService.js` — internet-only by nature | Working online |
| Payments: UPI deep link + manual verify | customer app + `PATCH /admin/orders/:id/payment` | Works without gateway; manual verify works offline |
| Coupons / offers push | `couponService`, `couponOfferService` (FCM) | Coupons work locally; push needs internet |
| Employees, roles, manager scope, HR, pay, leave, reviews | `employeeService`, `utils/roles.js`, `middleware/managerScope.js` | Working |
| Duty / attendance / duty history | `attendanceService`, `DutyHistory` (append-only) | Working |
| Inventory v1 (items, batches, recipes, purchases, ledger, wastage, low-stock alerts) | `inventoryService.js` | Working; deduction inside order transaction |
| Inventory v3 (operations, count sessions, financial entries = expenses, recurring costs, audit) | `inventoryV3*` | Working |
| Purchase import OCR | `utils/purchaseImportExtract.js` (tesseract.js) | **Downloads `eng` language data on first use** into `%TEMP%` — internet on first run |
| Reports / insights / staff reports / EBITDA | `insightsService`, `staffReportService` | Working (server-side, read-only) |
| Delivery (riders, offers, capacity, OTP drop, COD custody, GPS breadcrumbs, tracking) | `deliveryService`, `config/deliveryModels.js`, `deliveryRealtime` | Working online; replica-set test passes (below) |
| Route ETA | `routeService.js` (Google Routes) | Has a no-key fallback: straight-line distance, no ETA |
| Notifications | FCM via Firebase Admin, `NotificationLog` | Internet-only |
| OTP / SMS / WhatsApp bill | `utils/sendOTP.js` (Twilio → MSG91 → console), `sendWhatsApp*` | Internet-only (console fallback sends nothing) |
| Images | Cloudinary (`uploadMiddleware`, menu/category/profile/inventory controllers) | Internet-only; stored image URLs point to Cloudinary |
| Print jobs | `KOTJob`/`KOTChangeJob`/`BillPrintJob`, `PrinterDevice` hashed keys, `printers` socket room | Working; print-service reconciles queue on (re)connect |
| Background ticks | offers, pay-first expiry, auto-send-to-kitchen, delivery tick, category reset (`server.js`), `DISABLE_BACKGROUND_JOBS` switch | Working; all claim work atomically |

### 2.3 Socket.IO
`sockets/socket.js` + `utils/tenantKey.js`. Rooms: `tenant:{key}`, `:staff`, `:kitchen` (PII-stripped), `:printers` (PrinterDevice key auth), `:order:{id}`, `:user:{id}`. Tenant key = DB name from `MONGO_URI`. Nothing in it depends on the internet; it works unchanged on a LAN.

### 2.4 Internet-dependent items found (complete list)

| # | Dependency | Used for | Offline impact |
|---|---|---|---|
| D1 | MongoDB **Atlas** (`mongodb+srv://`) | everything | Fatal — must be a local DB |
| D2 | `server.js` hard-codes `dns.setServers(["1.1.1.1","8.8.8.8"])` | SRV lookups for Atlas | Breaks resolution of LAN host names (`zen.local`, router DNS) when offline. IP/localhost unaffected. |
| D3 | Staff login: SMS OTP (Twilio/MSG91) and Firebase phone auth (`/auth/*/firebase-verify`) | admin, manager, waiter, chef, rider login | **No staff can log in offline** |
| D4 | Customer login: Firebase phone auth; `orderService.js:177` refuses guest orders ("Please log in to place an order") | customer ordering | **No customer can order offline** |
| D5 | PhonePe PG | online payment | Unavailable offline (correctly) |
| D6 | Cloudinary | menu/profile/purchase images | Uploads fail; existing images (Cloudinary URLs) don't load on LAN-only phones |
| D7 | Firebase Cloud Messaging | offers push, rider offers/notifications | No push offline; sockets still work |
| D8 | Google Maps JS / Routes API | delivery maps, ETA | No map tiles; straight-line fallback exists for distance |
| D9 | tesseract.js language data | purchase-bill OCR | First OCR offline fails unless pre-bundled |
| D10 | Twilio WhatsApp | bill on WhatsApp | Must be queued or skipped |
| D11 | Cloud-hosted frontends (Vercel/Netlify/Render) | all apps | Not reachable offline — assets must be served locally |
| D12 | Browser **secure-context** rules: service worker, geolocation and install require HTTPS (or `localhost`) | PWA shell, customer dine-in radius gate | On `http://192.168.x.x` no SW and **no geolocation** → customer location gate can't pass |
| D13 | `delivery-app` release build: `cleartextTrafficPermitted="false"` | rider app | Release APK cannot call `http://<LAN-IP>` |

---

## 3. Existing offline infrastructure (Phase 3)

| Searched for | Found | Detail |
|---|---|---|
| Service worker / PWA | **Yes** — admin, waiter, kitchen | vite-plugin-pwa 2.0.0 + workbox 7.4.1, `registerType: "prompt"`, precache of js/css/html/woff2/png/svg, `navigateFallback`, `/api` and `/socket.io` excluded. Customer app: manifest + FCM SW only. |
| IndexedDB | **Yes** — admin, waiter, kitchen `src/offline/savedData.js` | **Read-only** last-response cache of GETs, scoped to a hash of the login token, wiped on logout, max 300 entries. Writes are deliberately never queued or faked. |
| Network detection | **Yes** — `src/offline/connectivity.js` + `OfflineBanner.jsx` | online / offline / unreachable, probes `/api/health` every 10 s |
| Runtime-configurable backend URL | **Yes** — `public/config.js` → `window.__ZEN_CONFIG__.apiUrl`, `src/config/runtimeConfig.js` in all four web apps (commit `aec6341`) | Explicitly written for "later a local restaurant server"; relative `/api` = same origin. **Key enabler.** |
| Self-hosted fonts | **Yes** — all four web apps (commit `641a56d`) | No Google Fonts call at runtime |
| Socket reconnection | socket.io-client default reconnection; print-service re-pulls queue on every reconnect | |
| Idempotency | `Order.idempotencyKey` (unique), KOTJob/KOTChangeJob/BillPrintJob unique indexes, CodCollection unique on order, DeliveryJob unique, DutyHistory unique `{session,action,at}`, `applyPhonePeResult` atomic | Good foundation for sync |
| Rider-side offline | `delivery-app` native `TrackingStore.kt` + `LocationTrackingService.kt` (foreground service, while-in-use location), `api.ts` `ApiError.offline` | Stores location fixes on device; no write outbox for job actions |
| Local DB / SQLite / local API server / sync queue / background sync / conflict resolution / offline auth | **None** | |
| Local printing | **Yes, already local by design** | print-service runs on-prem and only needs `BACKEND_URL` reachable |
| Local isolated backend | **Yes** — `scripts/localSandbox.js` | In-memory replica set on 127.0.0.1, refuses non-local URIs, blanks all cloud credentials, seeds demo data |
| Local mongod binary | **Yes** — `~/.cache/mongodb-binaries/mongod-x64-win32-7.0.14.exe` | Tests can run with no internet |

### 3.1 Verified by running
`node restaurant-server/test/deliveryReplSet.test.js` → **7 passed, 0 failed** on a local in-memory single-node replica set (real transactions, write conflicts, unique indexes, COD end-to-end, rollback, append-only audit). This proves the existing transactional code runs unchanged on a local MongoDB replica set.

Nothing else was built or run in this phase (no APK build, no frontend build, no dependency install).

---

## 4. Summary

* The system is a **single-writer, transaction-heavy** design (one DB, atomic counters, unique-index idempotency, server-authoritative pricing/status/stock). That is the strongest argument for running **the same backend against a local MongoDB replica set** rather than rewriting for an embedded DB or multi-master sync.
* Networking and print are already close to LAN-ready (runtime API URL, self-hosted fonts, on-prem print-service).
* The real offline blockers are **login (D3, D4)**, **local asset serving + HTTPS (D11, D12, D13)**, **images (D6)**, and **cloud synchronization**, which does not exist at all.
