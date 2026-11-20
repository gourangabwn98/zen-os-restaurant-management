# 16 — Security Architecture

No credentials, keys, tokens, phone numbers or private URLs are reproduced. Diagram: [`diagrams/15-auth-flow.mmd`](diagrams/15-auth-flow.mmd). Prior audit: `SECURITY_AUDIT.md` (2026-10-01); status of its items re-checked here.

## 1. Authentication

| Actor | Cloud mode | LOCAL mode | Token |
|---|---|---|---|
| Customer | Firebase phone OTP (client) → `POST /api/auth/firebase-verify` (server `verifyIdToken`) | not possible offline (O3 plans table-guest) | JWT `{id}` 30 d |
| Admin / manager / inventory_manager | Firebase → `POST /api/auth/admin/firebase-login` (verified; user must be admin/manager/inventory_manager), or backend OTP `/admin/send-otp` | phone + PIN on approved device (`/api/local/auth/login`); OTP/Firebase refused | JWT 7 d (Firebase) / 30 d (admin OTP path `generateToken`) ; LOCAL: JWT with `sid` bound to `LocalSession` |
| Waiter / chef / rider | backend SMS OTP (`/employee|waiter/send-otp`, `/verify-otp`) or Firebase (`/employee/firebase-verify`, phone from verified token only) | PIN (riders: OTP still) | JWT 7 d `{id, role, restaurantName}` |
| print-service | `printerKey` (random 24-byte hex, SHA-256 stored) | same | n/a |
| PhonePe callback | `X-VERIFY` checksum | same | n/a |
| Delivery tracking | signed tracking token with version (revocable) | same | n/a |
| Guest order view | `x-guest-order-token` JWT 12 h, purpose-bound | same | n/a |

Sessions: no refresh tokens, no server-side revocation in cloud except `User.status` re-read per request (REST) — **not** on sockets (R-04). Tokens kept in `localStorage` (XSS-exposed). LOCAL sessions are revocable instantly and sockets cut (`disconnectLocalSessions`).

## 2. OTP and PIN handling

* SMS OTP: 6 digits via `Math.random` (not CSPRNG), 5 min, in-process `Map`; send limit 1/30 s & 5/h per phone (`otpGuard`), verify tries capped (`MAX_OTP_TRIES`); provider auto-detect Twilio → MSG91 → console (`utils/sendOTP.js`). `OTP_DEV_ECHO` only outside production (and refused in LOCAL).
* PIN: 6–8 digits, scrypt + `LOCAL_PIN_PEPPER`, constant-time verify, lockout escalation, forced change when set by someone else, append-only `LocalAuthEvent` (`utils/localPin.js`, `localAuthService.js`).
* Device auth (LOCAL): 128-bit device id + 256-bit secret (SHA-256 stored), pairing code, admin/manager approval, per-role allow-list, TTL for pending.

## 3. Authorization

* REST: `requireRole` family (see [06 §11](06-backend-architecture.md#11-authentication--role-permissions)); `isAdmin` flag dominates; manager scope guards; waiter duty gate.
* Domain: `TRANSITION_ROLES`, `PAYMENT_STATUS_ROLES`, chef/rider blocked from placing orders, customer cancel limits, guest token or ownership for order view (`assertCanViewOrder`).
* Socket: role-derived rooms; chef never in staff room; printer key only in printers room; rider only own user room; order room by ownership/token. **Defect:** legacy full-order emits to the anonymous tenant room (R-02).
* Frontend page filters (`access.js`) are UX only.

## 4. Input validation and injection

`sanitizeInput` strips `$` keys from bodies; Express 5 simple query parser; `objectIdParam`; server-side pricing/amounts everywhere; uploads via multer (Cloudinary) — file-type/size limits per middleware (`uploadMiddleware.js`, `importUploadMiddleware.js`; not exhaustively reviewed — Medium). Regex-based input checks; no schema validator.

## 5. Transport, headers, CORS, rate limiting

| Control | State |
|---|---|
| HTTPS | provided by Render/Vercel in cloud (inferred); **plain HTTP on LAN** in LOCAL until O5 |
| CORS | `origin: "*"` for REST and Socket.IO |
| Security headers (helmet/CSP/HSTS) | ABSENT on API; frontends rely on Vercel defaults (`vercel.json` sets only cache headers for customer) |
| Rate limiting | only `/api/delivery/*` (in-memory), OTP send guard, LOCAL DB-backed `LocalRateLimit` |
| `trust proxy` | not set (rate-limit by `req.ip` sees the proxy IP behind Render — only affects `/delivery/track`) |

## 6. Secrets management

* Backend `.env` names (values never committed in `.env`): `MONGO_URI`, `JWT_SECRET`, `FIREBASE_*`, `CLOUDINARY_*`, `TWILIO_*`, `MSG91_*`, `PHONEPE_*`, `PUBLIC_API_URL`, `GOOGLE_ROUTES_API_KEY`, LOCAL: `LOCAL_PIN_PEPPER`, `LOCAL_SITE_ID`.
* Startup checks: `securityCheck.js` (fatal without `JWT_SECRET`, warnings for weak secret, missing SMS/Firebase/TZ, PhonePe half-config or sandbox in prod), `localModeCheck.js`.
* **Leak:** print-service `.env` with `PRINTER_KEY` inside two committed zip archives (R-01, Critical). Frontend Firebase web config and Maps keys are public by nature (restrict by referrer in Google console — UNKNOWN whether done).
* `SECURITY_AUDIT.md` itself is committed (contains exploit descriptions).

## 7. Data isolation and PII

Single restaurant per database (tenant key = DB name). PII: customer phone/name on orders, addresses, staff HR (only last-4 of ID proof), rider GPS (stored only while active, TTL 7 d). Kitchen payloads stripped; tracking pages carry no OTP/phones; KOT paper carries customer name/phone; print queue file on PC keeps PII (and was committed — R-01). No data-retention policy for orders/customers (ABSENT).

## 8. Payment security
See [12 §3](12-order-and-payment-lifecycle.md#security-properties-verified). Strong: verified-only, constant-time checksum, amount match, atomic final states, fail-closed env parsing. Gaps: no refunds, no webhook IP allow-list, single attempt record per order.

## 9. Offline-device security (LOCAL)
LAN-only routes by socket address; bootstrap loopback-only; device approval; PIN lockout; immediate revocation. Gaps: HTTP on Wi-Fi (O5), any device on the private ranges can attempt registration (rate-limited), pepper loss recovery tool absent.

## 10. Audit logs

Order `statusHistory` + actor fields; `DutyHistory` (append-only); `DeliveryEvent` (append-only); `LocalAuthEvent` (append-only); `StockLedger` (append-only by convention); `InventoryV3Audit`. ABSENT: admin settings change log, payment status undo log beyond statusHistory, login audit in cloud mode.

## 11. Status of the 2026-10-01 audit items

| ID | Item | Now |
|---|---|---|
| C1 | admin login without token verification | Fixed |
| C2 | PII to anonymous sockets | **Open** (R-02) |
| H1 | NoSQL injection | Mitigated (`sanitizeInput`) |
| H2 | OTP brute force | Partial (send + verify caps in memory; no global limiter) |
| H3 | OTP echo | Fixed |
| H5 | `POST /invoices/generate` | Partial (now staff-only) |
| H6 | `/api/test-whatsapp/:phone` | **Open** (R-03) |
| L8/L9 | helmet / CORS allow-list | Open |

## 12. Security assessment

Business-logic security (pricing, state machine, payment application, idempotency, RBAC) is strong and consistently implemented. Platform hygiene is weak: committed printer key and PII, anonymous socket leak, unauthenticated test endpoint, wildcard CORS, no headers/limits, long-lived tokens in localStorage, no CI security gates. Priority fixes: R-01, R-02, R-03, R-04 (all small changes).
