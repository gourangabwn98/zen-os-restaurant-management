# Security Audit Report

**Date:** 2026-10-01 · **Scope:** `restaurant-server` (the only backend) and the Customer, Admin and Waiter apps, with Kitchen and print-service where they touch shared APIs.
**Method:** Static source and configuration review, plus a read-only `npm audit`. I did not send any traffic to a running environment and did not change any code or data.
**Confidence labels:** **Confirmed (code)** means the vulnerable path is visible end to end in the source. **Requires verification** means the outcome depends on deployment config or runtime behaviour that the source alone cannot prove.

> ⚠️ This file describes exploitable weaknesses. Do not commit it to a public repository, and do not push it anywhere before the Critical items are fixed.

---

## Executive Summary

The backend has solid foundations. Prices, roles and order status are derived server-side. PhonePe callbacks are checked with a timing-safe signature compare. The kitchen API is PII-stripped. Waiter calls enforce strict ownership. Employee roles cannot be escalated to admin.

However, there are **two Critical issues** that need fixing before anything else:

1. **Anyone can log in as admin knowing only the admin's phone number.** `POST /api/auth/admin/firebase-login` issues a 7-day admin JWT from a `phone` in the request body. It never checks a Firebase token, because the OTP check happens only in the browser. The restaurant phone number is itself served by a public endpoint.
2. **Every order, including customer names and phone numbers, is broadcast in real time to anonymous Socket.IO connections.** Three "legacy" emits go to the `tenant:{key}` room, which every socket joins, logged in or not.

Next come several **High** issues:
- Unauthenticated access to other people's orders, through the order-by-ID route and through NoSQL operator injection.
- OTP brute force with no attempt limit or rate limiting.
- A waiter path that marks any order `PAID` and `COMPLETED` outside the state machine.
- An unauthenticated WhatsApp-sending test endpoint.

**Cross-user or cross-role data access paths found:** C1, C2, H1, H4, H5, M1, M2, M4.

## Applications Audited

| App | Stack | Auth | Token storage |
|---|---|---|---|
| Customer | React/Vite (Vercel) | Firebase phone OTP → `/auth/firebase-verify` (server verifies the ID token ✅); guests use a per-order `x-guest-order-token` | localStorage |
| Admin | React/Vite (Vercel) | Firebase phone OTP **checked in the browser only** → `/auth/admin/firebase-login` ❌ | localStorage `adminToken` |
| Waiter | React/Vite (Vercel) | Backend OTP (`/auth/waiter/*`) or Firebase → `/auth/employee/firebase-verify` (server verifies ✅) | localStorage |
| Kitchen (related) | React/Vite | Backend OTP `/auth/employee/*` | localStorage |
| Backend | Express 5, Mongoose 9, Socket.IO 4 | JWT (HS256, `JWT_SECRET`) | n/a |

---

## Critical Findings

### C1: Admin authentication bypass (`POST /api/auth/admin/firebase-login`)
- **App/component:** Backend `controllers/authController.js:700` (`firebaseLogin`), called by Admin `src/pages/LoginPage.jsx:85`.
- **What happens:** The Admin app runs Firebase `signInWithPhoneNumber` and `confirm(otp)` in the browser, then posts `{ phone }` to the backend. The backend looks up a user by phone with `isAdmin` or an admin role, and returns `jwt.sign({ id }, JWT_SECRET, { expiresIn: "7d" })`. **No Firebase ID token is sent or verified.**
- **Impact:** Full admin takeover by anyone who knows the admin phone number. That includes all orders and customer PII, employees, payments, coupons, printer device keys, restaurant settings, and deleting users.
- **Makes it worse:**
  - The restaurant's `phone`, `email` and `contactPerson` are public via `GET /api/admin/restaurant/restaurant/profile` and `GET /api/admin/restaurant/profile` (M3).
  - `adminPhone` is also returned to customers by the waiter-call flow.
  - `POST /api/auth/employee/check-phone` confirms which numbers belong to staff (M8).
  - It is *Requires verification* whether the restaurant contact phone equals the admin login phone. For a single-owner cafe it very likely does.
- **Safe test (staging only):** With a staging admin whose phone is known, `curl -X POST $API/api/auth/admin/firebase-login -H 'Content-Type: application/json' -d '{"phone":"<staging admin phone>"}'`. If you get a token back without any OTP, the bypass is confirmed. Then `GET /api/admin/users` with that token.
- **Fix:**
  - Make the endpoint take `{ firebaseToken }`, call `admin.auth().verifyIdToken(firebaseToken)`, and take the phone from `decoded.phone_number`. This is exactly what `employeeFirebaseVerify` already does.
  - Change the Admin app to send `(await confirmRef.current.confirm(otp)).user.getIdToken()`.
  - Also delete or disable the unused `adminSendOTP`/`adminVerifyOTP` routes (see H2), or harden them.
  - Rotate `JWT_SECRET` after the fix. That invalidates any admin token already minted this way.
- **Related to check:** Every route that issues a JWT: `/auth/firebase-verify`, `/auth/employee/firebase-verify`, `/auth/waiter|employee/verify-otp`, `/auth/admin/verify-otp`.
- **Verify fix:** The same curl with only `phone` returns 400 or 401. A forged or expired Firebase token returns 401. Normal admin login still works.
- **Severity:** Critical · **Confirmed (code)**

### C2: All orders with PII broadcast to anonymous sockets
- **App/component:** Backend `sockets/socket.js:327, 347, 355`.
- **What happens:**
  - Every socket joins `rooms.tenant(tenantKey)` at connection, including guests with no token (`socket.js:122`).
  - `emitOrderConfirmed`, `emitOrderStatusChanged` and `emitOrderCancelled` also emit the **full order document** to that room: `new-order`, `order-status-updated` and `order-rejected`.
  - The full order includes `guestName`, `guestPhone`, `user`, items, totals, `paymentStatus`, `payment` sub-doc, `notes`, `statusHistory` with staff names, table number, and `waiterId`.
- **Impact:** Anyone can open a Socket.IO connection to the API with no credentials and passively collect every customer's name and phone number, and every order's details, in real time. Chef sockets also receive these events, which breaks the documented "kitchen room is PII-stripped" rule.
- **Nobody consumes these events:** no Customer, Admin, Waiter or Kitchen code listens for `new-order`, `order-status-updated` or `order-rejected`, so removing them is safe.
- **Safe test (staging):** A Node script using `socket.io-client` with no `auth`, `socket.onAny(console.log)`. Then place and confirm a test order from the waiter app. You'll see the full order arrive.
- **Fix:**
  - Delete the three `rooms.tenant(...)` legacy emits.
  - Audit the remaining tenant-room emit (`menu:updated`, which carries only a timestamp, so it is fine).
  - Treat `tenant:{key}` as a public room: never emit order, payment or PII data there.
- **Verify fix:** Re-run the anonymous listener and confirm it receives nothing for order events. Confirm the staff, kitchen and order rooms still get their events.
- **Severity:** Critical · **Confirmed (code)**

---

## High Findings

### H1: NoSQL operator injection in `POST /api/orders` (`idempotencyKey`) leaks an arbitrary order
- **Component:** `services/orderService.js:100`: `if (idempotencyKey) { const existing = await Order.findOne({ idempotencyKey }); if (existing) return { order: existing, alreadyExisted: true }; }`. The controller then returns `order.toObject()`.
- **Why:** `express.json()` accepts objects, and `idempotencyKey` is never type-checked. `{"idempotencyKey":{"$ne":null}, "items":[…]}` makes `findOne` match some existing order, which is returned to an **unauthenticated** caller. Varying the operator (`$gt`, `$regex`) walks different orders.
- **Impact:** Unauthenticated read of other customers' orders and PII.
- **Safe test (staging):** Send the body above without auth. The response should be a pre-existing order.
- **Fix:**
  - Require `typeof idempotencyKey === "string"` with a length and charset check.
  - Scope the replay lookup to the caller: `{ idempotencyKey, user: req.user?._id ?? null }`. For guests, also compare a stored hash of the guest's key.
  - Add a small global body sanitiser that rejects any `req.body` key that starts with `$` or contains `.`. Do **not** turn on Mongoose `sanitizeFilter` globally without review: it would wrap the app's own `$in`/`$ne` filters.
- **Related to check:** Any `findOne({ field })` built from `req.body`: `phone` in the auth controllers (H2), `code` in coupons, `menuItemId` in pricing (it goes through `findById`, which casts, so it is safe).
- **Severity:** High · **Confirmed (code)**, confirm on staging.

### H2: OTP brute force and operator injection on staff/admin OTP
- **Components:** `authController.js:262` `adminSendOTP`, `:316` `adminVerifyOTP`, `:397` `waiterSendOTP`, `:440` `waiterVerifyOTP`.
- **Issues:**
  - **No attempt limit and no rate limiting anywhere** (no `express-rate-limit` or similar in the backend). A 6-digit OTP with a 5-minute lifetime can be brute-forced at a few thousand requests per second, and each re-send gives a fresh window.
  - `adminSendOTP`/`adminVerifyOTP` put the raw `phone` into queries. `{"phone":{"$ne":""}}` selects the first admin **without knowing the phone number**.
  - `adminSendOTP` stores the OTP on the user **before** `sendOTP` runs, so a failed SMS still arms a valid OTP.
  - `new RegExp(\`^${phone}$\`)` at `:280` injects a user-controlled regex (ReDoS and wildcard matching of admin emails).
  - OTPs come from `Math.random()` rather than a cryptographic random generator.
  - `waiterCache` is in-process memory. It's not shared across instances and grows without bound (low).
- **Impact:** Takeover of admin or staff accounts; SMS cost pumping via unlimited `send-otp`.
- **Fix:**
  - Delete the unused `/auth/admin/send-otp` and `/auth/admin/verify-otp` routes (the Admin app does not call them).
  - Coerce `phone` with `String()` and validate it against `/^[6-9]\d{9}$/` everywhere.
  - Allow at most 5 attempts per OTP, then invalidate it. Store only a hash of the OTP.
  - Use `crypto.randomInt(100000, 1000000)`.
  - Add per-IP and per-phone rate limits on every `/api/auth/*` send and verify route. That also needs `app.set("trust proxy", 1)` on Render so the real client IP is used.
- **Severity:** High · **Confirmed (code)**

### H3: OTP returned in the API response and logs when no SMS provider is configured
- **Component:** `utils/sendOTP.js` `resolveProvider()` falls back to `"console"` even when `NODE_ENV=production`, and `OTP_PROVIDER=console` can force it. `waiterSendOTP` then returns `otp` in the JSON (`authController.js:428`), and `sendViaConsole` logs it.
- **Impact:** If production lacks Twilio/MSG91 credentials, any waiter, chef or admin account can be logged into with only its phone number.
- **Fix:** Never echo the OTP when `NODE_ENV === "production"`. Refuse to start, or disable OTP login, if production resolves to `console`. Don't log OTP values.
- **Severity:** High · **Requires verification** (depends on production env vars).

### H4: Guest order IDOR, where anyone with an order `_id` reads it
- **Components:**
  - `GET /api/orders/:id`: `assertCanViewOrder` (`orderService.js:728`) only enforces the guest token **if one is sent**. With no Authorization header and no token, it returns the order populated with `user: name phone email`.
  - The same soft check applies to `POST /api/payments/phonepe/initiate` and `GET /api/payments/phonepe/status/:orderId`.
- **Why it matters:** MongoDB ObjectIds are partly predictable (timestamp plus counter). IDs also leak via URLs such as `/order/:id?payment=phonepe`, shared links, and until C2 is fixed, the socket broadcast.
- **The customer app already sends `x-guest-order-token`** (`customer/src/services/orderService.js:28`, `CartPage.jsx:114`), so the "soft" compatibility mode is no longer needed.
- **Fix:**
  - Make the guest check strict: no valid token and no owning user means 403.
  - Reduce the response through a customer DTO: drop `user.email`, `statusHistory[].changedBy`, `payment.raw`, `waiterId`, `idempotencyKey` and internal fields.
  - Plan for the 12-hour token expiry: either lengthen it for order tracking, or show a friendly "log in or ask staff" state.
- **Verify fix:** Fetching an order with no headers returns 403. The same request with its token returns 200. Another order's token returns 403.
- **Severity:** High · **Confirmed (code)**

### H5: Waiter (and indirectly anonymous users) can mark any order PAID/COMPLETED outside the state machine
- **Components:**
  - `PATCH /api/admin/invoices/:id/status` is guarded only by `requireStaff` (`adminController.js:189`). Setting `paid`/`completed` runs `Order.updateMany({ _id: { $in: invoice.orders } }, { status: "COMPLETED", paymentStatus: "PAID" })`. That skips `orderStateMachine` transitions, `canSetPaymentStatus`, and the stock and KOT logic.
  - `POST /api/invoices/generate` is **unauthenticated** (`optionalProtect`, `invoiceController.js:2`). It accepts client-supplied `orders` (any IDs), `items` with client prices, and `userId`. **No frontend calls it.**
- **Impact:**
  - Anyone can create invoices with arbitrary order IDs and fake prices, attached to any user.
  - A waiter can then mark those orders paid or completed without collecting money. Revenue reports get corrupted.
  - This violates CLAUDE.md rule 2 ("backend is authoritative for price, order status, payment status").
- **Fix:**
  - Delete `POST /api/invoices/generate`, or make it admin-only and derive everything from the orders server-side.
  - Restrict invoice status changes to `requireAdmin`.
  - Route any order change through `transitionOrderStatusTx` and `canSetPaymentStatus` instead of `updateMany`.
- **Severity:** High · **Confirmed (code)**

### H6: Unauthenticated `GET /api/test-whatsapp/:phone`
- **Component:** `server.js:108`.
- **Impact:** Anyone can make the restaurant's Twilio/WhatsApp account message any number with the restaurant's name on it. That means cost abuse, spam, and risk of sender suspension. No frontend uses it.
- **Fix:** Delete the route. If you need a diagnostic, put it behind `protect, requireAdmin`.
- **Severity:** High · **Confirmed (code)**

---

## Medium Findings

| ID | Finding | Component | Fix |
|---|---|---|---|
| M1 | **Invoice IDOR:** any logged-in customer can read any invoice by ID | `GET /api/invoices/:id` → `getInvoiceById` has no ownership check (`invoiceController.js:40`) | Allow only if `invoice.user == req.user._id` or the caller is staff |
| M2 | **Table QR tokens public:** `GET /api/admin/tables` needs no auth and returns every table's `qrToken`, `qrUrl` and `qrCode`, which defeats the QR check. Dine-in orders **without** a token are also accepted ("soft" check, `orderService.js` placeOrderTx) | `routes/tableRoutes.js` (`autoAuth`), `tableController.getTables` | Only the Waiter and Admin apps call this, so use `protect, requireStaff`. Strip `qrToken`/`qrCode` for non-admins. Once the customer app always sends `tableToken` (it does via `useTableSession`), require it for guest dine-in orders |
| M3 | **Public restaurant profile over-exposure:** returns `profile.toObject()`, including `phone`, `email`, `contactPerson`, **`printerIps`** (internal LAN addresses) and all internal settings. The phone number enables C1 | `GET /api/admin/restaurant/profile` (no token) and `GET /api/admin/restaurant/restaurant/profile` | Return a public DTO (name, logo, banners, hours, address, services, gstRate, serviceCharge, paymentMode, upiId/upiPayeeName, paymentQr, phonePeEnabled). Keep the full document for admins only |
| M4 | **Waiter over-privilege and data volume:** `GET /api/admin/dashboard` (`requireStaff`) gives waiters total and weekly revenue, and its `tableOrders.All` also includes `AWAITING_PAYMENT` orders, which contradicts the getAllOrders filter. `GET /api/admin/orders?limit=10000` returns every historical order with customer phones | `adminController.getDashboardStats`, `getAllOrders` | Make the dashboard admin-only, or give waiters a reduced one. Cap `limit` (e.g. 200). Default waiters to active or today's orders. Add a staff DTO without `user.email` or `payment.raw` |
| M5 | **ReDoS via unescaped `$regex`:** the public `GET /api/menu?search=` plus the staff search fields | `menuController.js:27`, `adminController.js:83`, `employeeService.listEmployees`, `inventoryController.js:80`, `authController.js:280` | Escape input (`s.replace(/[.*+?^${}()\|[\]\\]/g, "\\$&")`) and cap its length |
| M6 | **No rate limiting at all:** OTP send (SMS cost), `POST /api/support` (sends a WhatsApp message to the owner for each ticket), order placement, coupon checks | App-wide | `express-rate-limit` per route group, with `trust proxy` set correctly |
| M7 | **Long-lived bearer tokens with no revocation:** customer JWT 30 days, staff 7 days, stored in `localStorage` (readable by any XSS). No server-side logout or token version. Deactivation *is* checked on every request (good) | `authController.js:244`, `:383`, frontends | Shorter access tokens plus refresh, or a `tokenVersion` on `User` checked in `protect` and bumped on logout or deactivation. Add a CSP to limit XSS reach (L8) |
| M8 | **Staff phone enumeration:** `POST /api/auth/employee/check-phone` and `waiterSendOTP` return the staff member's **name** for a registered number, and a distinct 403 otherwise | `authController.js:481`, `:397` | Return a generic response. Rate-limit it |

## Low Findings

| ID | Finding | Component | Fix |
|---|---|---|---|
| L1 | Internal error messages returned to clients (`err.message` in most controllers, including Mongoose cast and validation text; the socket auth error echoes `err.message`). Stack traces only appear when `NODE_ENV=development` (good) | Most controllers, `errorMiddleware.js`, `socket.js` | Map to generic messages for 500s. Log details server-side |
| L2 | Guest order token and session JWT share `JWT_SECRET` with no `aud` claim. Safe today only because of the `purpose` and `id` checks | `utils/guestOrderToken.js` | Add `audience` or a separate secret |
| L3 | Admin mass assignment: `Object.assign(profile, req.body)`, `Table.findOneAndUpdate(..., req.body)`, `Supplier.create(req.body)`, `InventoryItem` update `rest`. Admin-only, but lets an admin set fields like `qrToken`, `status` or timestamps directly | `profileController`, `tableController.updateTable`, `inventoryController` | Allow-list fields |
| L4 | `DELETE /api/admin/users/:id` can delete any user, including other admins or the caller | `adminController.deleteUser` | Restrict to `role: "customer"`, or block self and admins |
| L5 | Waiters can `PATCH /api/admin/printer/kot/:id/status` (mark a KOT printed or reprint it) with a plain update, and any staff socket can `register-printer` to receive bill payloads with PII | `printerRoutes.js`, `socket.js` | Admin-only for the REST route. Remove `register-printer` for staff sockets if it's unused |
| L6 | `innerHTML` with admin-controlled table label and name in the QR print view (admin-to-admin stored XSS) | `admin/src/pages/admin/TablesPage.jsx:158` | Build DOM nodes, or escape |
| L7 | Customer Firebase login with a staff phone returns a **30-day** token for the staff account (vs the 7-day staff policy) and lets the customer flow overwrite the staff `name` | `authController.firebaseVerify` | For staff roles, use the staff session policy, or refuse and point to the staff app |
| L8 | No security headers: no `helmet` on the API; the Vercel configs set no CSP, HSTS, `frame-ancestors`, `Referrer-Policy` or `Permissions-Policy` | `server.js`, `*/vercel.json` | See the headers section |
| L9 | CORS `origin: "*"` on REST and Socket.IO. Auth is bearer-header, not cookie, so CSRF doesn't apply, but it widens abuse of the public endpoints | `server.js:56`, `socket.js` | Allow-list the four app origins |
| L10 | No limit on the number of order items or their size; `express.json({ limit: "10mb" })` means one request can trigger thousands of `findById` calls | `pricing.priceItems`, `server.js:66` | Cap the item count (e.g. 100) and the body size (e.g. 200kb) |

## Informational
- `GET /api/health` exposes the deployed commit SHA. That's fine, but be aware of it.
- The frontends ship only Firebase **web** config and `VITE_API_URL`. That is expected and not secret. Make sure the Firebase API key is restricted to your domains, and turn on Firebase App Check and phone-auth abuse limits.
- No real `.env`, service account or key files are tracked in git. `.gitignore` covers `.env*` in all apps, and `Admin_provider/` (which holds a real `PRINTER_KEY` and a `data/queue.json` of print jobs with customer names and phones) is ignored.
- Vite production builds don't emit source maps (no `sourcemap` override found).
- Express 5's default "simple" query parser means query strings can't carry `$` operators; body JSON can (see H1 and H2).
- The legacy `Chef` routes are still mounted, but they're admin-only.

---

## Network/API Exposure Findings
- **Anonymous:** full order objects via sockets (C2); an arbitrary order via `idempotencyKey` (H1); an order by `_id` (H4); all table QR tokens (M2); restaurant contact details and printer LAN IPs (M3); staff names by phone (M8).
- **Customer role:** any invoice by ID (M1).
- **Waiter role:** revenue, all historical orders with phones (M4); paid/completed status on any order (H5).
- **Tokens in URLs:** none found. The redirect URL carries only the order `_id`.
- **Error bodies:** raw `err.message` (L1); no stack traces in production.

## Authentication Findings
C1 (admin bypass), H2 (OTP brute force and injection), H3 (OTP echo), M7 (token lifetime and revocation), M8 (enumeration), L2, L7.
- **Logout:** client-side only. Tokens stay valid until they expire.
- **Passwords:** not used (the `password` field exists but is unused).
- **Refresh tokens:** none.
- **Cookies:** none used, so HttpOnly/SameSite doesn't apply. The tokens sit in `localStorage` instead.

## Authorization/RBAC Findings
- **Good:**
  - `requireAdmin`/`requireStaff`/`requireKitchen` are applied on all privileged routes I reviewed.
  - Roles are read from the database on each request, not from the JWT.
  - Chefs are blocked from placing orders.
  - Employee roles are limited to waiter or chef.
  - `updateOrderPayment` validates against the enum and `canSetPaymentStatus`.
  - Waiter calls use strict ownership checks.
  - Kitchen endpoints return PII-stripped tickets.
- **Broken object-level:** H1, H4, M1.
- **Broken function-level:** H5 (invoice status as waiter), M4 (dashboard as waiter), L5.
- **Branch/restaurant scope:** single-restaurant mode (one database), so there is no cross-tenant path. Waiters are not scoped to tables or sections; all staff see all orders by design.

## Customer Data Exposure
Customer names and phones are exposed by C2, H1 and H4, and by the `user.email` population on `GET /api/orders/:id` and admin invoices. Staff see all customer phones (by design; reduce per M4). Print-job payloads, which include guest name and phone, are persisted on the print-service PC in `data/queue.json` (Info; protect that machine).

## Admin Security
Admin takeover (C1) is the dominant risk. After that come:
- Mass assignment (L3).
- Unrestricted user deletion (L4).
- An unauthenticated diagnostic route (H6).
- File uploads use size limits and an `image/*` MIME filter, and go to Cloudinary with an `allowed_formats` list or a `resource_type: "image"` transform, which is acceptable. The purchase import checks magic bytes (good).
- There are no CSV or export endpoints.

## Waiter Security
- Waiters can set invoice status (H5), view revenue (M4), mark KOTs printed (L5), adjust inventory stock and record purchases/wastage (`requireStaff`, a business decision to confirm), and list every historical order.
- Order-taking actions are correctly gated by `requireWaiterOnDuty`.
- Waiter login is exposed to H2, H3 and M8.

## Frontend/Browser Storage Findings
- JWTs are kept in `localStorage` in every app (M7).
- Guest order tokens and the table context (`sohoj_table_ctx`, with `tableToken`) are also in `localStorage`. That's acceptable, since they are scoped.
- No secrets are in the bundles; the `VITE_*` vars are public config only.
- One `innerHTML` sink (L6); no `dangerouslySetInnerHTML`.
- *Requires verification:* whether any service worker (the FCM messaging SW in the customer app) caches authenticated API responses.

## Security Header/TLS Findings
TLS is provided by Render and Vercel (*Requires verification* of HTTP→HTTPS redirect and HSTS on the custom domains). Recommended, checked against compatibility:
- **API (`helmet`)**: the defaults are safe for a JSON API. Set `crossOriginResourcePolicy: { policy: "cross-origin" }` because the apps sit on other origins. CSP is irrelevant for JSON.
- **Frontends (`vercel.json` `headers`)**:
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(self), geolocation=(self)`. The Admin app uses voice ordering (microphone) and the customer app may use location for `dineInRange`.
  - `frame-ancestors 'none'`
  - HSTS
  - A CSP that allows `self`, the API origin (https and wss), Firebase/Google domains (`*.googleapis.com`, `*.gstatic.com`, `www.google.com` for reCAPTCHA, `*.firebaseapp.com`), `res.cloudinary.com` images, and PhonePe (redirect only).
  - Roll the CSP out as `Content-Security-Policy-Report-Only` first. Inline styles are used everywhere, so you'll need `style-src 'self' 'unsafe-inline'`.

## Dependency/Configuration Findings
`npm audit --omit=dev` (read-only; I didn't change any versions):

| Package | Where | Severity | Notes |
|---|---|---|---|
| `@grpc/grpc-js` | backend (via firebase-admin), all frontends (via the firebase SDK's Node side) | High | The backend is affected in principle; in the frontends it isn't part of the browser bundle. Fix with `npm audit fix` (a minor bump). Re-test FCM/Auth |
| `multer` 2.2–2.3 | backend | Moderate | DoS on aborted uploads (the disk-storage path; the app uses memory storage). Minor bump |
| `uuid` | backend (transitive) | Moderate | Only when a `buf` argument is passed. Low real risk. The fix needs `--force` (major) |
| `axios` ≤1.19 | admin | High | Prototype-pollution gadgets need a separate pollution source. Minor bump; check `backend` axios too |
| `follow-redirects` | admin | Moderate | Header leak on cross-domain redirect. Minor bump |
| `undici` | customer, waiter (transitive, Node-side) | High | Not in the browser bundle. Fix via the parent upgrade |
| `react-router` 6–7.17 | customer, waiter, kitchen | Moderate | Needs `--force`, which may be a major bump. Test routing before upgrading |
| print-service | n/a | n/a | 0 vulnerabilities |

Config notes:
- `OTP_PROVIDER=console` must never be set in production (H3).
- Set `app.set("trust proxy", 1)` before adding rate limits.
- `dns.setServers(["1.1.1.1","8.8.8.8"])` is hard-coded, which is fine.
- No Docker or CI config is in the repo.

---

## Endpoint Inventory

Legend: **Pub** = no auth · **Opt** = optionalProtect (guest or user) · **Auto** = token optional (autoAuth) · **JWT** = protect · Admin/Staff/Kitchen/Emp = RBAC.

| Method | Endpoint | Role | AuthN | AuthZ | Sensitive data | Main risk | Severity |
|---|---|---|---|---|---|---|---|
| GET | /api/health | any | Pub | none | commit SHA | info | Info |
| GET | /api/test-whatsapp/:phone | any | **Pub** | **none** | sends WhatsApp | abuse/cost | **High (H6)** |
| POST | /api/auth/admin/firebase-login | any | **Pub** | **none (phone only)** | admin JWT | **auth bypass** | **Critical (C1)** |
| POST | /api/auth/admin/send-otp, /verify-otp | any | Pub | none | admin JWT | NoSQL injection, brute force | High (H2) |
| POST | /api/auth/waiter/*, /employee/send-otp, /verify-otp | any | Pub | none | staff JWT, OTP echo | brute force, OTP echo | High (H2/H3) |
| POST | /api/auth/employee/check-phone | any | Pub | none | staff name | enumeration | Medium (M8) |
| POST | /api/auth/employee/firebase-verify | any | Pub (Firebase token verified) | staff lookup | staff JWT | none major | – |
| POST | /api/auth/firebase-verify | any | Pub (Firebase token verified) | – | customer JWT (30d) | long token; staff name overwrite | Low (L7) |
| GET/PUT/PATCH | /api/auth/profile, /veg-mode, /language, /theme | self | JWT | self only | own profile | – | – |
| GET | /api/menu, /api/menu/categories | any | Auto | admin-only flags | – | ReDoS on `search` | Medium (M5) |
| POST/PUT/DELETE/PATCH | /api/menu/* | admin (toggle: staff) | JWT | Admin/Staff | – | – | – |
| GET | /api/categories | any | Auto | – | – | – | – |
| POST/PUT/DELETE | /api/categories/* | admin | JWT | Admin | – | – | – |
| POST | /api/orders | guest/customer/waiter/admin | Opt | role derived | order + PII | **idempotencyKey injection** | **High (H1)** |
| GET | /api/orders/my | customer | JWT | own | own orders | – | – |
| GET | /api/orders/:id | any | Auto | **soft guest check** | order, user name/phone/email | **IDOR** | **High (H4)** |
| DELETE | /api/orders/:id | owner/staff | Opt | strict | – | – | – |
| PATCH | /api/orders/:id/items | owner/staff | Opt | strict | – | – | – |
| PATCH | /api/orders/:id/confirm, /approve, /reject | staff | JWT | Staff + on duty | – | – | – |
| POST | /api/payments/phonepe/initiate | owner | Opt | soft guest check | – | IDOR (low impact) | Medium (H4) |
| GET | /api/payments/phonepe/status/:orderId | owner | Auto | soft guest check | payment state | IDOR (low impact) | Low (H4) |
| POST | /api/payments/phonepe/callback | PhonePe | X-VERIFY (timing-safe) | signature | – | – | – |
| POST | /api/invoices/generate | any | **Opt** | **none** | client prices, any userId/orderIds | integrity | **High (H5)** |
| GET | /api/invoices/my | customer | JWT | own | – | – | – |
| GET | /api/invoices/:id | any user | JWT | **none** | invoice | **IDOR** | Medium (M1) |
| GET | /api/admin/dashboard | staff | JWT | **Staff** | revenue, orders + phones | over-privilege | Medium (M4) |
| GET | /api/admin/orders | staff | JWT | Staff | all orders + phones | volume, ReDoS | Medium (M4/M5) |
| GET | /api/admin/orders/combined-bill | staff | JWT | Staff | orders + phones | – | – |
| GET | /api/admin/invoices/all | staff | JWT | Staff | invoices + email | minimisation | Low |
| PATCH | /api/admin/invoices/:id/status | staff | JWT | **Staff** | sets PAID/COMPLETED | **state-machine bypass** | **High (H5)** |
| PUT | /api/admin/orders/:id/status | staff | JWT | Staff + state machine | – | – | – |
| PATCH | /api/admin/orders/:id/payment | staff | JWT | Staff + enum + role map | – | – | – |
| POST | /api/admin/orders/:id/add-items, /print-bill | staff | JWT | Staff | – | – | – |
| GET/DELETE | /api/admin/users[/:id] | admin | JWT | Admin | customer phones | delete any user | Low (L4) |
| GET | /api/admin/attendance/* | admin | JWT | Admin | staff data | – | – |
| GET | /api/admin/tables | any | **Auto** | **none** | **qrToken for all tables** | QR bypass | Medium (M2) |
| GET | /api/admin/tables/:tableNo/validate | any | Pub | token compare | label | – | – |
| GET/POST/PUT/DELETE | /api/admin/tables/* (write), /takeaway-qr | admin | JWT | Admin | – | mass assignment | Low (L3) |
| GET/POST | /api/admin/table-sessions/* | staff | JWT | Staff | – | – | – |
| * | /api/admin/waitlist/* | staff | JWT | Staff | guest phones | – | – |
| * | /api/admin/inventory/* | staff/admin | JWT | Staff (read, adjust, purchase, wastage) / Admin | costs | business scope | Info |
| * | /api/admin/employees/* | admin (me/*: employee) | JWT | Admin/Emp | staff phones | – | – |
| * | /api/admin/chefs/* (legacy) | admin | JWT | Admin | – | – | Info |
| GET | /api/kitchen/orders; PATCH /:id/status | chef/admin | JWT | Kitchen, PREPARING/READY only | PII-stripped | – | – |
| GET | /api/admin/restaurant/profile | any | **Auto** | none | **phone, email, printer IPs** | over-exposure, enables C1 | Medium (M3) |
| GET | /api/admin/restaurant/restaurant/profile | any | **Pub** | none | same | same | Medium (M3) |
| PUT/POST/DELETE | /api/admin/restaurant/profile, /logo, /payment-qr | admin | JWT | Admin | – | mass assignment | Low (L3) |
| GET/PATCH | /api/admin/printer/status, /queue, /kot/:id/status | staff | JWT | Staff | bill payload PII | waiter can alter KOT | Low (L5) |
| POST/GET/DELETE | /api/admin/printer/devices | admin | JWT | Admin | printer key (shown once) | – | – |
| POST/GET | /api/notifications/* (self) | user | JWT | self | – | – | – |
| POST/GET | /api/notifications/admin/* | admin | JWT | Admin | – | – | – |
| POST | /api/waiter-calls; GET/DELETE /order/:orderId | owner | Auto | **strict** | adminPhone | – | – |
| GET/PATCH | /api/waiter-calls/mine, /:id/ack, /:id/resolve | staff | JWT | Staff | – | – | – |
| GET | /api/coupons, /check/:code | any | Opt | audience | – | code enumeration (no rate limit) | Low (M6) |
| * | /api/coupons/admin/* | admin | JWT | Admin | – | – | – |
| POST | /api/support | any | Opt | – | sends WhatsApp to owner | spam (no rate limit) | Medium (M6) |
| GET | /api/support/my | user | JWT | own | – | – | – |
| * | /api/attendance/* | employee | JWT | Emp (self) | – | – | – |
| WS | connect (no auth) → `tenant:{key}` | anyone | none | – | **full orders (legacy emits)** | **PII broadcast** | **Critical (C2)** |
| WS | join-order | guest/user/staff | token/owner | strict | order updates | – | – |
| WS | register-printer | staff | JWT | Staff | bill payloads | over-broad | Low (L5) |
| WS | printer auth (printerKey), get-queue, report-job-status | print-service | hashed device key | device only | print payloads | – | – |

## Data-Minimization Review

| Response | Frontend needs | Extra data returned | Recommendation |
|---|---|---|---|
| `GET /orders/:id` (customer) | items, totals, status, timestamps, table, payment status | `user.email`, `statusHistory.changedBy` (staff names/ids), `payment.raw`, `idempotencyKey`, `waiterId`, `createdBy`, internal audit fields | `toCustomerOrder()` serializer |
| `POST /orders` response | `_id`, `orderId`, status, totals, `guestAccessToken` | the full document | Same serializer |
| `GET /admin/orders` (waiter) | active orders, table, items, guest name/phone for the call | `payment.raw`, `user.email`, history since the beginning | Staff serializer; cap results and default to active orders |
| `GET /admin/dashboard` (waiter) | – (admin feature) | revenue, all-status order lists | Admin-only |
| `GET /admin/restaurant/profile` (public) | branding, hours, charges, payment options | phone, email, contactPerson, printerIps, timestamps | Public DTO |
| `GET /admin/tables` | tableNo, label, seats, status | `qrToken`, `qrCode` data-URI (large), `qrUrl` | Staff DTO; admin gets the QR fields |
| `GET /admin/invoices/all` | invoice list | `user.email` | Drop email |
| Socket `order:*` staff events | order | `payment.raw` | Staff serializer |

---

## Recommended Fixes (prioritised remediation plan)

### Fix immediately (same day). Stops unauthenticated cross-user or cross-role access.
1. **C1:** verify a Firebase ID token in `firebaseLogin` and update the Admin login to send it. Then **rotate `JWT_SECRET`**, which logs everyone out once but invalidates any forged admin tokens.
2. **C2:** delete the three legacy `rooms.tenant(...)` order emits in `sockets/socket.js`.
3. **H6:** delete `/api/test-whatsapp/:phone`.
4. **H5:** delete `POST /api/invoices/generate` (nothing calls it) and make invoice status `requireAdmin`.
5. **H1:** type-check `idempotencyKey` and scope the replay lookup to the caller. Add a body sanitiser that rejects `$`/`.` keys.
6. **H2 (part):** remove the unused `/auth/admin/send-otp` and `/auth/admin/verify-otp` routes.

### Fix next (this week)
7. **H4:** make the guest check strict on `GET /orders/:id` and the payment routes; add a customer order serializer.
8. **H2/H3/M6:** OTP attempt limits, `crypto.randomInt`, no OTP echo or logging in production, `express-rate-limit` on auth, support, orders and coupons, plus `trust proxy`.
9. **M2/M3:** auth-gate `GET /admin/tables` and strip QR fields; add a public profile DTO without phone, email or printer IPs; require the table token for guest dine-in orders.
10. **M1:** invoice ownership check.
11. **M4:** dashboard admin-only; cap `limit` on `GET /admin/orders`; staff serializer.

### Then (hardening)
12. **M5:** escape every `$regex`.
13. **M7:** a `tokenVersion` revocation plus shorter-lived tokens.
14. **M8:** a generic response for staff phone checks.
15. **L-items:** L1 (generic 500s), L3 (field allow-lists), L4, L5, L6, L7, L10.
16. **L8/L9:** `helmet`, a CORS allow-list, frontend security headers (CSP in Report-Only first).
17. **Dependencies:** `npm audit fix` (non-force) per app, run the build and backend tests, and upgrade `react-router` separately after testing.

## Verification Plan (staging only, test data only)
1. **C1:** POST `{phone}` alone to `/auth/admin/firebase-login` → 400/401. A real Firebase login still works. An old token fails after the secret rotation.
2. **C2:** an anonymous `socket.io-client` with `onAny` receives no order events while you place, confirm and cancel a test order. The Admin, Waiter and Kitchen apps still update live.
3. **H1:** `{"idempotencyKey":{"$ne":null}, ...}` → 400. A legitimate retry with the same string key from the same caller still returns the same order.
4. **H2:** the 6th wrong OTP invalidates the code; the rate limit returns 429; `{"phone":{"$ne":""}}` → 400.
5. **H3:** with no SMS credentials and `NODE_ENV=production`, `send-otp` does not include `otp` (or refuses).
6. **H4:** `GET /orders/:id` without headers → 403; with its guest token → 200; with another order's token → 403; as another logged-in customer → 403; as a waiter → 200.
7. **H5:** `POST /invoices/generate` → 404; a waiter PATCHing invoice status → 403.
8. **M1–M4:** repeat as anonymous, customer A, customer B, waiter and admin, and compare the response fields against the DTO lists above.
9. Run `for f in test/*.test.js; do node "$f"; done` in `restaurant-server` and `npm run build` in every frontend.

## Security Regression Checklist (add to PR review)
- [ ] Every new route has `protect` plus an explicit `require*` guard, or a written reason for being public.
- [ ] Nothing reads `req.body.X` straight into a Mongo filter without `String()`, number coercion, or `$`-key rejection.
- [ ] Any `$regex` from user input is escaped and length-capped.
- [ ] Any by-ID read of a customer-owned resource (order, invoice, ticket, waiter call) checks ownership (user id or guest token); staff access is explicit.
- [ ] No order, payment or PII emit to `rooms.tenant(...)`; kitchen emits use the PII-stripped helper.
- [ ] Status and payment changes go through `transitionOrderStatusTx` / `canSetPaymentStatus`, never `updateMany`.
- [ ] Public responses go through a DTO; no `toObject()` of whole documents on public routes.
- [ ] No OTP, token or secret in responses or logs; no debug or test routes in `server.js`.
- [ ] Any JWT-issuing route verifies a proof (Firebase ID token or OTP with an attempt limit), never just a phone number.
- [ ] New client env vars are `VITE_*` public config only; secrets stay in the backend `.env`.
- [ ] `npm audit --omit=dev` reviewed on dependency changes.

*This audit is a point-in-time source review. Finding no issue in an area does not mean that area is secure. Items marked "Requires verification" need a staging run to confirm.*
