# 25 — Implementation Status Matrix

Legend: [01 §2](01-project-overview.md#2-status-legend-used-in-every-document). "Branch" = present in the audited `features/offline-edition` working tree; production presence UNKNOWN (Q-02).

| Area | Feature | Status | Confidence | Evidence |
|---|---|---|---|---|
| Orders | State machine incl. AWAITING_PAYMENT, role map, admin override | IMPLEMENTED | High | `utils/orderStateMachine.js` |
| Orders | Staff orders start CONFIRMED; customer PENDING_CONFIRMATION | IMPLEMENTED | High | `orderService.placeOrderTx:340` |
| Orders | Edit window → auto send to kitchen (PREPARING + stock + KOT in one transaction) | IMPLEMENTED | High | `sendToKitchenTx`, `autoSendDueOrders` |
| Orders | Edit after KOT with change slips, re-open READY/DELIVERED | IMPLEMENTED | High | `modifySentOrderTx`, `KOTChangeJob` |
| Orders | Idempotent placement (`idempotencyKey` partial unique index) | IMPLEMENTED | High | `getModels.js:556-559` |
| Orders | Follow-up orders, combined bill | IMPLEMENTED | High | `parentOrder`, `combinedBillService` |
| Customer | QR ordering (login required; soft table token; GPS radius) | IMPLEMENTED | High | `orderService.js:174-291` |
| Customer | Guest (no-login) ordering | ABSENT in cloud; PLANNED for LAN (O3) | High | doc 19 §1 B1 |
| Payment | Cash, UPI deep link, manual mark-paid, split `Both` | IMPLEMENTED | High | `paymentMode.js`, `billingService` |
| Payment | PhonePe PG V1 (pay, callback X-VERIFY, status poll, amount check, pay-first) | IMPLEMENTED | High | `paymentService.js`, `payFirstService.js` |
| Payment | PhonePe V2, refunds, admin re-check | PLANNED | High | `docs/phonepe-integration/V2_IMPLEMENTATION_PLAN.md`, gap G10/G11 |
| Billing | Bill lifecycle OPEN/SETTLED, reopen | IMPLEMENTED | High | `billingService.js` |
| Billing | GST invoice series | PLANNED (O10, deferred) | High | doc 13 |
| Billing | WhatsApp bill | PARTIAL (only via unauthenticated test route) | High | `server.js:151` |
| Printing | KOT / change slip / bill jobs, atomic status, stale expiry | IMPLEMENTED | High | `kotService`, `socket.js:257-332` |
| Printing | Windows print-service: LAN, USB share, USB_DIRECT, disk queue, retry, reconcile | IMPLEMENTED | High | `print-service/src/*` |
| Printing | Bengali text via GDI+ raster | IMPLEMENTED (Windows only) | High | `textImage.js` |
| Printing | Printer routing | PARTIAL (job type → role KOT/BILL/BOTH only; no station/category routing) | High | `printerManager.js:38-42` |
| Printing | Android print agent | PROPOSED (docs only, no code) | High | `docs/audit/*` |
| Inventory | Recipe deduction, reversal, ledger, purchases, wastage, OCR import | IMPLEMENTED | High | `inventoryService.js` |
| Inventory | Inventory V3 | IMPLEMENTED behind flag (off by default) | Medium | `INVENTORY_V3_ENABLED` |
| Menu | Schedules, menu times, sold-out-today, bulk edit, import, add-ons | IMPLEMENTED | High | menu services |
| Tables | Tables, sessions, QR, waitlist | IMPLEMENTED | High | |
| Staff | Employees as Users, manager scope, HR pay/leave, reviews | IMPLEMENTED | High | `employeeService`, `managerScope.js` |
| Staff | Attendance + append-only duty history | IMPLEMENTED | High | `attendanceService`, `DutyHistory` |
| Engagement | Coupons, FCM offers, call waiter, reviews, support | IMPLEMENTED | High | |
| Delivery | Backend, admin board, customer tracking, RN rider app, COD custody | IMPLEMENTED (branch) | High | `deliveryService.js`, `delivery-app/` |
| Delivery | Offline rider claims, cloud relay | PLANNED (O7/O8) | High | doc 07 |
| Offline | Browser read-only cache + connectivity banner | IMPLEMENTED | High | `*/src/offline/*` |
| Offline | Offline write queue / RxDB / device-local DB | ABSENT (rejected by design) | High | `savedData.js` header; doc 02 §1 |
| Offline | O1 local mode, replica set, LAN static apps, `/local/health` | IMPLEMENTED (uncommitted) | High | doc 10 |
| Offline | O2 PIN login, device registration, lockout, audit | IMPLEMENTED (uncommitted) | High | doc 18 |
| Offline | O3 LAN customer ordering | PLANNED | High | doc 19 |
| Offline | Local HTTPS (O5), media (O4), installer/backup (O9) | PLANNED | High | doc 07, 12 |
| Offline | Sync outbox/inbox, automatic sync on reconnect, cloud mirror | PLANNED, **not approved** | High | doc 05 |
| Offline | Restrict features to waiter/admin/manager/bill printing when offline | ABSENT; scope conflict (Q-01) | High | no code; doc 02 §3 |
| Security | RBAC, sanitize, verified Firebase admin login | IMPLEMENTED | High | |
| Security | Helmet, global rate limit, CORS allow-list, token revocation | ABSENT | High | `server.js` |
| Ops | CI/CD, Docker, structured logging, monitoring | ABSENT | High | |
| Ops | Cloud backups | UNKNOWN | — | Q-04 |
