# Integration Gap Analysis

Compares what exists (PhonePe PG **V1**, salt key) with what is needed for a new merchant on **Standard Checkout V2** and a clean go-live. Nothing here has been implemented. Everything waits for approval.

---

## 1. Gap table

| # | Area | Current | Needed | Effort | Priority |
|---|---|---|---|---|---|
| G1 | API version / auth | V1 `X-VERIFY` salt-key signing | V2 OAuth `client_credentials` token, cached by `expires_at`, `O-Bearer` header | M | **Blocker** (if V2 keys issued) |
| G2 | Create payment | `POST /pg/v1/pay` (base64 body, `PAY_PAGE`, per-request `callbackUrl`) | `POST /checkout/v2/pay` (JSON, `merchantOrderId`, `PG_CHECKOUT`, `merchantUrls.redirectUrl`, `expireAfter`) | S | **Blocker** |
| G3 | Status check | `GET /pg/v1/status/{mid}/{txn}`, `code` values | `GET /checkout/v2/order/{merchantOrderId}/status`, root `state` COMPLETED/FAILED/PENDING | S | **Blocker** |
| G4 | Webhook | `{response: base64}` + `X-VERIFY` | `{event, payload}`, `Authorization: SHA256(username:password)` checked in constant time; on mismatch discard + call Order Status; ack 2xx fast | M | **Blocker** |
| G5 | Callback URL registration | Sent in each `/pay` request | Configured in the Business Dashboard (prod) / shared with the integration team (UAT) | Config | **Blocker** |
| G6 | Env selection bug (D1) | `PROD` silently means sandbox; checker expects `PROD` | Accept one canonical value (`PRODUCTION`, plus `PROD` as an alias) in both `paymentService.js` and `securityCheck.js`; fail loudly on unknown values | XS | **Blocker** |
| G7 | Amount verification (D2) | Reported amount ignored | Mark PAID only if the gateway amount equals `order.payment.amount`; otherwise flag for review | XS | High |
| G8 | Reconciliation (D4) | Background tick covers `AWAITING_PAYMENT` only | Tick also re-checks any order with `payment.state = PENDING` on PhonePe's back-off schedule until terminal/expiry | S | High |
| G9 | Customer return polling (D6) | 6 × 2.5 s | Keep the instant check on return, then follow PhonePe's schedule server-side (G8); the UI shows "Payment pending" | S | Medium |
| G10 | Refunds (D3) | `console.warn` only | `POST /payments/v2/refund` + status polling + `pg.refund.*` webhook; refund record on the order; admin "Refund" action (admin/manager only); automatic refund **or** admin alert for "paid after cancelled" | M | High (UAT checklist treats refund as mandatory if offered) |
| G11 | Admin re-check (D5) | None | `POST /admin/orders/:id/payment/phonepe-recheck` (requireManagement) → `fetchPhonePeStatus` → `applyPhonePeResult` | XS | Medium |
| G12 | Webhook IP allow-list | None | Optional defence in depth, using PhonePe's published CIDRs | XS | Low |
| G13 | Policy pages | None in customer app | Terms, Privacy, Refund & Cancellation, Contact pages (static) | S | **Blocker for PG approval** |
| G14 | Tests | V1 signing/decoding tests; `payFirst.test.js` 1 stale failure (dining-radius location missing in fixture) | Fix fixture; add V2 tests: token caching, webhook auth accept/reject, state mapping, amount mismatch, refund idempotency | S | High |
| G15 | Docs | `CLAUDE.md` "Payment" describes V1 | Update to V2 contract once implemented | XS | Medium |

Effort: XS < ½ day, S ≈ 1 day, M ≈ 2–3 days.

---

## 2. Recommended implementation shape (for approval)

Keep **one** gateway module, as CLAUDE.md requires ("extend `paymentService.js`, don't add a second gateway"):

- Add a `PHONEPE_API_VERSION` switch (`V1` default, so current behaviour is unchanged, or `V2`). Every caller keeps using the same exports: `isPhonePeConfigured`, `initiatePhonePePayment`, `fetchPhonePeStatus`, `applyPhonePeResult`.
- V2 internals:
  - `getAccessToken()`: in-memory cache, refreshed ~5 min before `expires_at`, with a single-flight promise so concurrent requests share one refresh.
  - `merchantOrderId` = the per-attempt id (reuse the existing `payment.merchantTransactionId` field, ≤ 63 chars). No schema change needed.
  - Map V2 `state` → internal `SUCCESS/PENDING/FAILED`. Unknown → FAILED, never SUCCESS (same as today).
  - `applyPhonePeResult` stays the single atomic writer. Add the amount-equality guard (G7).
- New route `POST /api/payments/phonepe/webhook` (V2). Keep the V1 `/callback` route while V1 is in use. The webhook verifies the `Authorization` header in constant time. Even on a valid webhook, **confirm with an Order Status call before marking PAID** (cheap, and it removes any trust in the payload).
- Refunds: a new `refundService` path inside `paymentService.js` with a `Refund` sub-document or collection, unique on `merchantRefundId`, and atomic state transitions, following the KOTJob idempotency pattern.

## 3. What does NOT need to change

- Order state machine, pay-first flow, `promotePaidOrder`, `expireUnpaidOrders`
- Socket rooms / events (`emitPaymentStatusChanged`, `emitPayFirstPromoted`)
- Customer app pages, apart from optional "pending" copy and policy links
- Admin invoices / reports (`payment.phonepeTransactionId` keeps the same field, filled from `paymentDetails[0].transactionId`)
- Print service: no change at all

## 4. Risks

| Risk | Mitigation |
|---|---|
| Client is issued V1 keys after all | The V1 path stays and works once G6/G7 are fixed |
| Webhook header encoding (hex vs base64) not specified in the docs | Verify during UAT with a real sandbox webhook before writing the comparison |
| Paid-after-cancel money with no refund | G10, and until then an admin alert |
| Redirect domain not whitelisted → "Internal Security Block" | Share the exact `CLIENT_URL` domain during onboarding (FAQ) |
