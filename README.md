# Restaurant Management System

A complete restaurant management system on one shared backend and one shared
MongoDB database: customer ordering, waiter floor operations, a dedicated
Kitchen Display for chefs, admin management (menu, tables, inventory,
employees, reports), local KOT/bill printing, and direct UPI payment.

```
Restaurant-Management-System/
├── backend/        Central API + Socket.IO server — everything else talks to this
├── admin/          Admin dashboard (React) — menu, tables, inventory, employees, settings
├── customer/       Customer ordering site (React) — QR/table, guest or logged-in
├── waiter/         Waiter floor app (React) — tables, orders, confirm, bill
├── kitchen/        Kitchen Display (React) — chef login, live KOT board, alert sound
├── print-service/  Local Node.js app bridging the backend to physical printers
└── README.md       This file
```

## Employee accounts (Admin, Waiter, Chef)

There is no public staff signup anywhere in this system. An admin creates
every waiter/chef account from **Admin → Employees** (name, phone, address,
category). That employee then logs into the **Waiter app** or the **Kitchen
app** with their own phone number via OTP — the same phone/OTP mechanism,
just scoped to whichever role that account actually has. Any number of
waiters and chefs can be logged in simultaneously; each is tracked by their
own account ID everywhere an order records who did what
(`createdBy`/`confirmedBy`/`preparedBy`/`readyBy`/`deliveredBy`/`completedBy`).

An admin can also open the Kitchen app — it accepts admin or chef logins.

## Order lifecycle

```
Customer order → PENDING_CONFIRMATION → (waiter/admin confirms) → CONFIRMED
  → KOT created → kitchen realtime + sound → PREPARING (chef) → READY (chef)
  → DELIVERED (waiter/admin) → COMPLETED (waiter/admin)
```

A customer can never set CONFIRMED/READY/COMPLETED directly — every
transition is validated server-side against the actual authenticated role.

## UPI payment

Direct UPI deep-link only, no payment gateway. Set it in **Admin → Profile →
Payment (UPI)**. Opening the UPI app is never treated as proof of payment —
orders stay `PENDING_VERIFICATION` until an admin/waiter manually marks them
`PAID` (or `FAILED`) after checking the actual UPI/bank receipt.

## Environment variables

Every app ships a `.env.example` — copy to `.env` and fill in real values.

- **`backend/.env`** — `MONGO_URI` (the one database the whole system
  uses), `JWT_SECRET`, `FIREBASE_*` (customer + admin phone-OTP),
  `CLOUDINARY_*` (images), `TWILIO_*` (employee OTP + WhatsApp
  notifications), `MSG91_*` (optional alternate SMS provider). The
  restaurant's UPI ID is **not** an env var — it's admin-configurable
  restaurant data, stored in the database.
- **`admin/.env`**, **`customer/.env`** — `VITE_API_URL` + `VITE_FIREBASE_*`
  (same Firebase project as the backend).
- **`waiter/.env`**, **`kitchen/.env`** — `VITE_API_URL` only (phone/OTP
  login, no Firebase needed for either).
- **`print-service/.env`** — `BACKEND_URL`, `PRINTER_KEY` (see
  `print-service/README.md`), queue/retry settings.

## Startup

```
cd backend && npm install && npm start          # start first

cd admin    && npm install && npm run dev
cd customer && npm install && npm run dev
cd waiter   && npm install && npm run dev
cd kitchen  && npm install && npm run dev

cd print-service && npm install && npm start     # run at the restaurant, near the printers
```

Backend tests: `cd backend && for f in test/*.test.js; do node "$f"; done`
Print-service tests: `cd print-service && npm test`

## Setup order

1. Run the **backend** with a real `MONGO_URI`.
2. Register an admin account, then add menu items, categories, and tables
   through the **Admin** app.
3. **Admin → Employees**: add your waiters and chefs.
4. **Admin → Profile → Payment**: set the restaurant's UPI ID.
5. **Admin → Printer**: register a printer device to get a `PRINTER_KEY`,
   then configure and start `print-service` (LAN vs USB — see its README;
   USB needs the printer **shared** in Windows, no native Node module
   required).
6. Point `admin`, `customer`, `waiter`, and `kitchen` at the backend's URL
   and start them. Waiters log into the Waiter app; chefs log into the
   Kitchen app; both via **Admin → Employees**-created accounts.

## What was changed / fixed in this pass

- **Employee Management**: the old disconnected `Chef` directory (name/phone
  only, couldn't log in) is superseded by a proper system — employees are
  `User` records with `role: waiter|chef`, created only by an admin, logging
  in through the existing phone/OTP flow (now role-generalized, reusing the
  same controller logic under `/auth/employee/*` rather than duplicating it).
  The old `Chef`/`chefRoutes` backend code is left in place, unused, for
  safety — nothing that already depended on it was removed.
- **Multiple simultaneous waiter/chef logins**: already worked correctly for
  waiters (each has their own `User` doc + JWT); now extended to chefs the
  same way. No shared accounts anywhere.
- **RBAC**: chefs can perform exactly `CONFIRMED→PREPARING` and
  `PREPARING→READY` — nothing else (no confirm, deliver, complete, cancel,
  and explicitly blocked from placing orders at all). A dedicated
  `/api/kitchen/*` surface returns a deliberately reduced ticket shape (no
  customer PII, no price/payment data) rather than just gating the existing
  admin endpoint.
- **Fixed a bug that would have silently broken the whole Kitchen app**: chef
  sockets were never joining any room that KOT events are broadcast to. Fixed
  by adding a dedicated `kitchen` Socket.IO room (admin + chef only, carrying
  a PII-stripped event payload) — separate from the `staff` room, which
  intentionally still excludes chefs since it carries payment/customer data.
- **Employee activity tracking**: `preparedBy`/`readyBy`/`deliveredBy`/
  `completedBy` (+ matching timestamps) added to every order, so "who did
  this" is always a specific employee, never just a role.
- **Fixed the Admin "Recent Orders" bug** — and, while finding its root
  cause, discovered the *entire* Admin Billing page was comparing against
  status/payment strings from before an earlier backend rename. That single
  root cause was also silently breaking: the status filter, the type filter,
  two separate "mark payment" controls, two separate "change order status"
  controls, the "Add Items" button's visibility, the dine-in table-occupancy
  board, and every revenue/paid/unpaid stat on the page. All ~28 instances
  fixed in one pass, verified with a clean build and a final sweep for any
  remaining occurrences.
- **Fixed UPI payment "not working"**: the backend and customer app already
  had full UPI deep-link support — the missing piece was that **admin had no
  UI to actually set the restaurant's UPI ID**. Added Admin → Profile →
  Payment, with UPI-ID format validation before save.
- **New Order Kitchen Sound**: implemented in the Kitchen app with a
  dedicated Web Audio tone (no bundled file, no dependency) — Ding→Ding→DING
  for a normal order, a stronger triple-hit pattern for orders flagged
  URGENT. Sound fires exactly once per genuinely new KOT (tracked by a
  persistent job-ID set), never on refresh, never on reconnect-backfill,
  never twice for a duplicate socket delivery. 🔊/🔇 toggle persisted to
  `localStorage`, default ON, with an "Enable Kitchen Sound" prompt for
  browsers that block autoplay until the first tap.
- **Waiter "Today's Statistics"**: added to the Waiter app's Profile page via
  a new self-service `/me/dashboard` endpoint any employee can call for
  their own numbers.

## Testing performed

- Backend: **91 automated test assertions**, all passing — order state
  machine (including the new chef-specific transitions and the
  staff-only-URGENT guarantee), inventory deduction/reversal/alerts, printer
  device credentials, table-clearing rules, and the new employee service
  (validation, active-phone uniqueness, category changes).
- Live-boot HTTP verification of every new endpoint (employee CRUD, kitchen
  orders, employee OTP) confirming correct 401/400 responses and zero
  runtime errors.
- Production builds run clean for all 5 frontend apps (Admin 154 modules,
  Customer 159, Waiter 142, Kitchen 131).
- Print-service: 36 automated assertions (unchanged this pass), including a
  real (non-mocked) Socket.IO reconnect/dedup test.

## What genuinely cannot be tested in this environment

- **No real MongoDB Atlas connection** — everything above the database layer
  is verified by logic-level tests and a live server boot; actual data
  persistence needs verification against your real cluster.
- **No real thermal printer or Windows print spooler** — `print-service`'s
  hardware paths are logic/protocol-tested (including simulated LAN/USB
  success, offline/retry, and a real network reconnect test) but not
  physically print-tested.
- **No real UPI app on a real phone** — the deep-link format is correct and
  the safe-by-default payment-state handling is verified, but actually
  opening a UPI app and completing a payment needs a real device.
- **Simultaneous multi-employee login** is architecturally verified (each
  account is fully independent — its own `User` doc, JWT, and socket
  connection) but wasn't load-tested with concurrent real devices.
