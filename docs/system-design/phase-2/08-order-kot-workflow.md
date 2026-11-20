# 08 — Order and KOT Workflow

All IMPLEMENTED unless labelled. Source: `services/orderService.js`, `kotService.js`, `billingService.js`, `utils/orderStateMachine.js`.

## 1. Order state machine

```mermaid
stateDiagram-v2
  [*] --> AWAITING_PAYMENT: customer, Online, PhonePe on
  [*] --> PENDING_CONFIRMATION: customer order
  [*] --> CONFIRMED: staff order
  AWAITING_PAYMENT --> PENDING_CONFIRMATION: system, verified payment
  AWAITING_PAYMENT --> CANCELLED: customer, admin, manager, system after 15 min
  PENDING_CONFIRMATION --> CONFIRMED: admin, manager, waiter accept
  PENDING_CONFIRMATION --> CANCELLED: admin, manager, waiter, customer
  CONFIRMED --> PREPARING: sendToKitchenTx - timer, staff, chef
  CONFIRMED --> CANCELLED: admin, manager, waiter
  PREPARING --> READY: admin, manager, waiter, chef
  PREPARING --> CANCELLED: admin, manager - stock reversed
  READY --> DELIVERED: admin, manager, waiter, rider OTP
  READY --> PREPARING: items added after KOT
  DELIVERED --> PREPARING: items added after KOT
  DELIVERED --> COMPLETED: system - bill settled and PAID
  PREPARING --> COMPLETED: admin or manager, PAID only
  READY --> COMPLETED: admin or manager, PAID only
  COMPLETED --> [*]
  CANCELLED --> [*]
```

Admin may additionally force any status as a pure flag change (no stock/KOT side effects).

## 2. End-to-end sequence — customer QR order, dine-in

```mermaid
sequenceDiagram
  autonumber
  actor Cu as Customer
  participant CA as Customer app
  participant API as Backend
  participant DB as MongoDB
  actor W as Waiter
  participant T as Auto-send tick (15 s)
  participant PS as print-service
  Cu->>CA: scan table QR, browse, add to cart
  CA->>API: POST /api/orders/quote
  CA->>API: Firebase login → POST /api/auth/firebase-verify
  CA->>API: POST /api/orders (idempotencyKey, tableToken, location)
  API->>DB: open/find TableSession, insert Order PENDING_CONFIRMATION
  API-->>W: order:new
  W->>API: PATCH /api/orders/:id/confirm
  API->>DB: atomic PENDING_CONFIRMATION→CONFIRMED, autoPrepareAt
  Note over CA,API: edit window (default 3 min from placement)
  T->>API: autoSendDueOrders
  API->>DB: TRANSACTION: PREPARING + stock deduction + KOTJob
  API-->>PS: kot:created
  PS->>PS: queue, render, print
  PS->>API: report-job-status PRINTED
```

## 3. Staff order and kitchen

```mermaid
sequenceDiagram
  actor W as Waiter (on duty)
  participant API as Backend
  participant DB as MongoDB
  actor C as Chef
  W->>API: POST /api/orders (staff JWT)
  API->>DB: insert Order CONFIRMED (+ table session)
  alt editWindowMinutes = 0
    API->>DB: sendToKitchenTx immediately
  end
  Note over API: otherwise timer after the window
  C->>API: PATCH /api/kitchen/orders/:id/status READY
  API-->>W: order:status_changed
  W->>API: PUT /api/admin/orders/:id/status DELIVERED
```

## 4. KOT lifecycle and change slips

```mermaid
flowchart TD
  A[sendToKitchenTx] -->|txn| K[KOTJob - unique per order]
  E[modifySentOrderTx<br/>PREPARING/READY/DELIVERED, bill OPEN] -->|txn: re-price, restock, deduct| C[KOTChangeJob - unique order+revision<br/>lists only differences, CANCEL - prefix]
  E -->|items added to READY/DELIVERED| P[status back to PREPARING]
  F[Follow-up order<br/>parentOrder = root] --> K2[its own KOTJob]
  K & C & K2 --> Q[printers room + get-queue]
```

## 5. Billing and completion

```mermaid
sequenceDiagram
  actor W as Waiter / Manager
  participant API as Backend
  participant DB as MongoDB
  participant PS as print-service
  W->>API: POST /api/admin/orders/:id/print-bill
  API->>DB: BillPrintJob (AC charge snapshotted at first print)
  API-->>PS: bill:print
  W->>API: POST /api/admin/orders/settle {orderIds, paymentMethod, paymentSplit?}
  API->>DB: per order atomic: billStatus SETTLED (+ PAID, method, paidBy) if status unchanged
  API->>DB: completeServedSettledOrder → COMPLETED when DELIVERED
  W->>API: POST /api/admin/table-sessions/:id/close (no live orders)
```

## 6. Failure handling

| Failure | Behaviour |
|---|---|
| Duplicate submit | same order returned (idempotency key) |
| Two staff accept at once | second gets 409 |
| Stock runs out before kitchen send | order parked with `sendError`, `order:needs_attention` |
| Concurrent edit | 409 on revision mismatch |
| Settle while someone changes the order | that order rejected "changed by someone else" |
| Printer down | KOT waits; skipped after 30 min (staff alert PROPOSED) |
| Paid online then cancelled | no refund (PLANNED) — manual |
| Order insert fails after session opened | table may stay occupied (R-10; fix PROPOSED) |

## 7. Open item
OD-2: whether customers may order without login. Guest ordering on the restaurant LAN is PLANNED (O3, signed table tokens).
