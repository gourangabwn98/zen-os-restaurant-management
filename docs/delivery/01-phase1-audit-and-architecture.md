# Zen OS Delivery — Phase 1: Repository Audit & Architecture

Status: **Phase 1 complete — awaiting business decisions before Phase 2.**
Date: 2026-11-19 · Branch inspected: `feature/offline-first`

---

## 1. What exists today (verified in the code)

| Area | Finding | Where |
|---|---|---|
| Backend | One Express 5 + Mongoose 9 + Socket.IO 4 server, ES modules. All schemas in one file. | `restaurant-server/config/getModels.js` |
| Database | MongoDB Atlas (`mongodb+srv`) — a replica set, so **multi-document transactions are available** (already used by `sendToKitchenTx`, `placeOrderTx`). | `restaurant-server/.env` |
| Auth | JWT (`protect`) + RBAC (`middleware/rbac.js`). Employees log in by phone OTP / Firebase phone via `/auth/employee/*`; returns whatever `role` the `User` has. | `routes/authRoutes.js` |
| Employees | `User` documents, `role` ∈ admin, manager, inventory_manager, waiter, chef, customer, staff. `status` Active/Inactive. Created only by admin/manager (`POST /api/employees`). Manager scope guard in `middleware/managerScope.js`. | `utils/roles.js` |
| Order types | `DINE_IN | TAKEAWAY | ONLINE`. `ONLINE` is the **Delivery** service (`utils/serviceToggles.js`), **disabled by default** (`services.delivery: false`). | `utils/orderStateMachine.js` |
| **Home delivery** | **Not implemented.** The customer cart only offers Dine-in/Takeaway. `Order` has **no delivery address, no customer coordinates, no delivery fee, no rider.** | `customer/src/pages/CartPage.jsx`, `Order` schema |
| Order lifecycle | Strict state machine with `TRANSITION_ROLES`. `READY → DELIVERED` currently means "served at table / handed over". `COMPLETED` only via billing settle (PAID) or admin. | `utils/orderStateMachine.js` |
| Restaurant location | `RestaurantProfile.latitude/longitude` exist (used by the dine-in radius gate). | `utils/diningRadius.js` |
| Realtime | Role-scoped rooms: tenant, staff, kitchen, printers, order:{id}, user:{id}. Event names are `noun:verb` (`order:new`, `waiter_call:new`). | `sockets/socket.js`, `utils/tenantKey.js` |
| Push | Firebase Admin is wired; current FCM use is **topic** broadcast to customers (offers). Per-token sends to staff are not implemented yet. | `services/notificationService.js` |
| Background timers | `setInterval` ticks in `server.js` (auto-send to kitchen, pay-first expiry, offers). Same pattern fits delivery-offer expiry. | `server.js` |
| Tests | Plain Node + `assert`, fake models, no live DB. ~65 suites. | `restaurant-server/test/` |
| Frontends | React 19 / Vite, no UI kit, inline styles, PWA shells. No Google Maps anywhere. | `admin/`, `customer/` |
| Credentials present | Firebase **web** config (customer/admin), Firebase Admin (server). **Missing:** Google Maps keys, an Android `google-services.json`, an Android release keystore. | `.env` files (names only inspected) |
| Build machine | JDK 17, Android SDK (platforms, build-tools, NDK, emulator), adb, Node 22 — **an APK can be built here.** | — |

### Gaps the delivery feature must fill first
1. A real **delivery checkout** in the customer app: address, map pin / GPS coordinates, contact phone, delivery-area check.
2. **Delivery fields on `Order`** (address snapshot, drop coordinates), priced and validated server-side.
3. A **`delivery` employee role** — the login, RBAC, socket and FCM plumbing for riders.
4. **Per-device FCM** sends to staff (riders), alongside the existing topic broadcast.

---

## 2. Proposed architecture (respects every CLAUDE.md rule)

### 2.1 Identity — no new auth system
- Add role `delivery` to `User.role`. Riders are `User` documents, created by admin/manager on **Admin → Employees** (same form, new role option), logged in through the existing `/auth/employee/*` OTP flow. No public signup.
- Deactivate = existing `status: Inactive`. **Suspend** = new `deliverySuspendedAt` + reason, enforced in RBAC for delivery routes and in the eligibility query.
- `utils/roles.js` gains `DELIVERY`; riders are **not** staff (`isStaffRole` stays false). They never join the `staff` room.

### 2.2 New collections (none duplicate an existing entity)

| Model | Purpose | Key invariants |
|---|---|---|
| `DeliveryPartnerState` | One per rider: `online`, `activeCount`, `capacity` (null → restaurant default), `lastLocation {lat,lng,accuracy,at}`, `fcmTokens[]` | unique `partner`. Capacity is claimed with **one atomic update**: `{partner, online:true, activeCount:{$lt: cap}} → $inc activeCount` |
| `DeliveryJob` | The delivery lifecycle of exactly one order | **unique `order`**. `status`: `SEARCHING → ASSIGNED → AT_RESTAURANT → PICKED_UP → AT_CUSTOMER → DELIVERED`, or `FAILED` / `CANCELLED`. Fields: `partner`, `round`, `offerExpiresAt`, `otpHash`, `otpAttempts`, address/coordinate snapshots, `trackingTokenHash`, `trackingExpiresAt`, `trackingRevokedAt`, timestamps per step |
| `DeliveryOffer` | One per (job, partner, round): `SENT | REJECTED | EXPIRED | WON | LOST` | unique `{job, partner, round}` → idempotent notifications, no duplicate pushes |
| `DeliveryLocation` | GPS breadcrumbs while a rider has active jobs | TTL index (default **7 days**), `{partner, at}` index |
| `DeliveryEvent` | Append-only audit (offered, accepted, rejected, picked up, OTP fail, reassigned, admin action…) | no update/delete hooks, same pattern as `DutyHistory` |

`RestaurantProfile.delivery`: `{ defaultCapacity: 3, offerTtlSeconds: 45, maxRounds: 5, radiusKm, otpRequired: true, trackingTtlHours: 6 }` — admin-editable in the database, no redeploy.

### 2.3 Restaurant lifecycle vs delivery lifecycle (kept independent)
- `Order.status` is unchanged for the kitchen: `CONFIRMED → PREPARING → READY`.
- `DeliveryJob.status` is the rider's lifecycle. The **only** couplings:
  - Pickup (`AT_RESTAURANT → PICKED_UP`) is allowed only when `Order.status === READY`.
  - OTP-verified drop (`→ DELIVERED`) moves the order `READY → DELIVERED` through `transitionOrderStatusTx` with a new role **`delivery`** added to `TRANSITION_ROLES["READY->DELIVERED"]`, so the state machine stays the single authority.
  - Order `CANCELLED` → job `CANCELLED`, capacity released, rider notified.
- Completing order A touches only job A; capacity is released per job.

### 2.4 Broadcast and acceptance
1. Trigger (see decision **D1**) creates the `DeliveryJob` (unique on `order` → idempotent).
2. Eligible = role `delivery`, `status Active`, not suspended, `online`, `activeCount < capacity`, not already offered in this round.
3. A `DeliveryOffer` row is upserted per rider, then emitted to `tenant:{k}:user:{riderId}` and sent by FCM. Offers carry **no customer name/phone**, only pickup, drop area and distance.
4. **Accept** = one transaction: (a) `DeliveryJob {_id, status:SEARCHING, round} → ASSIGNED, partner`; (b) capacity `$inc` guarded by `$lt`. Either failing aborts both. The loser gets `delivery:already_assigned`, and every other open offer gets the same.
5. A server tick expires offers at `offerExpiresAt`, re-broadcasts (`round + 1`) up to `maxRounds`, then marks the job **escalated** for the admin (assign / reassign manually through the same atomic path).
6. A rider going offline releases nothing they already accepted. Unaccepted offers to them simply lapse.

### 2.5 Realtime rooms (new)

| Room | Who | Carries |
|---|---|---|
| `tenant:{k}:user:{riderId}` (existing helper) | that rider | offers, their jobs (full address/phone only **after** acceptance) |
| `tenant:{k}:delivery-admin` | admin, manager | live rider locations, job board |
| `tenant:{k}:track:{jobId}` | the customer holding that job's tracking token | rider position + **only that job's** status/ETA |

Events: `delivery:offer`, `delivery:offer_expired`, `delivery:already_assigned`, `delivery:assigned`, `delivery:status_updated`, `delivery:location`, `delivery:capacity_updated`, `delivery:completed`, `delivery:cancelled` (same `noun:verb` style as `order:*`).

### 2.6 Tracking links
`/track/:token`: 32 random bytes, only a SHA-256 hash is stored, it expires (`trackingTtlHours` after delivery) and is revocable (admin, or order cancel). The public endpoint returns the restaurant pin, **this** customer's drop pin, the rider's position and the job status. It never returns other jobs.

### 2.7 Maps and routes
- Google API keys stay **server-side** for Routes API calls (`/api/delivery/route`). Android Maps SDK and Maps JS keys are restricted by package/SHA-1 and by HTTP referrer.
- Multi-stop ordering: pickups first (they share the restaurant), then drops ordered by **Routes API waypoint optimisation**, constrained by acceptance time (food freshness). The rider sees the suggestion and is never re-sequenced without seeing it.
- **If no key or the API fails, the app shows straight-line distance labelled "approx." and no ETA — never invented numbers.** Turn-by-turn navigation hands off to the Google Maps app (`google.navigation:` intent).

### 2.8 Android app
React Native (bare, TypeScript) at `delivery-app/`. `react-native-maps` (Google provider), `@react-native-firebase/messaging`, and a **custom Kotlin foreground service** (FusedLocationProvider, `foregroundServiceType="location"`). The service runs only while `activeJobs > 0` and posts batches. A file-backed queue covers offline gaps. It restarts after normal process recreation, but does **not** survive force-stop, permission revocation or shutdown (documented). Inactive → no tracking.

### 2.9 What is explicitly NOT touched
Print service, KOT/bill jobs, printer config, PhonePe/UPI code, dine-in/takeaway flows, existing auth endpoints (only reused).

---

## 3. Business decisions (approved 2026-11-19)
- **D1 — Broadcast on confirm.** The `DeliveryJob` is created and broadcast when the order reaches `CONFIRMED` (a customer order accepted by staff, or a pay-first order promoted). Pickup stays blocked until `Order.status === READY`.
- **D2 — Prepaid only.** A delivery (`ONLINE`) order must use the existing pay-first PhonePe flow (`AWAITING_PAYMENT` → verified payment). The server rejects Cash for `ONLINE` orders. **No payment code is changed** and riders never record money.
  - Consequence: delivery needs PhonePe configured. If it isn't, the customer app hides Delivery, and the server rejects the order.
- **D3 — No delivery fee.** No `utils/pricing.js` change. The server enforces an admin-configurable delivery radius (km from `RestaurantProfile.latitude/longitude`) instead.
- **Earnings/incentives:** no approved rules exist, so this ships as a read-only "deliveries completed" summary (counts/durations, no money).
- **Pacing:** stop after each phase for owner review. Nothing is committed or pushed.

## 4. Inputs only the owner can provide
| Needed for | Item |
|---|---|
| Android map | Google Maps **Android SDK** key (restrict to app ID + SHA-1) |
| Customer tracking map | Google Maps **JavaScript API** key (restrict to the customer domain) |
| Routes / ETA | Google **Routes API** server key (backend `.env`) |
| Rider push | `google-services.json` for an Android app `com.zenos.delivery` registered in the existing Firebase project |
| Release APK | A release keystore + passwords (otherwise a debug-signed APK only) |
| End-to-end test | API base URL reachable from the phone, and a physical Android device |

## 5. Rollback (applies to every phase)
All work stays uncommitted on `feature/offline-first`. New code lives in new files (`services/delivery*`, `routes/deliveryRoutes.js`, `delivery-app/`, admin `pages/admin/delivery/`). Existing files get small, additive edits only: the role enum, `TRANSITION_ROLES`, the socket join, Order delivery fields, nav entries. Rollback = revert those edits and delete the new files. The schema additions are optional fields, so existing documents need no migration.
