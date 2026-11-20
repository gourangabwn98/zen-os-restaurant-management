# 05 — Application Architecture (per application)

Diagram: [`diagrams/05-application-overview.mmd`](diagrams/05-application-overview.mmd). Backend internals are in [06](06-backend-architecture.md); printing in [13](13-printing-architecture.md).

Common patterns across the four web apps (verified):

| Concern | Implementation | Evidence |
|---|---|---|
| HTTP client | one axios instance per app, `services/api.js`, request interceptor adds `Bearer` token from `localStorage` | `*/src/services/api.js` |
| Session expiry | response interceptor: on `SESSION_EXPIRED` / `ACCOUNT_INACTIVE` → clear token, go to `/login` (admin, waiter; kitchen only in LOCAL mode); customer retries once as a guest | same |
| Token storage | `localStorage` (`adminToken`, `adminUser`, `addaUser`, `guestOrders`, …) | grep of `localStorage.*Item` |
| Real time | `services/socketService.js` singleton per app | |
| Offline read cache | `src/offline/savedData.js` wraps GETs: successful responses kept in IndexedDB `zen-saved-data` (≤300 entries, scoped by token hash, wiped on logout); on network failure the saved copy is returned with `fromCache:true`. **Writes are never queued.** Files are byte-identical in admin, waiter, kitchen. | `admin|waiter|kitchen/src/offline/*` |
| Connectivity banner | `connectivity.js`: online / offline / unreachable, probes `/api/health` every 10 s while not online | same |
| PWA | `vite-plugin-pwa`, `pwa/registerPwa.js`, `UpdatePrompt.jsx` (admin, waiter, kitchen) | |
| LOCAL mode login | `src/local/PinLogin.jsx`, `localAuth.js` (device registration + PIN) when `window.__ZEN_CONFIG__.localServer === true` | admin, waiter, kitchen |
| i18n | English + Bengali dictionaries (`src/i18n/bn`), admin has `npm run i18n:check` | |
| State | React context + hooks; no global store library (deliberate) | `CLAUDE.md` |

---

## A. Admin (`admin/`) — IMPLEMENTED (High)

**Responsibilities:** owner/manager back office and POS: live orders, accept/edit/status, billing (settle, split, combined bill, reopen), invoices & day close, tables & QR, menu (items, sections, menu times, bulk edit, import), inventory (legacy + V3 + inventory-manager mobile view), employees (HR, pay, leave, reviews, duty history, staff collections), coupons, offers (FCM), insights/EBITDA, users, profile/settings, printers status, delivery board, devices & PINs (LOCAL only), help.

**Routes:** `/login`, `/setup` (LOCAL first-admin bootstrap), `/admin/*` (layout with page switch inside `AdminLayout.jsx`), `/kitchen` (embedded `KitchenDisplayPage.jsx`), `*`.

**Main modules (pages → folder):** Dashboard (`dashboard/`), Orders, Invoices (`invoices/` incl. CloseDayView, DuesView, xlsx export), Tables, Menu (`menu/`), Inventory (`inventory/`, `inventory-v3/`, `inventory-manager/`), Employees (`employees/`), Coupons, Offers/Notifications (`offers/`), Analytics/Insights (`insights/`), Delivery (`delivery/` board, partners, live map, COD cash, reports, settings), Devices (LOCAL), Users, Profile, Help, **Chefs (legacy, unused)**. Shared order UI in `pages/admin/shared/` (OrderScreen, CombineBillPanel, SplitPay, VoiceOrder…).

**Services:** `adminService`, `orderService`, `menuService`, `inventoryService`, `inventoryV3Service`, `inventoryManagerService`, `couponService`, `notificationService`, `attendanceService`, `deliveryAdminService`, `authService`, `firebase.js`, `socketService`, `cache.js`, `local/localAdminService.js`.

**AuthN/AuthZ:** Firebase phone login (cloud) or PIN (LOCAL). Page visibility by `utils/access.js`: manager → orders, tables, invoices, inventory, employees, menu, delivery, devices, help; inventory_manager → inventory only; `devices` only when `localServer`. **Server enforces the real rule** (`requireManagement`/`requireAdmin`); the UI filter is convenience.

**Real-time listens:** `order:new`, `order:confirmed`, `order:status_changed`, `order:cancelled`, `order:payment_changed`, `order:needs_attention`, `kot:created`, `table:freed`, `waitlist:updated`, `employee:attendance:updated`, `menu:updated`, `delivery:location_updated`.

**Offline behaviour:** last-loaded GET data shown with banner; all writes fail while unreachable. Inventory V3 writes fail over plain HTTP (`crypto.randomUUID` needs a secure context — doc 10 finding 2).

**External deps:** Firebase web SDK, Google Maps JS (optional key), socket.io-client.

**Debt:** server-only packages in `package.json`; React 19/Vite 8/router 7 while other apps are on 18/5/6; legacy `ChefsPage.jsx`; lint fails on `main` per fact sheet.

---

## B. Waiter (`waiter/`) — IMPLEMENTED (High)

**Routes:** `/login`, `/tables`, `/orders`, `/new-order`, `/order/:id`, `/activity`, `/profile`.
**Responsibilities:** table map, open sessions, place staff order (starts `CONFIRMED`), accept customer orders, edit within window and after KOT (re-pricing, change slips), mark served, print bill, record payment (Cash/Online/Both), settle, close table, call-waiter ack/resolve, duty start/break/end with 30 s heartbeat.
**Services:** `orderService`, `menuService`, `tableService`, `dutyService`, `waiterCallService`, `orderDataCache`, `socketService`.
**Hooks:** `useLiveOrders`, `useOrderNotifications`, `useWaiterCalls`, `useDuty`.
**AuthZ specifics:** most write routes add `requireWaiterOnDuty` — a waiter not ON duty (no OPEN `AttendanceSession` with `presenceStatus: ONLINE`) gets an error (`middleware/dutyMiddleware.js`).
**Real-time listens:** `order:new`, `order:cancelled`, `order:needs_attention`, `waiter_call:new`, `waiter_call:updated`, `employee:attendance:updated`, `menu:updated`. Emits `employee:attendance:heartbeat`. (Status changes of existing orders are picked up by its own refresh logic in `useLiveOrders`; it does not subscribe to `order:status_changed` — Medium confidence.)
**Offline:** same read-only cache + banner.

---

## C. Kitchen / Chef (`kitchen/`) — IMPLEMENTED (High)

**Routes:** `/login`, `/board`, `/profile`.
**Responsibilities:** list PREPARING/READY orders (`GET /api/kitchen/orders`, `toKitchenTicket` strips PII/prices — `controllers/kitchenController.js:15`), "Start preparing" and "Ready" (`PATCH /api/kitchen/orders/:id/status`), audible alert on new KOT / URGENT priority, duty heartbeat.
**Real-time listens:** `kot:created`, `order:status_changed`, `order:cancelled` (all delivered PII-stripped to the `kitchen` room). It also listens to `order:confirmed` and `employee:attendance:updated`, which the server **never sends to the kitchen room** (dead listeners — Low impact).
**AuthZ:** `requireKitchen` = admin or chef. A chef socket joins only `kitchen` (never `staff`).
**Note:** admin sockets do **not** join the kitchen room (`sockets/socket.js:162` joins only `isChef`), although `CLAUDE.md` and `utils/tenantKey.js` describe it as "admin + chef". Admin's embedded `/kitchen` page therefore relies on the staff-room events instead (Medium).

---

## D. Customer QR (`customer/`) — IMPLEMENTED (High)

**Routes:** `/`, `/menu`, `/cart`, `/orders`, `/order/:id`, `/offers`, `/favorites`, `/notifications`, `/profile`, `/help`, `/contact`, `/login`, `/privacy`, `/terms`, `/refund-policy`, `/track/:token`.
**Responsibilities:** menu browsing (schedules applied server-side), cart and server quote (`POST /api/orders/quote`), checkout for DINE_IN (QR table token + **device location within `dineInRange`**), TAKEAWAY, ONLINE delivery (address + GPS pin inside `deliveryRange`), coupons, PhonePe redirect + return polling, UPI deep link, order tracking via `join-order`, edit/cancel while allowed, call waiter, reviews, support ticket, FCM offer push opt-in, delivery tracking link.
**Services:** `orderService`, `paymentService`, `menuService`, `couponService`, `tableService`, `waiterCallService`, `reviewService`, `supportService`, `deliveryService`, `notificationService`, `restaurantService`, `installPrompt`.
**AuthN:** Firebase phone auth → `/api/auth/firebase-verify` → backend JWT. **Placing an order requires login** (`orderService.js:174-180`); `CLAUDE.md`/README's "guest ordering" is outdated for placement (guest tokens still exist for viewing a guest's order).
**Real-time listens:** `order:*`, `waiter_call:updated`, `delivery:status_updated`, `delivery:location_updated`, `menu:updated`; emits `join-order`, `join-tracking`.
**Offline:** no saved-data layer and no app-shell service worker (only FCM SW). Fails when the backend is unreachable.

---

## E. Backend (`restaurant-server/`) — see [06](06-backend-architecture.md).

## F. Printing service (`print-service/`) — see [13](13-printing-architecture.md).

## G. Android printing prototype — **ABSENT** in the repository (High). Only design docs exist (`docs/audit/zen-os-android-print-agent-*.md`). See [20](20-android-printing-architecture.md).

## H. Delivery module

| Part | Location | Status |
|---|---|---|
| Backend service, 6 collections, state machine, 5 s tick, realtime publisher | `services/deliveryService.js` (1254 lines), `config/deliveryModels.js`, `utils/delivery*.js`, `services/deliveryRealtime.js`, `routes/deliveryRoutes.js` (36 handlers) | IMPLEMENTED (branch) |
| Admin Delivery page | `admin/src/pages/admin/DeliveryPage.jsx`, `delivery/*` | IMPLEMENTED |
| Customer checkout + tracking | `customer/src/pages/TrackPage.jsx`, `components/delivery/*` | IMPLEMENTED |
| Rider Android app | `delivery-app/` | IMPLEMENTED (FCM needs config; real-device GPS not automatable — `docs/delivery/04-…`) |
| Offline rider claims, cloud relay | `docs/offline-edition/07-…` (O8), `05-…` §6 | PLANNED |

Detail and the proposed future platform: [21](21-delivery-platform-proposed-architecture.md).

---

## Module dependency inventory (frontend → backend API groups)

| Backend group | admin | waiter | kitchen | customer | delivery-app | print-service |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `/api/auth` | ✓ | ✓ | ✓ | ✓ | ✓ | |
| `/api/menu`, `/api/categories` | ✓ | ✓ | | ✓ | | |
| `/api/orders` | ✓ | ✓ | | ✓ | | |
| `/api/admin` (orders/billing/insights/users/attendance) | ✓ | ✓ | | | | |
| `/api/admin/tables`, `/table-sessions`, `/waitlist` | ✓ | ✓ | | (`/tables` public read, `/validate`) | | |
| `/api/kitchen` | (✓ `/kitchen` page) | | ✓ | | | |
| `/api/payments` | | | | ✓ | | |
| `/api/admin/inventory`, `/inventory/v3` | ✓ | | | | | |
| `/api/admin/employees`, `/api/attendance` | ✓ | ✓ | ✓ | | | |
| `/api/coupons`, `/api/notifications` | ✓ | | | ✓ | | |
| `/api/waiter-calls` | ✓ | ✓ | | ✓ | | |
| `/api/reviews`, `/api/support` | | | | ✓ | | |
| `/api/admin/printer` | ✓ | ✓ (status) | | | | |
| `/api/delivery` | ✓ (`/admin`) | | | ✓ (`/orders/:id`, `/track/:token`) | ✓ (`/me`, `/offers`, `/jobs`) | |
| `/api/admin/restaurant` (profile) | ✓ | ✓ | | ✓ | | ✓ (public profile for bill header) |
| `/api/local` (LOCAL) | ✓ | ✓ | ✓ | | | |
| Socket.IO | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (printer key) |

(Matrix built from each app's `services/*.js` and route prefixes; Medium-High confidence — individual calls were not exhaustively traced.)
