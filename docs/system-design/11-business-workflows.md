# 11 — Business Workflows

All workflows are IMPLEMENTED (High) unless marked. State machines: [12](12-order-and-payment-lifecycle.md). Events: [10](10-realtime-architecture.md).

## W1. Customer QR ordering (dine-in)

| Step | Actor | API / event | DB writes | Rules |
|---|---|---|---|---|
| 1 Scan table QR (`?table=N&t=<qrToken>`) | Customer | `GET /api/admin/tables/:tableNo/validate` | — | token compared with `Table.qrToken` (`===`, not constant time — doc 19 B3) |
| 2 Browse menu | Customer | `GET /api/menu`, `/categories`, `/structure` | `restoreSoldOutItems` may flip items back on | visibility = available ∧ category schedule (`menuScheduleService`) |
| 3 Price cart | Customer | `POST /api/orders/quote` | — | `priceOrderDraft` server pricing + coupon |
| 4 Log in | Customer | Firebase phone → `POST /api/auth/firebase-verify` | upsert `User{role:customer}` | **mandatory** to place |
| 5 Place order | Customer | `POST /api/orders` (idempotencyKey, tableToken, location) | `TableSession` open/find → `Order` (PENDING_CONFIRMATION or AWAITING_PAYMENT) → session `$addToSet` | service toggle; dining radius (GPS within `dineInRange`); wrong token → 400; missing token allowed (`tableVerified:false`); stock pre-check (409); AC-room guests |
| 6 Notify staff | system | `order:new` (staff room, sound) | — | pay-first orders are invisible until paid |
| 7 Track | Customer | `join-order` socket | — | owner check / guest token |
Failure scenarios: outside radius (400), table inactive (400), stock short (409, table not opened), duplicate submit (idempotent replay), PhonePe not configured (Online refused).

## W2. Staff order (waiter/admin/manager)
`POST /api/orders` with staff JWT (waiter must be ON duty) → status **CONFIRMED**, `confirmedBy`=self, `autoPrepareAt = now + editWindowMinutes` (0 → immediate `sendToKitchenTx`). Priority URGENT allowed; payment method Cash/Online only at placement. Source WAITER or ADMIN (manager recorded as ADMIN).

## W3. Order confirmation (customer orders)
`PATCH /api/orders/:id/confirm` (or `/approve`) → `confirmOrderTx`: atomic `PENDING_CONFIRMATION→CONFIRMED`; edit window counts from **placement** time (`holdUntil`); if already elapsed → straight to kitchen. Reject: `PATCH /:id/reject` → CANCELLED. Race: two staff tapping → second gets 409.

## W4. Edit window and send to kitchen
* While PENDING_CONFIRMATION/CONFIRMED: `PATCH /api/orders/:id/items` (`modifyOrderItemsTx`) — re-price with coupon snapshot, `revision` must match.
* 15 s tick `autoSendDueOrders` → `sendToKitchenTx` (role `system`): one transaction = status PREPARING + `deductStockForOrder` (atomic `$gte` decrements, `stockDeducted` false→true, `makingCost` snapshot) + `KOTJob` (unique per order). Failure (e.g. stock ran out) → `sendError` set, `order:needs_attention`, no retry loop.
* Manual "Start preparing" by staff/chef uses the same function.

## W5. Kitchen preparation
Kitchen lists PREPARING/READY (`GET /api/kitchen/orders`, PII-stripped). Chef: `PATCH /api/kitchen/orders/:id/status` PREPARING→READY. Chef may not cancel, serve, edit or place orders.

## W6. Edit after kitchen (staff only)
`modifySentOrderTx` while PREPARING/READY/DELIVERED and bill OPEN: one transaction = re-price, `restockEditedOrder` (return old `stockDeductions`, deduct new), `KOTChangeJob` (diff lines, `CANCEL - ` prefix), and READY/DELIVERED → PREPARING if items were added (`REOPEN_ON_ADD_FROM`). Alternative: follow-up order (`parentOrder`) with its own KOT, billed together.

## W7. Serve, bill, pay, complete
1. Waiter marks served: READY→DELIVERED (`PUT /api/admin/orders/:id/status`).
2. Print bill: `POST /api/admin/orders/:id/print-bill` → `BillPrintJob` + `bill:print` (AC-room charge snapshotted at first print).
3. Record payment: `PATCH /api/admin/orders/:id/payment` (PAID by admin/manager/waiter; undo by admin) **or** settle: `POST /api/admin/orders/settle` (`settleBills`) — sets `billStatus: SETTLED` and, if unpaid, `paymentStatus: PAID` + method (+split for Both, one bill only) in one atomic write filtered on unchanged status.
4. Completion: settled + DELIVERED → `completeServedSettledOrder` (role `system`) → COMPLETED. Admin/manager may "Complete" from PREPARING/READY/DELIVERED **only when PAID**.
5. Reopen bill: `POST /api/admin/orders/:id/reopen-bill` (management).
6. Combined bill: preview/print/pay/complete for several orders (`/api/admin/combined-bill/*`).

## W8. Cancellation
| From | Who | Side effects |
|---|---|---|
| AWAITING_PAYMENT | customer, admin, manager, system (deadline) | none (no session joined) |
| PENDING_CONFIRMATION | customer, waiter, admin, manager | none |
| CONFIRMED | waiter, admin, manager | none (no stock yet) |
| PREPARING | admin, manager | `cancelOrderTx` → `reverseStockForOrder` (replays `stockDeductions`) in a transaction |
| later | admin override only | status flip only, **no** stock/KOT side effects |
No refund is triggered for a paid-then-cancelled online order (logged only — gap G10).

## W9. Table management
Session opens on first dine-in order (unique OPEN per table) → `Table.occupancyStatus` OCCUPIED → close via `POST /api/admin/table-sessions/:id/close` (blocked while non-terminal orders exist) → `table:cleared`, and `table:freed` with a waitlist suggestion. Tables CRUD + QR regenerate by management.

## W10. Takeaway and online (delivery) orders
TAKEAWAY: no table; customer flow as W1 without radius. ONLINE (home delivery): `deliveryAddress` validated inside `deliveryRange`; payment from delivery policy (COD default, Online pay-first if enabled); on CONFIRMED a `DeliveryJob` is created → offers → rider flow (W14). Staff-placed ONLINE orders get no rider job.

## W11. Inventory
Purchases (`recordPurchase`, OCR import, bill photo), wastage, manual adjust, recipes (making cost via `utils/recipeCost.js`, units via `utils/units.js`), low-stock alerts from every stock path (`inventory:alert`). V3 adds counts, expenses, recurring rules, settlements — behind `INVENTORY_V3_ENABLED`.

## W12. Category / item availability
Item On / Sold out today (`soldOutUntil` = next business-day end) / Off; category schedules and Menu times; category `orderingEnabled` (visible but not orderable); `menu:updated` broadcast. Enforced at read **and** at order pricing.

## W13. Staff management
Admin/manager creates employees (`POST /api/admin/employees`) as `User` docs; manager cannot touch admin/manager records. Duty: start/break/end (self) or admin shift set; every ON/OFF → `DutyHistory`. Leave, pay (advances, one salary/month), reviews from customers (FOOD→chef, SERVICE→waiter), staff collections report.

## W14. Home delivery (branch)
CONFIRMED → `DeliveryJob` SEARCHING → broadcast offers per round (45 s) → accept (transaction: offer WON, capacity `$inc` guarded, job ASSIGNED) → pickup only when order READY → OTP drop (READY→DELIVERED, role `delivery`; COD: amount must equal `order.total`, `CodCollection`) → admin "Verify hand-in" → `settleBills` (Cash) → PAID/SETTLED → COMPLETED. Escalation after `maxRounds`.

## W15. KOT and bill printing — see [13](13-printing-architecture.md).
