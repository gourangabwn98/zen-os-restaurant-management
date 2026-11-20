# PhonePe Integration — Existing Implementation Audit

**Project:** Hotel KHOAI – Zen OS Restaurant Management System
**Branch audited:** `features/offline-edition`
**Date:** 2026-11-20
**Scope:** read-only audit. No application code, `.env`, dependency or Git state was changed.

---

## 1. Summary

| Question | Answer |
|---|---|
| Is PhonePe already implemented? | **Yes.** Backend, customer app and admin reporting are all in place. |
| API version used | **PhonePe PG v1** — hosted `PAY_PAGE` checkout (`/pg/v1/pay`, `/pg/v1/status`). |
| Auth scheme | **Legacy Salt Key + `X-VERIFY` checksum** (`sha256(payload + path + saltKey) + "###" + saltIndex`). |
| Standard Checkout v2 (OAuth)? | **No.** No `client_id` / `client_secret` / `O-Bearer` token anywhere in the code. |
| Credentials required by the code | `PHONEPE_MERCHANT_ID`, `PHONEPE_SALT_KEY`, `PHONEPE_SALT_INDEX`, `PHONEPE_ENV`, plus `PUBLIC_API_URL` and `CLIENT_URL`. |
| Is it switched on today? | **No.** The real backend `.env` has no `PHONEPE_*` values (values were not printed), so `isPhonePeConfigured()` is `false`. Customers get the UPI deep link or cash. |
| Will it work with a new PhonePe merchant account? | **Probably not as-is.** PhonePe's own FAQ calls salt key / salt index "older keys" and tells merchants to ask for PG V2 keys. A new merchant will most likely receive **v2 credentials**, which this code can't use. See §6. |

---

## 2. Files inspected

| Layer | File | Role |
|---|---|---|
| Gateway client | `restaurant-server/services/paymentService.js` | Signing, `/pg/v1/pay`, `/pg/v1/status`, callback decode/verify, atomic `applyPhonePeResult` |
| HTTP | `restaurant-server/controllers/paymentController.js` | `initiatePhonePe`, `phonePeOrderStatus`, `phonePeCallback` |
| Routes | `restaurant-server/routes/paymentRoutes.js` | `/api/payments/phonepe/{initiate,status/:orderId,callback}` |
| Pay-first glue | `restaurant-server/services/payFirstService.js` | Promotes paid `AWAITING_PAYMENT` orders; expires unpaid ones after a last live status check |
| Background tick | `restaurant-server/server.js` (`startPayFirstTick`) | Runs `runPayFirstTick` periodically |
| Payment rules | `restaurant-server/utils/paymentMode.js` | `effectivePaymentMode`, `isPayFirst`, `resolveCustomerPaymentMethod` |
| Delivery rules | `restaurant-server/utils/delivery.js` | `deliveryPaymentOptions` (online only when PhonePe configured) |
| Model | `restaurant-server/config/getModels.js` | `Order.payment` sub-doc, `paymentDeadline`, index on `payment.merchantTransactionId` |
| Profile | `controllers/profileController.js`, `routes/profileRoutes.js` | Exposes derived boolean `phonePeEnabled` only (no secrets) |
| Config check | `restaurant-server/config/securityCheck.js` | Start-up warnings for half-configured PhonePe |
| Env template | `restaurant-server/.env.example` | Documents `PHONEPE_*`, `PUBLIC_API_URL` |
| Customer app | `customer/src/services/paymentService.js`, `pages/CartPage.jsx`, `pages/OrderDetailPage.jsx` | Start payment, redirect, poll on return |
| Admin app | `admin/src/pages/admin/ProfilePage.jsx`, `invoices/InvoiceDrawer.jsx`, `invoices/reports.js` | Gateway on/off status, PhonePe txn id on invoice, "Gateway ref." column in reports |
| Reports | `restaurant-server/services/staffReportService.js` | "Online gateway (PhonePe)" row for verified payments |
| Tests | `test/paymentLogic.test.js`, `test/paymentBeforeComplete.test.js`, `test/splitPayment.test.js`, `test/payFirst.test.js`, `test/securityCheck.test.js` | |

---

## 3. How the current flow works (v1)

1. Customer picks **Online** in the cart. With `paymentMode` ONLINE/BOTH **and** PhonePe configured, the order is created as **`AWAITING_PAYMENT`** with a `paymentDeadline` (pay-first). Waiters and the kitchen can't see it yet.
2. Customer app calls `POST /api/payments/phonepe/initiate { orderId }` (guest token or JWT; `assertCanViewOrder`).
3. Backend computes the amount **from `order.total`** (paise), creates a per-attempt `merchantTransactionId`, signs the request with `X-VERIFY` and calls `POST {host}/pg/v1/pay` with `paymentInstrument.type = PAY_PAGE`.
4. The backend stores `order.payment = { provider: PHONEPE, merchantTransactionId, amount, state: PENDING }` and returns PhonePe's hosted URL. The browser is redirected there.
5. PhonePe reports the result in two ways:
   - **Callback** `POST /api/payments/phonepe/callback`. No JWT. Accepted only if `X-VERIFY` matches `sha256(base64 + saltKey)###index`, checked with a constant-time compare.
   - **Status query.** On return to `/order/:id?payment=phonepe`, the customer app polls `GET /api/payments/phonepe/status/:orderId` (6 tries, 2.5 s apart). Each poll makes the backend run a signed `GET /pg/v1/status/{merchantId}/{txnId}`.
6. `applyPhonePeResult` is an **atomic conditional `findOneAndUpdate`** (`payment.state != SUCCESS → SUCCESS`, setting `paymentStatus: PAID`, `paymentMethod: Online`, `paidBy: null`, `paidAt`). Callback and poll can race safely.
7. `afterPaymentApplied` → `promotePaidOrder`: `AWAITING_PAYMENT → PENDING_CONFIRMATION` (role `system`). Socket events go out: `emitPaymentStatusChanged` and `emitPayFirstPromoted`. Staff now see the order.
8. The background tick promotes paid orders that got stuck and cancels unpaid ones at the deadline. It does **one last live PhonePe check** first, and attempts still in flight get a 10-minute grace period.

---

## 4. What already works (verified by reading code + tests)

| Feature | Status |
|---|---|
| Server-side amount (never from the client) | ✅ |
| Hosted checkout redirect | ✅ |
| Callback signature verification, constant-time | ✅ |
| Status-query verification on return | ✅ |
| Atomic, idempotent "mark PAID"; a FAILED result can't un-pay an order | ✅ (tested) |
| A FAILED attempt leaves `paymentStatus` at `PENDING_VERIFICATION`, so retry/cash still work | ✅ (tested) |
| Pay-first `AWAITING_PAYMENT` state, hidden from staff/kitchen until paid | ✅ (tested) |
| Auto-cancel of unpaid orders, with a last live check and in-flight grace | ✅ (tested) |
| Retry payment from the order page | ✅ |
| Delivery orders: online payment only when PhonePe is configured | ✅ |
| Admin profile shows gateway On/Off; blocks "ONLINE only" if PhonePe is off | ✅ |
| Invoice shows the PhonePe transaction id; reports include "Gateway ref." | ✅ |
| Staff report "Online gateway (PhonePe)" row | ✅ |
| Secrets kept out of `RestaurantProfile` and out of API responses | ✅ |

### Test run (2026-11-20)

| Suite | Result |
|---|---|
| `paymentLogic.test.js` | 15 passed, 0 failed |
| `paymentBeforeComplete.test.js` | 10 passed, 0 failed |
| `splitPayment.test.js` | 8 passed, 0 failed |
| `payFirst.test.js` | **13 passed, 1 failed.** The failing test is "pay-first dine-in order does NOT open/join the table session until paid". It throws *"A valid device location is required to place a dine-in order"* from `utils/diningRadius.js`: the test fixture doesn't send a device location, a check added later. This is a **stale test fixture, not a PhonePe defect**, but it needs fixing so the suite is green before go-live. |

---

## 5. Defects and incomplete features found

| # | Severity | Finding |
|---|---|---|
| D1 | **High (go-live blocker)** | **`PHONEPE_ENV` value mismatch.** `paymentService.js` knows only `SANDBOX` / `PRODUCTION`, and anything else **silently falls back to SANDBOX**. `securityCheck.js` warns unless the value is `PROD`. Setting `PROD` (as the warning suggests) sends real customers to the **sandbox** host. Setting `PRODUCTION` works, but you get a false warning on every start. |
| D2 | Medium | **Amount not cross-checked on success.** `decodeCallback` / `fetchPhonePeStatus` read the `amount` PhonePe reports, but `applyPhonePeResult` never compares it with `order.payment.amount`. Best practice (and a v2 UAT expectation) is to accept SUCCESS only when the amount matches. |
| D3 | Medium | **No refund API.** A payment that arrives after the order was auto-cancelled only logs `console.warn("... refund needed")`. No refund call, no admin alert, no refund record. PhonePe's v2 UAT checklist treats refund + refund status as mandatory if refunds are part of the flow. |
| D4 | Medium | **No reconciliation for non-pay-first PhonePe payments.** For an order that is *already confirmed* and paid later from the order page, the only paths to PAID are the callback and the customer's 15-second poll. If the callback is lost and the customer closes the page, nothing re-checks it; the background tick only covers `AWAITING_PAYMENT`. |
| D5 | Low | **No admin "re-check payment" action.** `CLAUDE.md` mentions an "admin re-check", but no admin route calls `fetchPhonePeStatus`. Staff can only mark paid by hand. |
| D6 | Low | **Polling schedule.** The customer app polls 6 × 2.5 s right after return. PhonePe v2's UAT checklist prescribes a specific back-off (first check 20–25 s after initiation, then 3 s/6 s/10 s/30 s/60 s steps until terminal or expiry). |
| D7 | Info | **Callback body parsing.** `express.json()` parses the body before verification. That is fine for v1, because the signature covers the `response` string field. A v2 HMAC webhook would need the **raw body**. The v2 SHA/Basic option doesn't. |
| D8 | Info | `CLAUDE.md` describes the callback as "verifying `X-VERIFY` against the raw body". The code verifies against the parsed `response` field, which is equivalent for v1. The documentation will need updating for v2 either way. |

---

## 6. If the client receives v2 credentials

The `paymentService.js` contract stays the same: verified result only, atomic apply, amount from the server. These parts change:

| Area | v1 (current) | v2 (needed) |
|---|---|---|
| Credentials | Merchant ID, Salt Key, Salt Index | Client ID, Client Secret, Client Version (+ Merchant ID) |
| Auth | `X-VERIFY` checksum per request | OAuth `client_credentials` token → `Authorization: O-Bearer <token>`, cached until `expires_at` |
| Create payment | `POST /pg/v1/pay`, base64 `request` | `POST /checkout/v2/pay`, plain JSON: `merchantOrderId`, `amount`, `expireAfter`, `paymentFlow { type: PG_CHECKOUT, merchantUrls.redirectUrl }` |
| Callback URL | Sent per request (`callbackUrl`) | **Configured once in the PhonePe Business Dashboard** (Webhook tab) |
| Status | `GET /pg/v1/status/{mid}/{txnId}`, codes `PAYMENT_SUCCESS`… | `GET /checkout/v2/order/{merchantOrderId}/status`, `state` = `COMPLETED / FAILED / PENDING` |
| Webhook auth | `X-VERIFY` on base64 body | `Authorization` = SHA256(`username:password`), or HMAC headers |
| Webhook payload | `{ response: <base64> }` | `{ event: "checkout.order.completed" …, payload: { merchantOrderId, state, amount, … } }` |
| Hosts | `pg-sandbox` / `hermes` | Sandbox `…/apis/pg-sandbox`; prod auth `…/apis/identity-manager`, prod APIs `…/apis/pg` |
| Refund | — | `POST /payments/v2/refund`, `GET /payments/v2/refund/{id}/status` |

Full detail: `PHONEPE_API_CREDENTIALS.md` and `INTEGRATION_GAP_ANALYSIS.md`.
