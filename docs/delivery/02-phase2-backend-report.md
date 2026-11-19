# Zen OS Delivery — Phase 2: Backend Report

Status: **complete — awaiting owner review before Phase 3 (Admin module).**
Nothing is committed or pushed. Nothing was run against the real database.

## 1. What was built
| Area | Delivered |
|---|---|
| Rider identity | `User.role = "delivery"`. Created on **Admin → Employees** (admin or manager). Logs in through the existing `/api/auth/employee/*` OTP. `requireDelivery` RBAC. Riders cannot place orders. |
| Checkout | A customer `ONLINE` order must be **prepaid** (pay-first PhonePe) and carry a `delivery` block (address, pin, phone) inside `RestaurantProfile.deliveryRange`. Stored as `Order.deliveryAddress`. Dine-in and takeaway are unchanged. |
| Jobs | One `DeliveryJob` per order (unique index), created when the order reaches `CONFIRMED` (D1). |
| Broadcast | Round-based offers to eligible riders (role, Active, not suspended, online, below capacity, has not rejected this job). One `DeliveryOffer` per (job, rider, round), so a rider is never notified twice. FCM high-priority data push with TTL = offer lifetime. |
| Acceptance | **One transaction:** offer SENT→WON + capacity `$inc` guarded by `activeCount < capacity` + job SEARCHING→ASSIGNED. Losers get `ALREADY_ASSIGNED` (409) and keep their capacity. Every other open card closes with `delivery:already_assigned`. |
| Multi-order | Configurable capacity (restaurant default 3, per-rider override 1–10). Each job has its own lifecycle, OTP, tracking link and audit trail. |
| Rider steps | ASSIGNED → AT_RESTAURANT → PICKED_UP (only if the order is READY) → AT_CUSTOMER → DELIVERED (4-digit OTP, max 5 tries then locked) or FAILED (reason required). |
| Order coupling | The OTP drop moves the order READY → DELIVERED through the state machine (role `delivery`, in `TRANSITION_ROLES`), in the same transaction as the job and the capacity release. An already-settled bill then completes through the existing `completeServedSettledOrder`. |
| Background tick (5 s) | Creates missed jobs, cancels jobs of cancelled orders, expires offers, re-broadcasts, escalates after `maxRounds`, takes idle riders offline (never one mid-delivery), and repairs capacity drift (`capVersion`-guarded). Safe on several instances. |
| Admin | Overview, job board, per-job audit trail, partners (online/capacity/suspend/force-offline), manual assign / unassign / re-broadcast / cancel, reset OTP, revoke tracking link, live map data, reports (day/month, completion rate, durations, per partner), settings. |
| Customer | `GET /api/delivery/orders/:orderId` (owner only): status, rider first name + phone while active, OTP, tracking link. `GET /api/delivery/track/:token` (public): only that order's destination, rider position and status. No OTP and no phones. |
| GPS | `POST /me/locations` batches (≤100) are validated for range, clock, accuracy and impossible speed. Breadcrumbs are stored **only while the rider has an active job** (TTL 7 days). The reply's `tracking: false` tells the app to stop its GPS service. |
| Security | Signed, expiring, revocable tracking tokens (HMAC with a purpose-separated key; nothing stored). Rate limits on GPS, OTP, accept and the public link. Append-only `DeliveryEvent` audit log (update/delete hooks throw). |

## 2. API (`/api/delivery`)
Rider: `GET /me` · `POST /me/online {online}` · `POST /me/heartbeat` · `POST|DELETE /me/push-token` · `POST /me/locations {points}` · `GET /me/history` · `GET /me/summary` · `GET /offers` · `POST /offers/:jobId/accept|reject` · `GET /jobs/:jobId` · `POST /jobs/:jobId/arrived-restaurant|picked-up|arrived-customer|deliver {otp}|fail {reason}`
Customer: `GET /orders/:orderId` · public `GET /track/:token`
Admin/manager: `GET /admin/overview|jobs|partners|live|reports|settings` · `GET /admin/jobs/:id/events` · `POST /admin/jobs/:id/assign|unassign|rebroadcast|cancel|reset-otp|revoke-tracking` · `PATCH /admin/partners/:id {capacity, suspended, reason}` · `POST /admin/partners/:id/force-offline` · `PATCH /admin/settings` (admin only)
Order checkout: `POST /api/orders` with `orderType: "ONLINE"`, `paymentMethod: "Online"`, `delivery: {address, landmark, latitude, longitude, contactName, contactPhone}`.

## 3. Socket.IO
| Event | Room | Notes |
|---|---|---|
| `delivery:request_received` | rider's user room (+ FCM) | offer card, no customer PII |
| `delivery:request_expired`, `delivery:already_assigned` | rider (+ FCM close) | clears the card |
| `delivery:accepted`, `delivery:job_updated`, `delivery:completed`, `delivery:job_removed`, `delivery:capacity_updated`, `delivery:presence` | rider | their own jobs only |
| `delivery:job_created`, `delivery:request_broadcast`, `delivery:status_updated`, `delivery:location_updated`, `delivery:escalated`, `delivery:rejected`, `delivery:partner_updated`, `delivery:completed` | `delivery-admin` (admin + manager) | full detail |
| `delivery:status_updated`, `delivery:location_updated` | `track:{jobId}` + that order's room | customer-safe only |
| client `join-tracking {token}` (ack) | — | joins `track:{jobId}` only for a valid, unexpired token |

## 4. Database changes (all additive, no migration)
- `User.role` enum adds `delivery`. Actor role enum adds `DELIVERY`.
- `Order.deliveryAddress` (default null). `RestaurantProfile.delivery` settings (defaults applied at read).
- New collections: `DeliveryPartnerState`, `DeliveryJob`, `DeliveryOffer`, `DeliveryLocation` (TTL 7 days), `DeliveryEvent` (append-only), with their indexes.

## 5. Files
New: `config/deliveryModels.js`, `utils/delivery.js`, `utils/deliveryStateMachine.js`, `services/deliveryService.js`, `services/deliveryRealtime.js`, `controllers/deliveryController.js`, `routes/deliveryRoutes.js`, `middleware/rateLimit.js`, `test/delivery.test.js`, `test/deliveryFlow.test.js`, `test/deliveryCheckout.test.js`, `test/fakeMongo.js`.
Modified (small, additive): `config/getModels.js`, `utils/roles.js`, `utils/orderStateMachine.js` (`READY->DELIVERED` + `delivery`), `utils/tenantKey.js`, `sockets/socket.js`, `middleware/rbac.js`, `services/orderService.js` (checkout + rider block + actor role), `services/employeeService.js`, `controllers/authController.js` (login role list), `controllers/orderController.js` / `adminController.js` / `kitchenController.js` (one non-blocking `kickDeliveryForOrder` call each), `server.js` (route + tick), `test/managerRole.test.js` (expected list now includes `delivery`), `CLAUDE.md`.
**Not touched:** print-service, KOT/bill jobs, printer config, PhonePe/UPI code, billing.

## 6. Tests
- `delivery.test.js`: **15/15**. Checkout rules, settings, OTP, token tamper/revoke/expiry, GPS sanitising, rider transitions, order state machine (rider may only do READY→DELIVERED), employee roles.
- `deliveryFlow.test.js`: **25/25**, stable over repeated runs. Covers broadcast, **2-rider and 8-rider simultaneous accept (exactly one wins, capacity rolled back)**, capacity limits and overrides, suspended/inactive exclusion, two orders on one rider with independent pickup/OTP/delivery, OTP lock + admin reset, failure path, GPS privacy (each customer's room gets only their job; no storage without active jobs; GPS stop signal), tracking privacy and revocation, offer expiry, re-broadcast, escalation, rider-online re-open, cancellation, idle timeout, drift repair, admin assign/unassign, reports.
- `deliveryCheckout.test.js`: **7/7**. Prepaid-only, PhonePe required, range, toggle, riders can't order, takeaway unchanged.
- Full backend suite: **64 of 67 suites pass.** The other 3 (`editAfterKitchen`, `menuStructure`, `payFirst`) **fail identically on a clean `HEAD` checkout**, so they predate this work (the dine-in location gate and the menu structure).

**How the concurrency tests work:** the tests run the real service code against `test/fakeMongo.js`. The fake gives atomic conditional updates, unique indexes and serialized transactions that roll back via a per-session undo log. Installing `mongodb-memory-server` for a real-mongod test was blocked by the local permission policy. A real-replica-set run (staging) is still recommended before production.

## 7. Acceptance criteria
- [x] Only an admin or manager can create a rider; there is no public signup.
- [x] Simultaneous acceptance: exactly one winner; no over-capacity; no lost capacity.
- [x] A rider can hold up to N orders; each order completes independently.
- [x] Delivery orders cannot be placed unpaid or outside the radius.
- [x] Customer views never contain another customer's data. Public tracking contains no OTP or phone.
- [x] Existing workflows: no new test failures.

## 8. Known limitations
- Not yet exercised against a live MongoDB replica set or a real FCM project (no credentials or staging DB used).
- Rate limits are per process (the hard limits live in the DB).
- Settlement of a delivered prepaid order still follows the existing billing flow (staff settles; COMPLETED follows). Auto-settling would change billing, which needs approval.
- Employee performance stats list riders with waiter-style counters (zeros). The delivery reports are the source of truth for riders.
- Route distance/ETA is not implemented yet: all distances are straight-line and labelled as such (Phase 5).

## 9. Rollback
Revert the modified files listed in §5 and delete the new ones. The schema additions are optional fields and new collections; existing documents are unaffected, and dropping the five `Delivery*` collections removes all delivery data.
