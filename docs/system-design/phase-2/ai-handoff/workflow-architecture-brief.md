# Workflow Architecture Brief — Zen OS

## Order state machine (IMPLEMENTED)
| From → To | Allowed actor |
|---|---|
| (new) → AWAITING_PAYMENT | customer paying online with PhonePe configured |
| (new) → PENDING_CONFIRMATION | customer |
| (new) → CONFIRMED | waiter, manager, admin (staff order) |
| AWAITING_PAYMENT → PENDING_CONFIRMATION | system, after verified payment |
| AWAITING_PAYMENT → CANCELLED | customer, admin, manager, system (15-minute deadline) |
| PENDING_CONFIRMATION → CONFIRMED | admin, manager, waiter |
| PENDING_CONFIRMATION → CANCELLED | admin, manager, waiter, customer |
| CONFIRMED → PREPARING | system timer, admin, manager, waiter, chef — always via one transaction with stock deduction and KOT creation |
| CONFIRMED → CANCELLED | admin, manager, waiter |
| PREPARING → READY | admin, manager, waiter, chef |
| PREPARING → CANCELLED | admin, manager (stock reversed) |
| READY → DELIVERED | admin, manager, waiter, rider (OTP hand-over) |
| READY/DELIVERED → PREPARING | only when items are added after the KOT (not a manual transition) |
| DELIVERED → COMPLETED | system, when the bill is settled and PAID |
| PREPARING/READY/DELIVERED → COMPLETED | admin or manager, only if PAID |
Admin may force any status as a flag change without side effects.

## Main flows
1. **Customer QR order:** scan table QR → menu → server quote → login (Firebase phone) → place order (idempotency key, table token, device location within dine-in range) → staff notified (`order:new`) → staff accepts → edit window (default 3 min from placement) → server auto-sends to kitchen: PREPARING + stock + KOT in one transaction → KOT pushed to kitchen screen and print bridge → chef marks READY → waiter marks served → bill printed → settle (cash / online / split) → COMPLETED → table session closed.
2. **Staff order:** placed as CONFIRMED by an on-duty waiter/manager/admin; same edit window and kitchen send.
3. **Edit after KOT:** staff only, bill open; re-price, give back old stock and deduct new, change slip listing only differences (unique per revision), re-open READY/DELIVERED when items added.
4. **Follow-up order:** new order linked to the root, own KOT, billed together.
5. **Pay-first PhonePe:** order AWAITING_PAYMENT (invisible to staff) → initiate (server amount) → PhonePe → verified callback or status poll → atomic apply (amount must match) → PENDING_CONFIRMATION → normal flow; unpaid cancelled after 15 min.
6. **Printing:** job persisted → pushed to printers room → bridge disk queue → print → status reported; bridge pulls the queue on every connect and every 5 s; jobs older than 30 min are skipped.
7. **Home delivery (branch):** CONFIRMED → delivery job → offers to riders in rounds → atomic accept with capacity → pickup when READY → OTP drop (DELIVERED) → COD custody → management verifies → PAID/SETTLED/COMPLETED.
8. **Duty:** waiter must be on duty for order writes; ON/OFF only by explicit action; every change audited.

## Failure behaviour
Duplicate submit → same order; concurrent accept → 409; concurrent edit → 409 (revision); stock shortage at kitchen send → order parked with reason and staff alert; printer offline → job waits; > 30 min → skipped (no alert yet); paid-then-cancelled → no automatic refund (PLANNED).

## PLANNED / PROPOSED workflows (label them)
LAN guest ordering with signed table tokens (PLANNED O3); restricted-offline capability gate (PROPOSED); sync drain on reconnect (PLANNED); refunds (PLANNED); print skip alerts, station routing, job lease (PROPOSED); Android print agent (PROPOSED).
