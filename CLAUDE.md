# CLAUDE.md

Guidance for Claude Code (or any AI agent) working in this repository.
Read this before making changes — several of the rules below exist because
the exact mistake they describe already happened once in this codebase.

## What this is

A restaurant management system built around **one backend and one shared
MongoDB database**, with five separate frontends talking to it:

```
Restaurant-Management-System/
├── restaurant-server/   Node/Express + Socket.IO + Mongoose — the ONLY backend
├── admin/               React/Vite — menu, tables, inventory, employees, settings
├── customer/            React/Vite — QR/table ordering, guest or logged-in
├── waiter/               React/Vite — floor operations (tables, orders, confirm, bill)
├── kitchen/              React/Vite — chef login, live KOT board, alert sound
├── print-service/        Node CLI (no build step) — bridges the backend to physical printers
├── README.md
└── CLAUDE.md             (this file)
```

**Do not create a sixth backend, a second database, or a duplicate auth
system for any role.** Every app above authenticates against the same
`User` collection and talks to the same REST/Socket.IO API.

## Non-negotiable architectural rules

1. **Single-restaurant mode.** The backend always connects to exactly one
   database (`MONGO_URI`). There is no multi-tenant header/slug resolution
   — that used to exist (`x-restaurant-db`, `x-restaurant-slug`, a "DAB"
   lookup service) and was **deliberately removed** because it caused
   admin/customer/waiter to silently read and write different databases.
   If you ever see code trying to resolve a tenant from a request header or
   a `mongoUri` sent by a client, that is regressing a fixed bug — delete
   it, don't extend it.
2. **The backend is authoritative for**: price, order status, order
   source, payment status, employee role, and stock levels. Never trust
   any of these when they arrive from a client. Every write path that sets
   one of these fields should be re-derived server-side, not copied from
   `req.body`.
3. **Employees are `User` documents**, not a separate directory. `role` is
   one of `admin | waiter | chef | customer`. An admin creates
   waiter/chef accounts via `Admin → Employees`; there is no public
   employee signup anywhere. A legacy `Chef` model / `chefRoutes.js` /
   `ChefsPage.jsx` still exists, unused, left in place for safety — do not
   build new features on it.
4. **Order status is a strict state machine** (`utils/orderStateMachine.js`):
   ```
   PENDING_CONFIRMATION → CONFIRMED → PREPARING → READY → DELIVERED → COMPLETED
                        ↘ CANCELLED (only from the first three states)
   ```
   Every allowed transition has an explicit role list in
   `TRANSITION_ROLES`. A chef may **only** do
   `CONFIRMED→PREPARING` and `PREPARING→READY` — nothing else, and is
   explicitly blocked from placing orders at all. If you add a new
   transition or role, add it there, not as an ad-hoc check somewhere else.
5. **KOT/bill print jobs are idempotent by construction**: `KOTJob` has a
   unique index on `order` (one KOT ever, per order), and every job status
   change goes through an atomic conditional `findOneAndUpdate`, never a
   plain `save()`. Follow this pattern for any new background job type.

## The single most important gotcha in this codebase

**Never hardcode a status/type/payment string. Always import the canonical
enum.** This system went through an early rename (`Placed→CONFIRMED`,
`Paid→PAID`, `Dining→DINE_IN`, etc.) and a full sweep later found **~28
separate places in one admin file alone** still comparing against the old
strings — silently breaking the status filter, the type filter, two
separate "mark paid" controls, two separate "change status" controls, the
table-occupancy board, and every revenue statistic on the page, all at
once. None of it threw an error; it just matched nothing, forever.

If you're about to write `status === "something"` or `paymentStatus ===
"something"`, first check `restaurant-server/utils/orderStateMachine.js`
for the real values:
- Order status: `PENDING_CONFIRMATION | CONFIRMED | PREPARING | READY | DELIVERED | COMPLETED | CANCELLED`
- Order type: `DINE_IN | TAKEAWAY | ONLINE`
- Payment status: `PENDING_VERIFICATION | PAID | FAILED`
- Payment method: `Cash | Online` (this one genuinely is mixed-case — don't "fix" it)

## Socket.IO room architecture

`restaurant-server/sockets/socket.js` + `utils/tenantKey.js`. Rooms are
scoped by role, **not just for organization but for data protection**:

| Room | Who joins | Carries |
|---|---|---|
| `tenant:{key}` | everyone connected | general presence |
| `tenant:{key}:staff` | admin, waiter | full order data, **payment status, guest name/phone** |
| `tenant:{key}:kitchen` | admin, chef | KOT/status events, **PII-stripped** |
| `tenant:{key}:printers` | print-service (auth'd by a `PrinterDevice` key, not a JWT) | print job payloads |
| `tenant:{key}:order:{id}` | the specific customer/guest tracking that order | that order's updates only |

**A chef socket must never join the `staff` room.** This was a real bug —
chef sockets originally joined nothing, so the entire Kitchen app's
realtime feed silently never fired. The fix was a dedicated `kitchen` room
with a hand-stripped payload (`toKitchenSafeOrder`-style helper), not
adding chef to the existing `staff` room. If you add a new staff-room
event that a chef also needs, mirror it into the kitchen room with the
sensitive fields removed — don't just widen `isStaff`.

## Payment

Two payment paths, in priority order:

**1. PhonePe Payment Gateway (`services/paymentService.js`, `/api/payments/*`).**
Hosted `PAY_PAGE` checkout, salt-key (`X-VERIFY`) flow. Credentials
(`PHONEPE_MERCHANT_ID`, `PHONEPE_SALT_KEY`, `PHONEPE_SALT_INDEX`,
`PHONEPE_ENV`) live in the **backend `.env`** — the salt key is a secret,
same category as `JWT_SECRET`, so it does **not** go on `RestaurantProfile`.
The public profile endpoint exposes only a derived boolean
`phonePeEnabled`; the customer app shows "Pay with PhonePe" when it's true.
Flow: customer hits `POST /api/payments/phonepe/initiate` → we call
PhonePe `/pg/v1/pay` with a per-attempt `merchantTransactionId` and an
amount **re-derived from `order.total` server-side** (never the client) →
customer is redirected to PhonePe → PhonePe reports the outcome via a
server-to-server callback (`POST /api/payments/phonepe/callback`) and/or
our own signed status query (`GET /pg/v1/status/...`, triggered by the
customer's `GET /api/payments/phonepe/status/:orderId` poll on return).

**The redirect landing back on our URL is never proof of payment** — same
principle as the old UPI rule. An order's `paymentStatus` becomes `PAID`
automatically **only** when a checksum-verified PhonePe result reports
`PAYMENT_SUCCESS`, applied via `applyPhonePeResult()` — a single atomic
conditional `findOneAndUpdate` (`payment.state != SUCCESS → SUCCESS`),
never check-then-save, so callback + poll + admin re-check racing each
other is safe (mirrors the `KOTJob` idempotency pattern). A `FAILED`
gateway attempt deliberately leaves `paymentStatus` at
`PENDING_VERIFICATION` so cash / a retry still works. `order.payment`
(sub-doc: `provider`, `merchantTransactionId`, `phonepeTransactionId`,
`state`, `amount`, `raw`) is the gateway attempt's own lifecycle — do not
confuse `payment.state` with the order's `paymentStatus`. The callback
route has no JWT — it is authenticated solely by verifying `X-VERIFY`
against the raw body with a constant-time compare; reject a mismatch.

**2. UPI deep link (fallback, when PhonePe is off).**
`RestaurantProfile.upiId` / `upiPayeeName` are admin-configurable
(`Admin → Profile → Payment`), stored in the database (an admin changes
them without a redeploy). The customer app builds a raw `upi://pay?...`
deep link client-side. **Opening the UPI app is never treated as proof of
payment** — those orders stay at `PENDING_VERIFICATION` until an explicit
admin/waiter action (`PATCH /admin/orders/:id/payment`), which validates
the value against the enum strictly (reject anything else, don't silently
accept it). That manual action still exists and is still authoritative for
both paths.

Do **not** add a second/third gateway by copying this — if you must,
extend `paymentService.js` with the same "verified result only, atomic
apply" contract. No gateway may ever mark an order `PAID` on anything less
than a checksum-verified success.

## OTP / SMS provider selection

`restaurant-server/utils/sendOTP.js` **auto-detects** the provider from
whichever credentials are actually present (Twilio checked first, then
MSG91, then a console-only fallback that doesn't send real SMS). This used
to be hardcoded to `NODE_ENV === "production" ? "msg91" : "console"`,
which broke OTP login entirely for any deployment that only had Twilio
configured. Don't reintroduce an `NODE_ENV`-based provider switch — if you
add a third provider, add it to the same auto-detect chain in
`resolveProvider()`.

Employee (waiter/chef) login and admin login share the same
`/auth/employee/*` and `/auth/waiter/*` endpoints — the latter are kept as
route aliases pointing at the same controller functions for backward
compatibility. Don't duplicate the OTP send/verify logic for a new role;
the existing functions already look up the `User` by phone and return
whatever role that account has.

## Inventory

`services/inventoryService.js`. Stock is deducted **exactly once per
order**, at confirmation time, inside the same MongoDB transaction as the
KOT job creation — guarded by an atomic `stockDeducted: false → true` flag
plus per-ingredient atomic decrements (`currentStock: {$gte: qty}`) so
concurrent confirms can't oversell. If you touch order confirmation, keep
deduction and KOT creation in the same transaction; splitting them apart
reopens the "order confirmed but stock never moved" failure mode.

Low-stock alerts must fire from **every** path that changes stock,
including the order-confirmation deduction path — this was a real gap
(manual adjustment/wastage alerted correctly, but the actual KOT-triggered
deduction didn't) that's now fixed via `deductStockForOrder` returning an
`alerts` array that callers emit via `emitInventoryAlert`.

## Print service

Runs **on-premises**, never as a cloud deployment — it needs to be on the
same LAN as (or physically attached to) the printers. Authenticates to the
backend via a long-lived `PrinterDevice` key (hashed server-side), not a
staff JWT — an unattended background process shouldn't hold staff-level
credentials. On every connect/reconnect it pulls the backend's current
queue and reconciles against its own disk-persisted local queue, keyed by
the backend's own job `_id` — this is what makes "never print the same job
twice, never lose a job across a restart" actually true; don't replace it
with a purely event-driven push model.

USB printing goes through the Windows print **share** (`copy /b file
\\localhost\ShareName`), not the `printer` npm package — that package is a
native addon with a broken dependency tree and needs a C++ build
toolchain. Don't reintroduce it.

## Conventions to follow when adding features

- **Services layer, thin controllers.** Business logic lives in
  `services/*.js` (pure-ish functions taking `{ models, ...args }`);
  controllers are a thin HTTP wrapper that calls a service and maps errors
  (`err.statusCode || 500`); routes wire RBAC middleware
  (`middleware/rbac.js`: `requireAdmin`, `requireStaff`,
  `requireKitchen`, `requireEmployee`).
- **Audit/actor fields**: use `buildActor(user)` (in
  `services/orderService.js`) for any "who did this" field. Note
  `getSourceFromUser` (order source: CUSTOMER/WAITER/ADMIN only) is
  deliberately narrower than the actor-role logic used for
  `preparedBy`/`readyBy`/etc. (which also includes CHEF) — getting these
  confused mis-attributes a chef's action as a customer's.
- **Idempotency via atomic conditional updates + unique indexes**, not
  in-memory locks or "check then write" — every background job
  (KOTJob, BillPrintJob, table sessions) follows this pattern.
- **Keep frontend dependencies minimal.** No state-management library, no
  UI kit, no CSS framework — hand-rolled inline styles and small shared
  components throughout. This is intentional, not an oversight; match it.
- **Restaurant-level configuration lives in the database**
  (`RestaurantProfile`: UPI ID, GST rate, service charge, banners, printer
  IPs), not environment variables — an admin needs to change these without
  a redeploy.

## Commands

```
# Backend
cd restaurant-server && npm install && npm start
cd restaurant-server && for f in test/*.test.js; do node "$f"; done   # no jest — plain Node + assert

# Any frontend (admin / customer / waiter / kitchen)
cd <app> && npm install && npm run dev     # dev server
cd <app> && npm run build                  # production build — this is the correctness gate; no test suite

# Print service (runs on-premises, not in this repo's CI/deploy)
cd print-service && npm install && npm test    # has a real npm test script chaining all suites
cd print-service && npm start
```

## Environment variables

Every app has a `.env.example` — copy to `.env`, fill in real values,
never commit the real file. See each app's `.env.example` for the full
list; the backend's covers `MONGO_URI`, `JWT_SECRET`, Firebase (customer +
admin login), Cloudinary (images), Twilio/MSG91 (employee OTP + WhatsApp),
PhonePe (`PHONEPE_*` + `PUBLIC_API_URL` for the gateway callback URL, plus
the already-present `CLIENT_URL` for the post-payment redirect).

## Before touching these files, read them fully first

- `restaurant-server/utils/orderStateMachine.js` — the transition/role map
- `restaurant-server/services/orderService.js` — order lifecycle + actor logic
- `restaurant-server/sockets/socket.js` — room membership and emit helpers
- `restaurant-server/services/inventoryService.js` — deduction/reversal transaction
- `print-service/src/queue.js` — the duplicate-protection/retry contract

Each of these encodes a rule that isn't obvious from the surrounding code,
and each has already caused a real bug once when changed without reading
the comments first.
