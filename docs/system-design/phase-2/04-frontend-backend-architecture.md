# 04 — Frontend and Backend Architecture

Detail inventories: earlier `../05-application-architecture.md` and `../06-backend-architecture.md` (valid except corrections listed in [README](README.md)).

## 1. Frontend architecture (verified)

### 1.1 Common structure of the four web apps

```mermaid
flowchart TB
  subgraph App[Each web app]
    R[React Router pages] --> H[hooks: useAuth, useLiveOrders, ...]
    H --> SVC[services/*.js domain calls]
    SVC --> API[services/api.js<br/>axios + Bearer token + 401 handling]
    API --> SD[offline/savedData.js<br/>GET cache in IndexedDB<br/>admin, waiter, kitchen]
    SD --> CN[offline/connectivity.js<br/>banner + /api/health probe]
    H --> SK[services/socketService.js]
    R --> LP[local/PinLogin.jsx<br/>LOCAL mode only]
    CFG[public/config.js<br/>window.__ZEN_CONFIG__] --> API
  end
  API -->|HTTPS| BE[(restaurant-server)]
  SK -->|WSS| BE
```

| Concern | Decision | Evidence |
|---|---|---|
| State | React context + hooks; no global store | `CLAUDE.md`; `src/context/*` |
| Auth token | `localStorage` | `services/api.js` |
| Live data | socket event → debounced refetch (`ORDER_EVENTS` in admin & waiter) | `hooks/useLiveOrders.js:7-30` |
| Runtime config | `public/config.js` overrides `VITE_API_URL` without rebuild | `config/runtimeConfig.js` |
| PWA | `vite-plugin-pwa` in admin/waiter/kitchen | `pwa/registerPwa.js` |
| i18n | English + Bengali | `src/i18n/` |

### 1.2 Per-app responsibilities

| App | Pages / modules | Roles |
|---|---|---|
| admin (React 19) | Dashboard, Orders, Invoices (day close, dues, xlsx), Tables, Menu, Inventory (+V3, inventory-manager view), Employees, Coupons, Offers, Insights, Delivery, Devices (LOCAL), Users, Profile, Help, `/kitchen` display, `/setup` (LOCAL) | admin, manager (filtered), inventory_manager (inventory only) |
| waiter | Tables, Orders, New order, Order detail, Activity, Profile | waiter (+ admin/manager can log in) |
| kitchen | Board, Profile | chef, admin |
| customer | Home, Menu, Cart, Orders, Order detail, Offers, Favorites, Notifications, Profile, Help, Contact, Policy pages, Track | customer / public |
| delivery-app (RN) | Login, Home, Offer overlay, Deliveries, Job detail, History, Profile | delivery |

## 2. Backend architecture (verified)

```mermaid
flowchart LR
  subgraph Express[Express 5 app]
    G[Global MW: cors, compression, json, sanitizeInput]
    RT[routes/* 25 files]
    MW[Route MW: protect, optionalProtect, autoAuth, requireRole*, managerScope, requireWaiterOnDuty, objectIdParam, rateLimit, upload]
    CT[controllers/* thin]
  end
  SV[services/* business logic]
  UT[utils/* state machines, pricing, enums]
  MD[config/*Models.js]
  SO[sockets/socket.js]
  TK[ticks in server.js]
  LC[local/* LOCAL only]
  G --> RT --> MW --> CT --> SV
  SV --> UT
  SV --> MD --> DB[(MongoDB)]
  CT --> SO
  TK --> SV
  TK --> SO
  LC --> RT
```

| Layer | Responsibility | Rule |
|---|---|---|
| routes | URL → middleware chain | RBAC always at route level |
| controllers | parse request, call service, map `err.statusCode` | no business logic (some exceptions: `printBill`, profile inline handler) |
| services | business rules, transactions, side effects returned or emitted | "pure-ish, take `{ models, ... }`" |
| utils | enums, state machines, pricing, parsing | single source for every status string |
| models | schemas, indexes, append-only hooks | four model modules |
| sockets | handshake, rooms, typed emitters | emits never fail a request |
| ticks | offers, auto-send, pay-first, delivery, category reset | atomic, multi-instance safe |

### Domain module map

```mermaid
flowchart TB
  ORD[Orders<br/>orderService, kotService] --> INV[Inventory<br/>inventoryService]
  ORD --> BIL[Billing<br/>billingService, combinedBill, acServiceCharge]
  ORD --> PAY[Payments<br/>paymentService, payFirstService]
  ORD --> TBL[Tables<br/>tableSessionService]
  ORD --> DEL[Delivery<br/>deliveryService]
  ORD --> MENU[Menu<br/>menu*, category*]
  ORD --> CPN[Coupons<br/>couponService]
  STF[Staff<br/>attendance, employee, leave, pay, staffReport] --> ORD
  PRT[Printing<br/>printerDeviceService] --> ORD
  LOC[Offline auth<br/>localAuthService] --> STF
  INS[Insights] --> ORD
```

## 3. Proposed improvements (PROPOSED)

| Item | Why |
|---|---|
| Shared enum/label package consumed by all apps | rename drift (`CLAUDE.md` gotcha) |
| Move bill payload building into a service | thin-controller rule |
| Align admin and other apps on one React/Vite major version | maintenance |
| Remove server-only deps from admin `package.json` | hygiene |
