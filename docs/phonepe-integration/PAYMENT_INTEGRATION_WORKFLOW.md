# Payment Integration Workflow (target: PhonePe Standard Checkout V2)

```
Customer scans table QR
      │
      ▼
Customer app (Zen OS)  ── POST /api/orders  ─────────────►  Zen OS Backend
      │                                                      • prices the cart server-side
      │                                                      • order = AWAITING_PAYMENT, paymentDeadline set
      │                                                      • hidden from waiter / kitchen
      │
      │ POST /api/payments/phonepe/initiate {orderId}
      ▼
Zen OS Backend ── OAuth token (cached) ──► PhonePe identity-manager
      │        ── POST /checkout/v2/pay ──► PhonePe PG
      │             amount = order.total (paise), merchantOrderId, redirectUrl
      │◄──────────── { orderId, state: PENDING, redirectUrl }
      │  stores order.payment {provider, merchantOrderId, amount, state: PENDING}
      ▼
Customer browser ──redirect──► PhonePe hosted checkout (UPI / card / net banking)
      │
      │ customer pays
      │
      ├──► PhonePe ── webhook POST /api/payments/phonepe/webhook ──► Backend
      │                 Authorization verified (constant-time)
      │                 → Order Status API re-check → applyPhonePeResult (atomic)
      │
      └──► PhonePe redirects browser to CLIENT_URL/order/:id?payment=phonepe
                 customer app → GET /api/payments/phonepe/status/:id
                 → Backend calls Order Status API → applyPhonePeResult (atomic)

Background tick (backend) — re-checks PENDING attempts on PhonePe's schedule,
cancels unpaid orders at the deadline after one last check.

On verified COMPLETED + amount match:
   paymentStatus = PAID, paymentMethod = Online, paidAt, payment.state = SUCCESS
   → AWAITING_PAYMENT → PENDING_CONFIRMATION (role: system)
   → socket: staff room (full order), kitchen flow unchanged
      │
      ▼
Waiter app: confirms order → CONFIRMED → (timer / Start preparing) → PREPARING
Kitchen app: sees it at PREPARING (KOT printed by print-service)
Admin app: invoice shows PhonePe transaction id; reports list it under "Online gateway"
```

## Role of each component

| Component | Responsibility | Trust level |
|---|---|---|
| **Customer app** | Shows "Pay with PhonePe" (only when `phonePeEnabled`), calls initiate, redirects, polls status on return. Never decides that a payment succeeded. | Untrusted |
| **Zen OS Backend** | Single source of truth. Prices the order, creates the PhonePe payment with a server-derived amount, holds the secrets, verifies every result, writes PAID atomically, promotes the order, emits sockets. | Authoritative |
| **PhonePe PG** | Hosts checkout, collects the money, reports results through webhook + Order Status API, settles to the merchant bank. | External, verified |
| **Webhook endpoint** | Fast path for results. Authenticated by the PhonePe header, then re-confirmed with Order Status. Always answers 2xx quickly. | Verified before use |
| **Order Status API** | Final verification for every path (return poll, webhook confirm, background tick, admin re-check). | Verified (our own authenticated call) |
| **Background tick** | Catches lost webhooks / closed browsers; expires unpaid orders. | Internal |
| **Waiter app** | Sees the order only once paid; confirms it; can still record cash/UPI manually for non-gateway orders. | Staff |
| **Kitchen app** | Sees PII-stripped orders from PREPARING onward; unaffected by payment. | Staff (kitchen room) |
| **Admin app** | Gateway status, invoices with gateway ref, reports, (future) refunds and re-check. | Admin / manager |
| **Print service** | Prints KOT/bill jobs; **no change**. | On-prem device key |

## Failure paths

| Case | Result |
|---|---|
| Customer closes the browser after paying | Webhook or the background tick marks it PAID and promotes it |
| Payment FAILED | `payment.state = FAILED`; order stays unpaid; customer can retry or (outside ONLINE-only mode) pay cash |
| Never paid | Order auto-cancels at `paymentDeadline` (after a last live check) |
| Paid after auto-cancel | Today: warning log only. Target: refund via API, or admin alert |
| Forged webhook | Header mismatch → discarded; status re-check is the only path to PAID |
| Amount mismatch | Target: not marked PAID; flagged for admin review |
