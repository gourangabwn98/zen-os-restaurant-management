# Zen OS Delivery — Phase 2 Safety Review & COD Payment Policy

Date: 2026-11-20 · Nothing committed, pushed or deployed. No production database operation.

## 1. Phase 2 safety review

| Item | Finding | Action |
|---|---|---|
| **Production Atlas exposure during `server.js` import** | In Phase 2 a syntax check ran `node -e "import('./server.js')"`. Importing `server.js` starts the server and connects to `MONGO_URI` from `.env`, which is the Atlas cluster. The shell exited at once and no server process remained, but **a brief connection cannot be ruled out**. If it connected, it could only have run the server's normal idempotent ticks, and possibly created indexes for the new `delivery*` collections. No delivery documents could have been written: no order had `deliveryAddress`. | Never repeated. All later runs used `scripts/localSandbox.js` or `test/deliveryReplSet.test.js`. Both create a disposable MongoDB on 127.0.0.1, ignore `.env`'s `MONGO_URI`, and **refuse to run** if the URI is not local. **Recommended check for the owner:** in Atlas, look for empty `deliveryjobs`, `deliverypartnerstates`, `deliveryoffers`, `deliverylocations` or `deliveryevents` collections created on 2026-11-19. Empty ones are harmless and can be left or dropped. |
| **Transactions and concurrent acceptance** | Phase 2 proved this only on an in-memory fake. | Now proven on a **real MongoDB 7 replica set** (`test/deliveryReplSet.test.js`, mongodb-memory-server). 10 riders accepting one order gives exactly 1 winner. One rider racing for 5 orders with capacity 2 gets exactly 2. A double-tapped COD hand-over produces 1 delivery, 1 cash record and 1 capacity release. A failed transaction leaves nothing behind. Stable on repeated runs. |
| **Manager permissions** | Managers can register riders (Employees) and use every `/api/delivery/admin/*` endpoint **except** `PATCH /settings` (admin-only). A manager can verify COD hand-ins: `settleBills` allows manager to record PAID, as it already does in Invoices. `guardManagerTarget` still blocks managers from touching other managers or the admin. | Intended. Matches CLAUDE.md (a manager runs the floor and manages waiter/chef/other staff). `test/managerRole.test.js` updated to expect `delivery`. |
| **Existing test failures** | `editAfterKitchen`, `menuStructure` and `payFirst` fail **identically on a clean `HEAD` worktree**. Two of them place dine-in orders without the location the dine-in radius gate now requires. They predate this work. | Not touched (unrelated modules). |
| **Delivery payment restriction** | Phase 2 made delivery prepaid-only (D2). | **Replaced** by the COD policy below, per the new business decision. |
| **DELIVERED vs COMPLETED** | OTP hand-over moves the order READY → DELIVERED only. COMPLETED still needs a settled bill (`completeServedSettledOrder`). | Preserved. COD settlement goes through the existing billing settle. |
| Profile save overwriting delivery settings | `PUT /admin/restaurant/profile` does `Object.assign(profile, req.body)`. A stale `delivery` object in a Profile save could silently revert delivery settings. | Fixed: that endpoint now ignores `delivery`. Delivery settings change only through the validated `PATCH /api/delivery/admin/settings`. |

## 2. COD policy (approved 2026-11-20)

- **Default:** COD on, Online off. Admin enables Online. It appears to customers only if PhonePe is configured on the server. Admin picks the default method.
- **Scope:** home delivery only. Dine-in and takeaway keep `RestaurantProfile.paymentMode` exactly as before (tested).
- **Storage:** `RestaurantProfile.delivery.payment { codEnabled, onlineEnabled, defaultMethod: COD|ONLINE }`. The rules live in `utils/delivery.js` (`deliveryPaymentSettings`, `deliveryPaymentOptions`, `resolveDeliveryPaymentMethod`). `Order.paymentMethod` keeps its canonical values: COD = `Cash`, Online = `Online`.
- **Checkout:** the public profile exposes `deliveryPayment { methods, defaultMethod, available, unavailableReason }`. The cart shows only those methods. If every method is off, Home Delivery shows the reason and cannot be ordered, and the server refuses it too (`DELIVERY_PAYMENT_UNAVAILABLE`).
- **COD orders never depend on PhonePe.** A COD order follows the normal customer flow: PENDING_CONFIRMATION, staff accept, then CONFIRMED, at which point the job is broadcast.

### COD collection workflow

```
Rider at the door ── OTP ✓ + "I collected ₹X" (X must equal order.total) ──►  ONE transaction:
   job DELIVERED · capacity released · order READY→DELIVERED · CodCollection{COLLECTED} · audit COD_COLLECTED
   (order stays paymentStatus PENDING_VERIFICATION — the rider never marks PAID)

Admin/manager ── "Verify hand-in" ──►  claim COLLECTED|DISPUTED → VERIFYING (atomic; two admins can't both run it)
   → billingService.settleBills(Cash)  ← the EXISTING billing path, unchanged:
        paymentStatus PAID + paidBy (the verifier) + billStatus SETTLED → completeServedSettledOrder → COMPLETED
   → CodCollection VERIFIED (+ verifiedBy, verifiedAt) · audit COD_VERIFIED
   If billing refuses (e.g. the bill changed after collection) → claim released, reason shown.
"Dispute" (short cash) → DISPUTED, still listed as held by the rider, can be verified later.
```

- **Separate from online payment:** `CodCollection` is its own record (custody of cash). It is not `order.payment` (the PhonePe sub-document), and it is not a second payment record. Only `settleBills` writes the payment.
- **No duplicates:** unique index on `CodCollection.order`; the write is inside the hand-over transaction, which is conditional on the job's status. The real replica-set test double-submits the hand-over and gets one record.
- **Amount:** always server-derived (`order.total`, re-read inside the transaction). A mismatch (e.g. staff edited the bill after delivery) blocks verification with `COD_AMOUNT_MISMATCH` and the reason is shown, so the cash is checked before the bill is settled in Invoices.
- **Audit:** `DeliveryEvent` records COD_COLLECTED, COD_VERIFIED and COD_DISPUTED (append-only), plus order `statusHistory` from billing.

### API additions
- `GET /api/delivery/me/cash`: rider's cash in hand.
- `GET /api/delivery/admin/cod?status=&partnerId=`: collections + cash held per rider.
- `POST /api/delivery/admin/cod/:id/verify {note?}`: runs billing settle.
- `POST /api/delivery/admin/cod/:id/dispute {reason}`.
- `POST /api/delivery/jobs/:id/deliver` now also takes `{ cashCollected: true, cashAmount }` for COD.
- `PATCH /api/delivery/admin/settings` now accepts `{ payment: { codEnabled, onlineEnabled, defaultMethod } }`.
- Socket: `delivery:cod_collected` and `delivery:cod_updated` (admin room); `delivery:cash_updated` (rider).
