# 10 — Payment Architecture

Sources: `services/paymentService.js`, `payFirstService.js`, `billingService.js`, `combinedBillService.js`, `utils/paymentMode.js`, `utils/phonePeEnv.js` (uncommitted), `docs/phonepe-integration/*`.

## 1. Payment methods

| Method | Who records it | Proof | Status |
|---|---|---|---|
| Cash | staff (settle / mark paid) | staff action | IMPLEMENTED |
| UPI deep link / static QR on bill | staff | staff action (link is never proof) | IMPLEMENTED |
| Split `Both` (cash + online) | staff, one bill | amounts must sum to total | IMPLEMENTED |
| PhonePe PG V1 | system | checksum-verified result + amount match | IMPLEMENTED |
| COD (delivery) | rider custody → management verifies | management action | IMPLEMENTED (branch) |
| PhonePe V2 | — | — | PLANNED (OD-5) |
| Refunds | — | — | PLANNED (G10) |

## 2. Three separate state fields on an order

```mermaid
flowchart LR
  subgraph O[Order]
    S[status<br/>operational lifecycle]
    P[paymentStatus<br/>PENDING_VERIFICATION / PAID / FAILED-historic]
    B[billStatus<br/>OPEN / SETTLED]
    G[payment.state<br/>gateway attempt: CREATED / PENDING / SUCCESS / FAILED / AMOUNT_MISMATCH]
  end
  G -->|SUCCESS + amount ok| P
  P -->|PAID required| S
  B -->|SETTLED + DELIVERED| S
```

## 3. PhonePe pay-first sequence

```mermaid
sequenceDiagram
  autonumber
  actor Cu as Customer
  participant CA as Customer app
  participant API as Backend
  participant PP as PhonePe
  participant TK as Pay-first tick 60 s
  CA->>API: POST /api/orders (Online) → AWAITING_PAYMENT, deadline +15 min
  CA->>API: POST /api/payments/phonepe/initiate
  API->>PP: POST /pg/v1/pay (amount = total x 100, X-VERIFY)
  PP-->>API: redirect URL
  API-->>CA: redirect
  Cu->>PP: pays
  PP->>API: POST /api/payments/phonepe/callback (X-VERIFY)
  API->>API: constant-time checksum verify
  API->>API: applyPhonePeResult - atomic, final states, amount check
  API->>API: promotePaidOrder → PENDING_CONFIRMATION, joins table session
  API-->>CA: order:status_changed
  CA->>API: GET /api/payments/phonepe/status/:orderId (on return)
  API->>PP: GET /pg/v1/status (signed)
  TK->>API: promote stragglers, last live check, cancel unpaid after deadline
```

## 4. Gateway attempt state

```mermaid
stateDiagram-v2
  [*] --> CREATED
  CREATED --> PENDING: initiate
  PENDING --> SUCCESS: verified, amount matches
  PENDING --> AMOUNT_MISMATCH: verified, amount differs - final, needs a person
  PENDING --> FAILED: verified failure - cash or retry still possible
  FAILED --> PENDING: new attempt, new merchantTransactionId
  SUCCESS --> [*]
  AMOUNT_MISMATCH --> [*]
```

## 5. Staff payment and settlement

```mermaid
stateDiagram-v2
  [*] --> PENDING_VERIFICATION
  PENDING_VERIFICATION --> PAID: waiter, manager, admin mark or settle
  PENDING_VERIFICATION --> PAID: verified PhonePe
  PENDING_VERIFICATION --> PAID: COD hand-in verified
  PAID --> PENDING_VERIFICATION: admin undo only
```

## 6. Security controls (IMPLEMENTED)

Server-derived amount; redirect never trusted; callback authenticated only by `X-VERIFY` with `timingSafeEqual`; amount re-asserted in the update filter; SUCCESS/AMOUNT_MISMATCH final; unknown `PHONEPE_ENV` disables the gateway; salt key only in backend `.env`; public profile exposes only `phonePeEnabled`; `paidBy/paidAt` written only with the PAID flip.

## 7. Gaps and proposed architecture (PLANNED / PROPOSED)

```mermaid
flowchart TB
  subgraph Today[IMPLEMENTED]
    V1[paymentService V1]
  end
  subgraph Planned[PLANNED - docs/phonepe-integration]
    SW[PHONEPE_API_VERSION switch]
    V2[V2 OAuth token cache + checkout/v2 + order status]
    WH[V2 webhook - Authorization hash, confirm via status call]
    RF[Refund service - unique merchantRefundId, atomic states]
    RC[Reconciliation tick for payment.state PENDING]
    AR[Admin re-check endpoint]
  end
  V1 --> SW --> V2
  SW --> WH
  V1 --> RF
  V1 --> RC
  V1 --> AR
```

| Gap | Impact | Proposal |
|---|---|---|
| No refunds | paid-then-cancelled online orders need manual refund | refund service + admin alert (PLANNED G10) |
| Attempt overwritten per retry | weak audit trail | append attempts to a `PaymentAttempt` collection (PROPOSED) |
| Reconciliation only for AWAITING_PAYMENT | late success on other orders may be missed | G8 |
| Delivery/packing charges unused | revenue not charged | OD-6 |
| Offline: PhonePe unreachable | must be hidden offline | O4 PLANNED |
