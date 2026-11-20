# 02 — Functional Requirements Specification (FRS)

Each requirement: ID, statement, actor, status, evidence. Status as of branch `features/offline-edition` (working tree). Traceability to [01](01-business-requirements.md) BR-IDs in the last column.

## FR-ORD — Ordering

| ID | Requirement | Actor | Status | Evidence | BR |
|---|---|---|---|---|---|
| FR-ORD-01 | Place an order with server-side pricing; client prices ignored | all ordering roles | IMPLEMENTED | `orderService.priceOrderDraft`, `utils/pricing.js` | BR-01 |
| FR-ORD-02 | Staff order starts CONFIRMED with `autoPrepareAt = now + editWindowMinutes` | waiter/manager/admin | IMPLEMENTED | `orderService.js:340-346` | BR-01, BR-04 |
| FR-ORD-03 | Customer order starts PENDING_CONFIRMATION, or AWAITING_PAYMENT when paying online with PhonePe configured | customer | IMPLEMENTED | `orderService.js:250, 340` | BR-02, BR-09 |
| FR-ORD-04 | Placing an order requires a logged-in user | customer | IMPLEMENTED | `orderService.js:174-180` | BR-03 (OD-2) |
| FR-ORD-05 | Dine-in requires an active table; wrong QR token rejected; missing token allowed with `tableVerified:false` | customer | IMPLEMENTED | `orderService.js:269-291` | BR-02 |
| FR-ORD-06 | Customer dine-in requires device location within `dineInRange` | customer | IMPLEMENTED | `utils/diningRadius.js` | BR-02 |
| FR-ORD-07 | Order placement is idempotent per `idempotencyKey` | all | IMPLEMENTED | partial unique index, `orderService.js:202-209, 397-409` | — |
| FR-ORD-08 | Stock sufficiency checked at placement (409 listing shortages) | all | IMPLEMENTED | `assertStockForItems` | BR-12 |
| FR-ORD-09 | Staff accept customer orders atomically | waiter/manager/admin | IMPLEMENTED | `confirmOrderTx` | BR-02 |
| FR-ORD-10 | Edit held orders with optimistic `revision` and coupon re-application | allowed roles | IMPLEMENTED | `modifyOrderItemsTx` | BR-04 |
| FR-ORD-11 | Edit after kitchen start (staff only), produce a change slip, re-open READY/DELIVERED when items added | waiter/manager/admin | IMPLEMENTED | `modifySentOrderTx` | BR-05 |
| FR-ORD-12 | Follow-up orders linked to a root order and billed together | staff | IMPLEMENTED | `resolveFollowUpParent` | BR-08 |
| FR-ORD-13 | Cancel per role rules; stock reversed if already deducted | per state machine | IMPLEMENTED | `cancelOrderTx`, `orderStateMachine.js` | — |
| FR-ORD-14 | Chefs and riders cannot place orders | — | IMPLEMENTED | `orderService.js:162-172` | Rule 4 |
| FR-ORD-15 | Staff orders may be marked URGENT; customers cannot | staff | IMPLEMENTED | `orderService.js:381` | — |
| FR-ORD-16 | AC-room orders capture guest count once per table visit; charge at first bill print | staff, customer | IMPLEMENTED | `acServiceCharge.js` | BR-08 |

## FR-KIT — Kitchen and KOT

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| FR-KIT-01 | At edit-window end the server moves CONFIRMED→PREPARING, deducts stock and creates the KOT in one transaction | IMPLEMENTED | `sendToKitchenTx` |
| FR-KIT-02 | Exactly one KOT per order; change slips unique per revision | IMPLEMENTED | unique indexes |
| FR-KIT-03 | Kitchen screen lists PREPARING/READY without customer PII or prices | IMPLEMENTED | `kitchenController.toKitchenTicket` |
| FR-KIT-04 | Chef may start preparing and mark ready only | IMPLEMENTED | `TRANSITION_ROLES` |
| FR-KIT-05 | Auto-send failures park the order with a reason and alert staff | IMPLEMENTED | `autoSendDueOrders`, `order:needs_attention` |

## FR-BIL / FR-PAY — Billing and payment

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| FR-BIL-01 | Print a bill as a persisted job (reprints allowed) | IMPLEMENTED | `adminController.printBill` |
| FR-BIL-02 | Settle one or many bills; record payment method atomically; split only for one bill | IMPLEMENTED | `billingService.settleBills` |
| FR-BIL-03 | Combined bill for several orders with per-click request key | IMPLEMENTED | `combinedBillService` |
| FR-BIL-04 | Reopen a settled bill (management) | IMPLEMENTED | `reopenBill` |
| FR-BIL-05 | Complete an order only when PAID | IMPLEMENTED | `PAYMENT_REQUIRED_INTO` |
| FR-BIL-06 | Apply delivery fee / packing charge | NOT IMPLEMENTED (OD-6) | no reader of the fields |
| FR-BIL-07 | GST invoice numbering per site | PLANNED | offline doc 13 |
| FR-PAY-01 | PhonePe initiate with server-derived amount; callback verified by checksum; status poll on return | IMPLEMENTED (V1) | `paymentService.js` |
| FR-PAY-02 | PhonePe success applied only if amount equals expected and current total; otherwise AMOUNT_MISMATCH | IMPLEMENTED (uncommitted) | `checkPaidAmount` |
| FR-PAY-03 | Unpaid pay-first orders cancelled after 15 min, after a last live status check | IMPLEMENTED | `payFirstService`, `PAY_FIRST_WINDOW_MS` |
| FR-PAY-04 | Staff mark PAID; only admin undoes | IMPLEMENTED | `PAYMENT_STATUS_ROLES` |
| FR-PAY-05 | Refund online payments | PLANNED (G10) | gap analysis |
| FR-PAY-06 | PhonePe V2 | PLANNED (OD-5) | V2 plan |

## FR-PRN — Printing

| ID | Requirement | Status |
|---|---|---|
| FR-PRN-01 | Print bridge authenticates with a revocable device key, never a staff login | IMPLEMENTED |
| FR-PRN-02 | Bridge keeps a durable local queue; never reprints a PRINTED job; recovers on reconnect | IMPLEMENTED |
| FR-PRN-03 | LAN, driver-installed USB (share) and driverless USB printers | IMPLEMENTED |
| FR-PRN-04 | Route KOT and bill jobs by printer role (KOT/BILL/BOTH) | IMPLEMENTED |
| FR-PRN-05 | Route KOTs by kitchen station / category | PROPOSED |
| FR-PRN-06 | Bengali text, logo and pay QR on paper | IMPLEMENTED (Windows) |
| FR-PRN-07 | Jobs older than 30 min are skipped | IMPLEMENTED — **staff alert PROPOSED** |
| FR-PRN-08 | Android print agent | PROPOSED (OD-7) |

## FR-MENU, FR-TBL, FR-INV, FR-STF, FR-ENG, FR-DEL

| Area | Implemented requirements (summary) | Not implemented |
|---|---|---|
| Menu | sections, subcategories, category schedules and menu times, sold-out-today with automatic restore, ordering on/off per category, add-ons (≤1 per item), bulk edit (server-side %), import (text/OCR) with admin review, smart categories | — |
| Tables | CRUD, area + display number, QR with token regeneration, one open session per table, close blocked while orders live, waitlist with table-freed suggestion | signed table tokens (O3 PLANNED) |
| Inventory | items, units conversion, recipes and making cost, purchases (manual/OCR/bill photo), payables, wastage, ledger, batches/expiry, low-stock alerts; V3 behind flag | — |
| Staff | employees as users, roles, manager scope, duty/break with history, leave, advances/salary, reviews, collections report | — |
| Engagement | coupons with audience and live window, FCM offer broadcasts (scheduled), call waiter (2 attempts), reviews, support tickets | WhatsApp bill (only test route) |
| Delivery | rider accounts, checkout with address in range, COD/online policy, job per order, offers/rounds/escalation, atomic accept with capacity, pickup gate, OTP drop, COD custody + verify, tracking link, GPS retention, reports | offline rider claims (O8), relay (O7) |

## FR-OFF — Offline

| ID | Requirement | Status |
|---|---|---|
| FR-OFF-01 | Staff apps show last-loaded data when the backend is unreachable; writes fail visibly | IMPLEMENTED |
| FR-OFF-02 | Backend can run on a restaurant PC against a local replica set (LOCAL_PRIMARY) | IMPLEMENTED (uncommitted) |
| FR-OFF-03 | Staff sign in offline with phone + PIN on approved devices; revocation immediate | IMPLEMENTED (uncommitted) |
| FR-OFF-04 | Restricted offline mode: only waiter/admin/manager operations + bill printing | NOT IMPLEMENTED — OD-1 (see [11](11-offline-architecture-comparison.md)) |
| FR-OFF-05 | Customer ordering over restaurant Wi-Fi | PLANNED (O3) |
| FR-OFF-06 | Automatic synchronisation to the cloud when internet returns | PLANNED, not approved |
| FR-OFF-07 | Local HTTPS, installer, automated backup | PLANNED (O5, O9) |

## Non-functional requirements

| ID | Requirement | Status |
|---|---|---|
| NFR-01 | Idempotent writes for every money/print/stock operation | IMPLEMENTED |
| NFR-02 | Kitchen PII isolation | IMPLEMENTED (legacy tenant emits violate general PII rule — R-02) |
| NFR-03 | Server authoritative for price/status/payment/stock | IMPLEMENTED |
| NFR-04 | Real-time updates to staff within seconds | IMPLEMENTED (single instance) |
| NFR-05 | Durability of print jobs across PC/backend restarts | IMPLEMENTED |
| NFR-06 | Bengali/English UI | IMPLEMENTED (admin i18n check fails on 18–19 strings — fact sheet) |
| NFR-07 | Availability during internet outage | PARTIAL (Offline Edition) |
| NFR-08 | Observability (logs, metrics, alerts) | ABSENT → PROPOSED |
| NFR-09 | Automated test gate before deploy | ABSENT → PROPOSED |
| NFR-10 | Security hardening (headers, CORS allow-list, rate limits, token revocation) | ABSENT → PROPOSED |
