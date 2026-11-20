# PhonePe Standard Checkout V2 — Implementation Plan (NOT implemented)

**Status:** plan only. Per Phase 1 scope, V2 is not built until the items in §1 are verified against current official docs and real UAT credentials.
**Rule kept from CLAUDE.md:** one gateway module (`services/paymentService.js`), verified result only, atomic apply, amount from the server, and no new dependencies without approval.

---

## 1. Verification status (official docs, read 2026-11-20)

| Item | Status | Notes |
|---|---|---|
| Credentials: Client ID, Client Secret, Client Version (+ Merchant ID) | ✅ Documented | Business Dashboard → Developer Settings; Test Mode toggle = UAT |
| OAuth token URL, sandbox `…/apis/pg-sandbox/v1/oauth/token` | ✅ Documented | form-urlencoded, `grant_type=client_credentials` |
| OAuth token URL, prod `…/apis/identity-manager/v1/oauth/token` | ✅ Documented | |
| `Authorization: O-Bearer <token>`; refresh by `expires_at` | ✅ Documented | Don't fetch a token per call |
| Create payment `POST …/checkout/v2/pay` (sandbox `pg-sandbox`, prod `pg`) | ✅ Documented | `merchantOrderId`, `amount` (paise, ≥100), `expireAfter` 300–3600, `paymentFlow{type:PG_CHECKOUT, merchantUrls.redirectUrl}` |
| Order status `GET …/checkout/v2/order/{merchantOrderId}/status` | ✅ Documented | Root `state`: PENDING / COMPLETED / FAILED |
| Webhook events and payload shape | ✅ Documented | `checkout.order.completed/failed`, `pg.refund.completed/failed`; `{event, payload}` |
| Webhook auth: `Authorization = SHA256(username:password)` | ⚠️ **Encoding not stated** | Hex vs base64, and any prefix, must be confirmed with a real UAT webhook before writing the compare |
| Webhook HMAC option, header names | ⚠️ **Inconsistent on the page** | `x-phonepe-checksum-key-id` / `(x-)phonepe-checksum-signature`. Use SHA/Basic unless PhonePe says otherwise |
| `X-MERCHANT-ID` header | ⚠️ Partners only per docs | Confirm whether a direct merchant needs it |
| Refund `POST …/payments/v2/refund`, status `GET …/refund/{id}/status` | ✅ Documented | |
| Polling schedule for PENDING | ✅ Documented (UAT checklist) | 20–25 s, then 3 s ×30 s, 6 s ×60 s, 10 s ×60 s, 30 s ×60 s, then 1 min |
| Node SDK package name | ❌ Not confirmed | Not needed; plan uses plain REST through the existing `axios` |
| Whether the client is issued V1 or V2 keys | ❌ Unknown | Depends on PhonePe onboarding |

**Gate:** start coding V2 only after (a) PhonePe issues UAT V2 credentials, and (b) one real UAT webhook has been captured to settle the ⚠️ rows.

---

## 2. Configuration (proposed; `.env` not changed)

```
PHONEPE_API_VERSION=V1          # V1 (default, current behaviour) | V2
PHONEPE_ENV=SANDBOX             # parsed by utils/phonePeEnv.js (Phase 1)
# V1
PHONEPE_MERCHANT_ID=  PHONEPE_SALT_KEY=  PHONEPE_SALT_INDEX=1
# V2
PHONEPE_CLIENT_ID=  PHONEPE_CLIENT_SECRET=  PHONEPE_CLIENT_VERSION=
PHONEPE_WEBHOOK_USERNAME=  PHONEPE_WEBHOOK_PASSWORD=
```
`isPhonePeConfigured()` checks the credential set for the selected version. `securityCheck.js` gets matching "half-configured" warnings and never prints a value.

## 3. Code changes (all inside existing modules unless noted)

| Step | Change |
|---|---|
| 1 | `utils/phonePeEnv.js`: add V2 hosts, kept separate from V1's: auth `…/apis/identity-manager` (prod) / `…/apis/pg-sandbox` (UAT); APIs `…/apis/pg` / `…/apis/pg-sandbox` |
| 2 | `paymentService.js`: `getAccessToken()` with an in-memory cache, refreshed 5 min before `expires_at`, and a single-flight promise so concurrent requests share one refresh. The secret is never logged |
| 3 | `initiatePhonePePayment` (V2 branch): `merchantOrderId` = the existing per-attempt `payment.merchantTransactionId` (≤ 63 chars, `[A-Za-z0-9_-]`), so **no schema change**; `amount` = `expectedAmountPaise(order)`; `expireAfter` matched to the pay-first window (900 s); `redirectUrl` as today; use the returned `redirectUrl` unchanged |
| 4 | `fetchPhonePeStatus` (V2 branch): `GET …/order/{id}/status?details=false`; map `COMPLETED→SUCCESS`, `PENDING→PENDING`, else `FAILED`; `amount` from the root; `phonepeTransactionId` from `paymentDetails[0].transactionId` |
| 5 | New route `POST /api/payments/phonepe/webhook` (V2 only; V1 `/callback` stays): constant-time compare of `Authorization`; on mismatch → 401 and ignore. On a valid header, **don't trust the payload**: call `fetchPhonePeStatus` and pass that to `applyPhonePeResult`. Always answer 2xx quickly; do the status call after replying, or within the 3–5 s budget |
| 6 | `applyPhonePeResult`: unchanged. Phase 1's amount guard and final-state rules already cover V2 |
| 7 | Reconciliation (gap G8): `runPayFirstTick` also re-checks any order with `payment.state = PENDING`, not only `AWAITING_PAYMENT`, following the documented back-off (store `payment.nextCheckAt`) |
| 8 | Refunds (gap G10): `initiateRefund({ order, amountPaise, actor })` (admin/manager, `requireManagement`). A `Refund` record unique on `merchantRefundId`; atomic state moves PENDING→CONFIRMED→COMPLETED/FAILED; no second refund while one is open; a FAILED refund retries with a new id. Handles `pg.refund.*` webhooks and status polling. "Paid after cancelled" and `AMOUNT_MISMATCH` orders get an admin alert and a Refund action |
| 9 | Admin "Re-check payment" (gap G11): `POST /admin/orders/:id/payment/phonepe-recheck` → status → apply |
| 10 | Admin visibility of `AMOUNT_MISMATCH`: a badge on the order/invoice and a staff-room socket event |

## 4. Tests to add (plain Node + assert, no network)

- Token: cached, refreshed near expiry, single flight; secret never in errors or logs
- Status mapping: COMPLETED / PENDING / FAILED / unknown → FAILED
- Webhook: valid header accepted; wrong / missing / length-mismatched header rejected; a valid header with a forged payload state still goes through a status re-check
- Request body shape: amount from the order, `PG_CHECKOUT`, no client amount accepted
- Refund idempotency: duplicate webhook / poll, no double refund, FAILED retry gets a new id
- V1 regression: all current V1 tests still pass with `PHONEPE_API_VERSION` unset

## 5. UAT run (with PhonePe Test App)

Success / Failure / Pending simulation, closed browser after paying, duplicate webhook, forged webhook, deadline expiry, full and partial refund, token expiry. Then share the UAT instance with PhonePe for sign-off.

## 6. Estimate

About 4–6 working days for steps 1–10 with tests, plus UAT time with PhonePe. Steps 1–6 (core V2) ≈ 2 days; refunds ≈ 2 days; the rest ≈ 1 day.
