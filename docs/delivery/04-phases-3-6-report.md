# Zen OS Delivery — Phases 3–6 Implementation Report

Date: 2026-11-20 · Nothing committed, pushed or deployed · No production data touched.

## Phase 3 — Admin Delivery Management (`admin/`)

**Where:** sidebar → *Delivery* (admin + manager; the Settings tab is admin-only).
Riders are registered in **Employees → Add → Category: Delivery partner** (new option; the Employees filter also has *Delivery*).

| Tab | What it does |
|---|---|
| Board | Metrics (finding partner, escalated, out for delivery, partners online, delivered/failed today) and the job list (Needs attention / In progress / Delivered / Failed / All). Admin exceptions: **Assign** (pick a partner; full or suspended partners disabled), **Re-broadcast**, **Reassign** before pickup, **Cancel delivery** (the order itself is not cancelled), **Reset code**, **Revoke link**, **History** (append-only audit). |
| Partners | Online/offline, "no signal N min", load vs capacity, cash held. Per-rider capacity (restaurant default or 1–10), **Suspend** (with reason) / **Reinstate**, **Set offline**. |
| Live map | Restaurant, riders (live via `delivery:location_updated`, stale after 5 min) and each active drop. Google Maps with a key (`config.js googleMapsKey` / `VITE_GOOGLE_MAPS_KEY`); otherwise a to-scale schematic that **says** it is not a street map. |
| Cash (COD) | Cash held per rider; collections To verify / Disputed / Verified / All; **Verify hand-in** (existing billing settle) and **Dispute**. |
| Reports | Date range, daily or monthly: totals, completion rate, average delivery time, average wait for a rider, COD collected/awaiting, partner performance. |
| Settings | Payment methods (COD / PhonePe / default, with a live "customers will see…" preview and a warning when nothing is enabled), default capacity, offer seconds, broadcast rounds, idle-offline minutes, OTP attempts, tracking-link lifetime. |

Realtime: the page listens to the `delivery-admin` socket room and refreshes the open tab (debounced).
Files: `admin/src/pages/admin/DeliveryPage.jsx`, `admin/src/pages/admin/delivery/*`, `admin/src/services/deliveryAdminService.js`, `admin/src/utils/googleMaps.js`. Edits: `AdminLayout.jsx` (nav), `utils/access.js` (manager page), `config/runtimeConfig.js` (maps key), Employees form/filters/labels.
Checks: `npm run build` ✓; ESLint on all new files: 0 problems.

## Phase 5 — Customer checkout + live tracking (`customer/`)

- **Cart:** a *Takeaway / Home delivery* choice (only when the Delivery service is on). The delivery details form has address, landmark, name, phone and a GPS pin ("Use my current location"; accuracy shown). Payment shows only the admin-enabled delivery methods: **Cash on Delivery** by default, *Pay online* when enabled and configured. If every method is off, Delivery is shown as unavailable with the reason. The last address is remembered on the device (except the pin).
- **Order page** (owner, logged in): delivery status steps, **hand-over code** (owner only), COD amount to keep ready, rider first name + **Call**, live map, **Share live tracking link**.
- **`/track/:token`** (public, no login, no app): status, map with the moving rider marker, this order's destination only, delivery route and **ETA from Google Directions** when a browser Maps key is configured. Without a key it shows a to-scale view with straight-line distance and **no ETA** (never guessed). It contains no hand-over code and no phone numbers. It updates live via `join-tracking` (server-verified token), with a 30 s poll as a fallback. Expired, revoked or tampered links show "expired".
Files: `customer/src/pages/TrackPage.jsx`, `components/delivery/*`, `services/deliveryService.js`, `utils/googleMaps.js`; edits to `CartPage.jsx`, `OrderDetailPage.jsx`, `App.jsx`, `config/runtimeConfig.js`.
Checks: `npm run build` ✓.

## Phase 4 — Android app (`delivery-app/`)
See `delivery-app/README.md`. React Native 0.77.2 + TypeScript (old architecture) with a native Kotlin layer:
- **Native layer:** a foreground location service (type `location`, while-in-use permission only, disk queue, stops on server `tracking:false`), Keystore-encrypted session storage, Google Maps hand-off, dialer, and an FCM service (active only with `google-services.json`).
- **Screens:** Splash, Login (employee OTP; other roles refused), Home (online toggle, capacity "2 / 3", today's stats, incoming requests with countdown, active orders), full-screen request sheet, Deliveries (multi-order, Google route/ETA from the server or a labelled local suggestion, map, navigate-to-next), Delivery detail (pickup readiness, items, customer with masked number, navigate, OTP, COD cash confirmation, failure with reason), History, Profile (cash in hand, today, theme light/dark/auto, server address, permissions, sign-out), Notifications.
- **Network and errors:** offline banner, reconnect state, skeleton loading, empty states, server error messages mapped to plain words.
- **Checks:** `tsc --noEmit` 0 errors; ESLint 0 problems; Jest 6/6 (route suggestion: pickup first, freshness, never an ETA; polyline decode; distances).

## Backend additions in this round
- COD policy + collection workflow: see `03-phase2-review-and-cod-policy.md`.
- `POST /api/delivery/me/route` (`services/routeService.js`): Google Routes API with the server key `GOOGLE_ROUTES_API_KEY`. The pickup stays first; drops are optimised by Google. With no key or an error it returns `available:false` and the stops; never an invented ETA. Rate-limited (6/min).
- `scripts/localSandbox.js`: an isolated local backend. In-memory MongoDB replica set on 127.0.0.1 (refuses anything else), console OTP, dummy Firebase, PhonePe/Twilio/Cloudinary blanked, seeded demo data.

## Phase 6 — Integration & QA

| Suite | Result |
|---|---|
| `test/delivery.test.js` (pure rules) | 15/15 |
| `test/deliveryFlow.test.js` (service on in-memory fake: broadcast, 2- and 8-way races, capacity, multi-order, OTP, GPS privacy, tracking, tick, admin, **COD**) | 35/35 |
| `test/deliveryCheckout.test.js` (COD default, PhonePe optional, all-off refusal, takeaway unchanged) | 13/13 |
| `test/deliveryRoute.test.js` (route planner, fake HTTP) | 4/4 |
| **`test/deliveryReplSet.test.js` — real MongoDB 7 replica set** (10-rider race, capacity race, unique indexes, COD end to end with a double-tap, rollback, append-only audit, tick) | 7/7 (repeated) |
| **`test/e2e/deliveryE2E.mjs` — real HTTP + Socket.IO against the sandbox** (the 14-step business flow below) | 16/16 |
| Full backend suite | 66 of 69 suites pass; the 3 failures are pre-existing (identical on clean `HEAD`) |
| admin / customer builds | ✓ / ✓ |
| delivery-app tsc / eslint / jest | ✓ / ✓ / 6/6 |

**Business flow verified end to end (e2e):** admin registers 2 riders (duplicate phone refused); riders log in (rider tokens refused on staff endpoints); they go online; checkout offers COD by default; the customer places a COD Home Delivery order (outside the range is refused); confirm broadcasts to **both** riders with no customer data; **simultaneous accept gives one winner, and the other gets `delivery:already_assigned`**; the customer gets the code + link (the public link shows neither the code nor phones); **pickup is blocked until READY**; the customer tracks live with only the link (a tampered link joins nothing); a wrong OTP is refused; COD needs the exact amount, then DELIVERED + one cash record (a replay is refused); GPS stops once nothing is active; the order is DELIVERED but unpaid; the admin sees COD + full audit history, verifies, and the order is **PAID, SETTLED, COMPLETED** through the existing billing; an offline rider gets no request; reassignment goes back to the broadcast; idempotent order placement.

**Also covered by automated tests:** capacity limits, multiple active orders, reassignment, offline riders, GPS interruptions (offline queue / batch validation / out-of-order and impossible points), expired offers and re-broadcast and escalation, duplicate requests (idempotency keys, double-tapped hand-over, double verify), failed network (client: offline banner + queued GPS; server: atomic writes).

**Not automatable here (manual on a device):** real GPS movement while the app is backgrounded, FCM delivery (needs `google-services.json`), Google Maps tiles (needs keys), behaviour after phone sleep and battery optimisation.
