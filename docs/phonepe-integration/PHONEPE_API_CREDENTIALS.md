# PhonePe API Credentials & Endpoints

All V2 details below come from PhonePe's official developer documentation (read 2026-11-20). Source pages are listed at the end. Where the docs were silent, it is marked **Not stated**. Nothing is invented.

> **Never** paste real credentials into this file, tickets or chat. They belong only in `restaurant-server/.env` on the server. The Client Secret / Salt Key is in the same category as `JWT_SECRET`.

---

## 1. What the existing code needs today (V1, salt key)

| Env var | Value | Notes |
|---|---|---|
| `PHONEPE_MERCHANT_ID` | Merchant ID | Required |
| `PHONEPE_SALT_KEY` | Salt key | Required, **secret** |
| `PHONEPE_SALT_INDEX` | Usually `1` | Default `1` |
| `PHONEPE_ENV` | `SANDBOX` or `PRODUCTION` | ⚠ Must be exactly `PRODUCTION` for live. `PROD` silently uses the sandbox (defect D1) |
| `PUBLIC_API_URL` | e.g. `https://api.<domain>` | Builds `…/api/payments/phonepe/callback` |
| `CLIENT_URL` | Customer app URL | Builds the return URL `…/order/:id?payment=phonepe` |

Hosts hard-coded in `paymentService.js`:
- Sandbox: `https://api-preprod.phonepe.com/apis/pg-sandbox`
- Production: `https://api.phonepe.com/apis/hermes`

V1 endpoints used: `POST /pg/v1/pay`, `GET /pg/v1/status/{merchantId}/{merchantTransactionId}`. The V2 developer docs no longer document these. PhonePe's FAQ calls salt key/salt index "older keys" and tells merchants to request PG V2 keys.

---

## 2. V2 Standard Checkout — credentials

| Credential | Where | Notes |
|---|---|---|
| **Client ID** | Business Dashboard → Developer Settings | "shared by PhonePe PG" |
| **Client Secret** | Business Dashboard → Developer Settings | Secret |
| **Client Version** | Issued with the above | Sent in the token request |
| **Merchant ID** | Merchant account | Used by the SDK / Test App and the `X-MERCHANT-ID` header (partner integrations) |
| Webhook **Username / Password** | Business Dashboard → Developer Settings → Webhook → Create Webhook | Chosen by the merchant |

**Test Mode** toggle in the dashboard: ON = UAT/Sandbox credentials, OFF = Production credentials.

Proposed env vars (not created; for later approval):
```
PHONEPE_API_VERSION=V2
PHONEPE_ENV=SANDBOX            # or PRODUCTION
PHONEPE_MERCHANT_ID=
PHONEPE_CLIENT_ID=
PHONEPE_CLIENT_SECRET=
PHONEPE_CLIENT_VERSION=
PHONEPE_WEBHOOK_USERNAME=
PHONEPE_WEBHOOK_PASSWORD=
PUBLIC_API_URL=
CLIENT_URL=
```

---

## 3. V2 — OAuth token

| | Sandbox (UAT) | Production |
|---|---|---|
| URL | `POST https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token` | `POST https://api.phonepe.com/apis/identity-manager/v1/oauth/token` |

- `Content-Type: application/x-www-form-urlencoded`
- Body: `client_id`, `client_version`, `client_secret`, `grant_type=client_credentials`
- Response: `access_token`, `encrypted_access_token`, `expires_in`, `issued_at`, `expires_at` (epoch), `session_expires_at`, `token_type` (`O-Bearer`)
- Use on every later call: `Authorization: O-Bearer <access_token>`
- **Cache the token.** Regenerate based on `expires_at` (e.g. 3–5 min before expiry). Don't request a token per API call (UAT checklist).

## 4. V2 — Create payment

| | Sandbox | Production |
|---|---|---|
| URL | `POST https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/pay` | `POST https://api.phonepe.com/apis/pg/checkout/v2/pay` |

Headers: `Content-Type: application/json`, `Authorization: O-Bearer <token>`

| Field | Type | Rule |
|---|---|---|
| `merchantOrderId` | String, required | Max 63 chars; only `_` and `-` as special chars; unique |
| `amount` | Long, required | **Paise**, minimum 100 (₹1) |
| `expireAfter` | Long, optional | Seconds, 300–3600 |
| `metaInfo.udf1…udf15` | Optional | Exact key names only |
| `paymentFlow.type` | Required | `PG_CHECKOUT` |
| `paymentFlow.merchantUrls.redirectUrl` | Required | Where the user lands after paying |
| `prefillUserLoginDetails.phoneNumber` | Optional | Prefill |

Response: `orderId`, `state` (`PENDING`), `expireAt`, `redirectUrl`. **Use `redirectUrl` exactly as received.**
Errors: `BAD_REQUEST` if `merchantOrderId` already exists and isn't in CREATED state; `INTERNAL_SERVER_ERROR`.

## 5. V2 — Order status

| | Sandbox | Production |
|---|---|---|
| URL | `GET https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/order/{merchantOrderId}/status` | `GET https://api.phonepe.com/apis/pg/checkout/v2/order/{merchantOrderId}/status` |

- Query: `details` (true = all attempts), `errorContext` (true = error block on FAILED)
- **Root-level `state`** decides the outcome: `PENDING | COMPLETED | FAILED`
- Also returns: `orderId`, `amount`, `payableAmount`, `feeAmount`, `expireAt`, `errorCode`, `detailedErrorCode`, `paymentDetails[]` (`paymentMode`, `transactionId`, `amount`, `state`, `rail`, `instrument`, …)
- Unknown id: `INVALID_MERCHANT_ORDER_ID`
- Required PENDING polling schedule (UAT checklist): first check 20–25 s after initiation → every 3 s for 30 s → 6 s for 60 s → 10 s for 60 s → 30 s for 60 s → every 1 min until terminal state or `expireAfter`.

## 6. V2 — Webhook

- Configure: Business Dashboard → Developer Settings → **Webhook** → Create Webhook (Test Mode ON for sandbox). For UAT, the webhook URL is shared with the PhonePe integration team.
- Auth options:
  - **SHA (username/password):** PhonePe sends `Authorization: SHA256(username:password)`. The docs don't state hex vs base64 encoding, so confirm in UAT.
  - **HMAC:** checksum key id + signature headers, computed over the **raw payload**.
- Events: `checkout.order.completed`, `checkout.order.failed`, `pg.refund.completed`, `pg.refund.failed`
- Payload: `{ "event": "...", "payload": { orderId, merchantId, merchantOrderId, state, amount, expireAt, paymentDetails[], metaInfo } }`
- Rules from the docs: use `event` to identify the event (the `type` field is deprecated); use root `payload.state` for status; expect duplicates; return 2xx within 3–5 s; HTTPS only; don't deserialize strictly. **If the auth header doesn't match, discard the webhook and call Order Status.** If no webhook arrives, call Order Status.
- PhonePe publishes source IPs/CIDRs for optional allow-listing (e.g. `103.116.33.8/30`, `103.116.34.16/29`, `103.116.32.16/29`, `103.116.33.136/30`). Re-check the live page before configuring a firewall.

## 7. V2 — Refund

| | Sandbox | Production |
|---|---|---|
| Initiate | `POST https://api-preprod.phonepe.com/apis/pg-sandbox/payments/v2/refund` | `POST https://api.phonepe.com/apis/pg/payments/v2/refund` |
| Status | `GET …/pg-sandbox/payments/v2/refund/{merchantRefundId}/status` | `GET https://api.phonepe.com/apis/pg/payments/v2/refund/{merchantRefundId}/status` |

Body: `merchantRefundId` (unique, max 63), `originalMerchantOrderId`, `amount` (paise, min 100, ≤ original).
Response: `refundId`, `amount`, `state` (`PENDING`). States: `PENDING`, `CONFIRMED` (in progress), `COMPLETED`, `FAILED`.
Rules: poll status until COMPLETED/FAILED; no second refund while one is PENDING/CONFIRMED; retry a FAILED refund with a **new** `merchantRefundId`.

## 8. Sandbox testing aids

- PhonePe Test App (Android `com.phonepe.simulator`; iOS via the integration team) simulates Success / Failure / Pending.
- Test cards and OTP `123456` are published on the UAT Sandbox page. Use the values from the live page.

## 9. Official SDK

PhonePe publishes a **Node.js backend SDK (v2.0.5, Node ≥ 14)**. The npm package name wasn't confirmed from the docs page that was read. CLAUDE.md asks for minimal dependencies, so the recommendation is a **direct REST implementation** inside `paymentService.js` (about 4 calls), not adding the SDK. That decision is the project owner's.

---

## Sources (official)

- Authorization: https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/authorization
- Create payment: https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/create-payment/initiate-payment
- Order status: https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/order-status
- Webhook: https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/webhook
- Refund: https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/refund
- Integration steps: https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/integration-steps
- UAT sandbox: https://developer.phonepe.com/payment-gateway/uat-testing-go-live/uat-sandbox
- UAT checklist: https://developer.phonepe.com/payment-gateway/uat-testing-go-live/uat-checklist
- Go-live: https://developer.phonepe.com/payment-gateway/uat-testing-go-live/go-live
- FAQs (V1 vs V2 keys): https://developer.phonepe.com/payment-gateway/general-faqs
- Node SDK: https://developer.phonepe.com/payment-gateway/backend-sdk/nodejs-be-sdk/introduction
