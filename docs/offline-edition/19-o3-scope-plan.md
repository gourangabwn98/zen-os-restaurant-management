# 19 — Phase O3 Plan: LAN customer QR ordering (+ O2 security follow-ups)

Date: 2026-11-20 · Branch: `features/offline-edition` · **PLAN ONLY. Nothing implemented. Waiting for approval.**
Inputs: doc 07 (O3 row), doc 10 (finding 1), doc 06 §4, doc 12 (approved 2026-11-20, option C1 with signed
table tokens), doc 18 §5 (known limits), and a read of the current code.

## 0. Decisions this plan follows (2026-11-20)
1. Doc 12 approved. Staff apps get HTTPS through a restaurant CA (that is O5, not O3). Customer QR ordering may
   run over HTTP, using **signed QR tokens tied to the restaurant and the table** instead of GPS. The server checks
   customer access. A later move to customer HTTPS must not need a token redesign.
2. Existing-data migration goes through a restaurant-scoped export/import package (§7). It is not part of O3.
   No real production data is touched.
3. Plan the `LOCAL_PIN_PEPPER` backup/recovery earlier than O9. Plan self-service PIN change for waiter/kitchen.

## 1. What blocks a customer order on the LAN today (found in the code)
| # | Blocker | Where |
|---|---|---|
| B1 | **Login is required to order.** `placeOrderTx` refuses with 401 when `!req.user`. Customer login is Firebase phone auth, which needs internet | `services/orderService.js:175-179`; customer `CartPage.jsx:177` (`askLogin`) |
| B2 | **Customer dine-in needs GPS**, which browsers block on `http://<PC-IP>` | `orderService.js:221` (place), `:728` (customer edit) → `utils/diningRadius.js`; customer `hooks/useLocationGate.js`, `CartPage.jsx:169` |
| B3 | Table tokens are random hex compared with `===` (not constant-time). They are not tied to the restaurant and have no version, so rotation means a new random value | `controllers/tableController.js:9,126,192,217`; `orderService.js:281`; `orderController.js:93` |
| B4 | No rate limit and no cap on guest orders | `routes/orderRoutes.js:25-27` |

What already works and stays as it is: guest order token (`utils/guestOrderToken.js`, returned as
`guestAccessToken` at `orderService.js:415`) for tracking, editing and cancelling **only that order**, the socket
`join-order`, call-waiter and reviews. Customer orders start at `PENDING_CONFIRMATION` and need a waiter's
`confirmOrderTx`. Prices are set on the server. `Coupon.audience` is checked (guests never get `REGISTERED`).

## 2. O3 scope

### 2.1 Signed table QR tokens (LOCAL only)
* New `utils/tableQrToken.js`. Token = `v1.<ver>.<mac>`, where
  `mac = base64url(HMAC-SHA256(LOCAL_QR_SECRET, "zen-table-qr|v1|<LOCAL_SITE_ID>|<tableNo>|<ver>"))`
  cut to 128 bits. `ver` is a per-table counter (`qrVersion`).
* Verify: parse, then check that `ver === table.qrVersion`, recompute and compare in constant time. An old printed QR
  stops working when the version goes up (Regenerate QR). A QR from another restaurant fails because the site id
  and secret differ.
* The token does not depend on the URL scheme or host. Moving customers to HTTPS later (doc 12 C2) means changing
  `CUSTOMER_FRONTEND_URL` and reprinting. The tokens stay valid.
* `LOCAL_QR_SECRET` is a new `.env` value: ≥32 chars, different from `JWT_SECRET` and `LOCAL_PIN_PEPPER`. In LOCAL
  mode, `localModeCheck.js` refuses to start without it. It goes in the recovery kit (§3.1).
* **Cloud stays the same**: random token with an equality check. One shared helper
  `verifyTableToken({ table, token, mode })` replaces the three inline `===` checks. In cloud mode it compares the
  stored token in constant time, so cloud results do not change.
* **Storage**: the issued token is still stored in `Table.qrToken`. Existing readers (`isQrStale`, staff table list,
  validate route) then keep working. Only `qrVersion` is new. **Open point:** this adds one field to the `Table`
  schema in `config/getModels.js`, which also holds your uncommitted PhonePe changes. I would add only that one
  line and leave the PhonePe hunks alone. The alternative is a side collection, which costs an extra read per order.

### 2.2 LAN guest gate (replaces GPS in LOCAL only)
New `local/guestGate.js` → `assertLanGuestAccess({ req, table, token, settings })`. Every check below must pass:
1. `DEPLOYMENT_MODE` is LOCAL **and** the local setting "Wi-Fi guest ordering" is on.
2. The TCP peer (`req.socket.remoteAddress`, never a header) is in `LOCAL_GUEST_SUBNETS` (CIDR list from the
   installer; default = the private ranges in `local/lanOnly.js`).
3. The table is Active and the signed token checks out (§2.1).
4. Order type is `DINE_IN` (see open question Q1 for takeaway).

Where it is used:
* `placeOrderTx`: if `!req.user` and the gate passes, the order goes ahead as a **table guest**: `user: null`,
  source `CUSTOMER`, `PENDING_CONFIRMATION`, guest name required (2–40 chars), phone optional and unverified. B1
  is relaxed **only** on this path, and `assertWithinDiningRadius` is skipped only there. A logged-in customer
  ordering at a table on the LAN also passes the gate instead of GPS. Cloud code is unchanged
  (`isLocalMode()` false → today's code runs).
* `modifyOrderItemsTx` (`:728`): same rule for a guest editing their own order (guest token **and** gate).
* `quoteOrder`: no change (it is already open to everyone and saves nothing).
* Socket `join-order`: unchanged (the guest token is the auth).

### 2.3 Abuse limits (doc 06 §4)
* Rate limits for guest place/edit (existing `middleware/rateLimit.js`, in memory, one process on the PC):
  10/min per IP and 6/min per table.
* At most **N open `PENDING_CONFIRMATION` guest orders per table** (setting, default 3). Checked in the same
  transaction as the insert, using a count on the indexed `{tableNo, status}`. A waiter confirming or rejecting
  frees a slot.
* Staff get a "Wi-Fi guest" badge on these orders (from existing fields: `source: CUSTOMER` and `user: null`).
  The waiter confirmation step does not change.

### 2.4 Settings (in the database, admin-controlled, LOCAL only)
* New `LocalSiteSetting` single document in `config/localModels.js` (kept out of `getModels.js` and
  `RestaurantProfile`, as O2 did): `guestOrdering.enabled` (default **off**), `guestOrdering.maxPendingPerTable`.
* `GET/PATCH /api/local/settings` (admin only). The public `GET /api/local/guest-context?table=&t=` returns only
  `{ guestOrdering, tableName, tokenValid }`: no secrets, and no token unless the caller already sent it.
* Admin → Devices & PINs gets a "Wi-Fi guest ordering" card (LOCAL only).

### 2.5 Customer app (LOCAL only: `window.__ZEN_CONFIG__.localServer`)
* When `localServer` is set and `guest-context` says the table is valid: skip the location gate for that table. In
  the cart, show a guest-name field instead of "Log in to order". Keep the guest order token (already handled at
  `CartPage.jsx:205`).
* Hide login, push opt-in and coupons limited to registered users on this path. Maps/PhonePe degradation in
  general stays in O4. Payment logic is **not** changed: the PC's `.env` has no `PHONEPE_*`, so
  `resolveCustomerPaymentMethod` already offers only Cash. A test checks that a guest order can never become
  `AWAITING_PAYMENT`.
* Without `localServer` the customer app behaves exactly as now.

### 2.6 Admin → Tables (LOCAL)
* Regenerate QR raises `qrVersion` (old QR dies). "Rebuild link, keep token" stays as it is.
* A one-time "Re-issue all QR codes as signed" action for the cutover, since tables imported from the cloud
  carry random tokens. Until a table has a signed token, a guest at it gets "Ask a waiter", and staff ordering
  still works.

## 3. O2 security follow-ups (proposed to be built inside O3)

### 3.1 Pepper and secret backup/recovery (moved earlier than O9)
A second admin does not help if the pepper is lost, because then **every** PIN fails.
* **Pepper check value.** Store `HMAC(pepper, "zen-pepper-check")` in a local meta document at bootstrap. On boot
  in LOCAL mode, if it doesn't match, the server starts in **recovery-needed** state: login answers
  `PEPPER_MISMATCH` and the console explains what to do. This replaces today's silent "all PINs wrong" and stops a
  pasted wrong `.env` from looking like a brute-force lockout storm.
* **Recovery kit.** A loopback-only admin page plus `scripts/localRecoveryKit.js` export **one encrypted file**
  holding `LOCAL_PIN_PEPPER`, `LOCAL_QR_SECRET`, `JWT_SECRET` and `LOCAL_SITE_ID`. It uses scrypt + AES-256-GCM
  from Node's built-in `crypto` (no new dependency) under a passphrase the owner picks, and is meant for a USB stick
  or a second location. The admin page shows when the last kit was made. A "verify kit" command checks a file
  against the running server without printing any secret. Exporting a kit writes an audit event.
* **Restore**: the script decrypts the kit, then writes the values into `.env` on the PC. It only runs from the
  console, with a confirmation step.
* **Pepper truly lost (no kit)**: `scripts/localRecoveryKit.js reset-pins`, run at the console with the server
  stopped. It sets a new pepper, clears every PIN hash, ends every session and writes a one-time setup code (same
  mechanism as O2 bootstrap). The admin then sets a new PIN at `/setup` from the PC itself and resets staff PINs.
  Devices stay approved, because device secrets don't use the pepper. Audit events are written.
* Backup scheduling and the restore drill stay in O9. The kit format is fixed now so O9 only bundles it.

### 3.2 Self-service PIN change for waiter and kitchen
`POST /api/local/auth/change-pin` already exists (forced first change, admin "My PIN") with lockout. O3 adds a
"Change my PIN" item to the waiter and kitchen menus that reuses the change form from `PinLogin.jsx`. No backend
change except one test.

## 4. Files

New (backend): `utils/tableQrToken.js`, `local/guestGate.js`, `config/localModels.js` (`LocalSiteSetting`,
local meta / pepper check), `services/localSettingsService.js`, `controllers/localSettingsController.js` +
routes in `routes/localAuthRoutes.js` (or a new `routes/localSiteRoutes.js`), `scripts/localRecoveryKit.js`,
tests `test/tableQrToken.test.js`, `test/lanGuestOrder.test.js`, `test/localRecoveryKit.test.js`.

Changed (backend): `services/orderService.js` (two guarded branches in `placeOrderTx` / `modifyOrderItemsTx`, plus
the shared token helper), `controllers/orderController.js` (quote token check → helper),
`controllers/tableController.js` (signed token + `qrVersion` in LOCAL, helper in validate),
`routes/orderRoutes.js` (guest rate limits, active only in LOCAL), `config/getModels.js` (**one field:
`Table.qrVersion`**, see §2.1), `config/localModeCheck.js` (`LOCAL_QR_SECRET`, `LOCAL_GUEST_SUBNETS`),
`services/localAuthService.js` (pepper check at bootstrap/boot), `server.js` (mount routes, recovery-needed boot
state, LOCAL only), `local-edition.env.example`, `test/localBoot.test.js`, `test/deploymentMode.test.js`.

Changed (frontends): customer `CartPage.jsx`, `hooks/useLocationGate.js` / `context/AppState.jsx`,
`hooks/useTableSession.js`, new `services/localGuestService.js`. Admin `DevicesPage.jsx` (settings card,
recovery-kit status) and `TablesPage.jsx` (re-issue action). Waiter/kitchen menu entry + the shared change-PIN form.
**Overlap with uncommitted PhonePe work:** customer `CartPage.jsx` and `OrderDetailPage.jsx`, and backend
`getModels.js`, already carry PhonePe changes. I would edit around those hunks and check with `git diff` that
none of them change.

Not touched: payment services/controllers, `paymentMode.js`, `orderStateMachine.js`, inventory, KOT/print jobs,
print-service, printer settings, socket room design, cloud behaviour, production `.env`, any real database.
No new dependencies.

## 5. Dependencies
* O1 + O2 done (LOCAL mode, `lanOnly.js`, `LOCAL_SITE_ID`, the local models pattern, setup-code mechanism).
* `CUSTOMER_FRONTEND_URL` set to the PC's fixed LAN address (doc 11). Reprinting QRs is a cutover step.
* Not dependent on O5. O3 works on today's HTTP. After O5, staff go to TLS ports and customers keep the HTTP
  listener. O5 then has to make sure staff-only API routes refuse the plain-HTTP listener (noted for O5).
* Real-device checks (QR opens over LAN IP on Android/iOS, guest Wi-Fi isolation) belong to O11, with a quick
  manual check during O3 if a phone is at hand.

## 6. Test plan
Unit/service (plain Node + assert, in-memory replica set as in O2):
* Token: good token passes. Fails on wrong table, wrong site, wrong secret, old version, truncated or bad
  base64, `v2` prefix, timing-safe path taken. Cloud helper gives the same results as the old `===` on the
  existing fixtures.
* Gate: off by default. Off in cloud even if the setting document exists. Peer outside the subnets → 403.
  `X-Forwarded-For` is ignored. Inactive table refused. Takeaway refused (pending Q1).
* Guest order: `PENDING_CONFIRMATION`, `user: null`, guest name required, price from the server (a client price
  is ignored), never `AWAITING_PAYMENT` without PhonePe, a `REGISTERED` coupon is refused, the guest token edits
  only its own order, the per-table cap holds under 5 concurrent placements (exactly N succeed), and the rate
  limits work.
* Regression: existing `orderService` / pay-first / dining-radius / table tests unchanged and passing in cloud
  mode. Logged-in customer in cloud still needs GPS.
* Recovery: kit round-trip, wrong passphrase, tampered file (GCM fails), verify doesn't print secrets, pepper
  mismatch → recovery-needed state, `reset-pins` → old PINs dead, devices kept, one setup code, audit written.
* Change PIN from a waiter session (existing service plus lockout).

Boot / HTTP (`localBoot.test.js`, real `server.js`): guest-context → guest order → waiter confirms over a staff PIN
session → guest socket gets the update. The same token from a non-LAN peer (simulated remote address) is
refused. Cloud boot: `/api/local/settings` absent, guest order still 401.

Builds and browser: `npm run build` for customer, admin, waiter and kitchen. ESLint on changed admin/customer files.
Chrome walkthrough on a throwaway LOCAL server with an in-memory DB: scan URL → menu → cart with guest name → order
→ waiter accepts → customer page updates. Full backend suite: expect the same 2 known pre-existing failures only.

## 7. Data migration package (decision 2): outline only, separate phase "M1"
Recommended as its own phase after O3 (it needs O3's signed-token re-issue for tables).
* Admin-only cloud endpoint builds a **versioned, restaurant-scoped package**: manifest (format version, source
  restaurant id, created-at, counts, SHA-256 per section and overall), plus profile/settings (no secrets),
  menu, sections, add-ons, menu times, tables (no QR tokens; re-issued as signed locally), staff (name, phone,
  role only; **no** PIN hashes, sessions, Firebase ids or tokens), suppliers, inventory items with opening
  balances. Historical orders/financials are a separately selected section, off by default.
* Local import is loopback-only: validate the checksums and format, **preview** (counts, conflicts), then apply in
  one transaction with natural-key upserts (duplicate-safe, re-runnable), and keep an import record with a rollback
  snapshot of the touched collections.
* It is built and tested **only against synthetic fixtures**. Running it against production waits for your
  separate approval.

## 8. Risks
| Risk | Mitigation |
|---|---|
| Guest ordering abused by someone on the Wi-Fi (fake orders) | Waiter confirmation stays mandatory. Signed per-table token, per-table cap, rate limits. Setting off by default |
| Printed QR photographed and used from home | The peer must be on the LAN subnet. The PC is not reachable from outside unless someone port-forwards it (doc 11 warns against that) |
| Guest name/phone readable on shared Wi-Fi (HTTP) | Accepted in decision 1. Phone optional. WPA2/3 recommended. Doc 12 C2 path left open |
| Accidental change to cloud ordering | Every new branch is behind `isLocalMode()`. Cloud regression tests. The cloud token check gives the same results |
| Editing files that carry uncommitted PhonePe work | Edit around those hunks and verify with `git diff` that they did not change |
| Recovery kit becomes the new weak point | Passphrase-encrypted (scrypt + GCM), never stored on the PC, every export audited, verify without printing secrets |
| Wrong `.env` restored → staff locked out | The pepper check value turns that into a clear recovery-needed state instead of lockouts |
| Imported tables still on random tokens | Guests get "ask a waiter" until a re-issue. Staff flow unaffected |

## 9. Open questions for you
* **Q1** Takeaway QR (`?mode=takeaway`) carries no table token. Should Wi-Fi guests be allowed takeaway orders?
  Recommendation: **no** in O3 (dine-in only). Takeaway is placed by staff.
* **Q2** Should a guest give a phone number? Recommendation: **optional** (unverified, used only for staff to call).
* **Q3** OK to add the one `Table.qrVersion` field to `config/getModels.js`, next to the uncommitted PhonePe edits?
* **Q4** Build the §3 follow-ups inside O3 (recommended) or as a separate small phase?

Estimate: about 6–8 developer-days (O3 3–4, signed tokens + settings 1, recovery kit 1.5–2, PIN change 0.5).
