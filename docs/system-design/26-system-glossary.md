# 26 — System Glossary

| Term | Meaning in Zen OS | Where |
|---|---|---|
| Zen OS / Sohoj / Hotel Khoai | Product name / package prefix / first client's brand | package.json, UI |
| CLOUD_PRIMARY | Default deployment: cloud backend + Atlas | `config/deploymentMode.js` |
| LOCAL_PRIMARY (Offline Edition) | Backend on restaurant PC with local replica set; single writer | same |
| O1…O11 | Offline Edition phases | `docs/offline-edition/07` |
| Tenant key | DB name derived from `MONGO_URI`, used in room names | `utils/tenantKey.js` |
| Placed | UI label for `CONFIRMED` | |
| Awaiting confirmation | `PENDING_CONFIRMATION` | |
| Pay-first | Online-paid customer order starting `AWAITING_PAYMENT` | `utils/paymentMode.js` |
| Edit window | Minutes a CONFIRMED order stays editable before auto-send (`editWindowMinutes`, default 3) | `orderService.editWindowMs` |
| Send to kitchen | CONFIRMED→PREPARING + stock + KOT in one transaction | `sendToKitchenTx` |
| KOT | Kitchen Order Ticket (`KOTJob`, one per order) | `kotService` |
| Change slip | `KOTChangeJob` listing only differences after an edit post-KOT | |
| Follow-up order | New order linked by `parentOrder` to a running order, billed together | KH-07 |
| Served | UI label for `DELIVERED` | |
| Bill status | OPEN / SETTLED, separate from payment and order status | `billingService` |
| Settle | Record payment (if needed) and close bill | `settleBills` |
| Both | Split payment cash + online, staff only, one bill | `parsePaymentSplit` |
| AC room charge | Per-guest charge for AC dining area, snapshotted at first bill print | `acServiceCharge.js` |
| Dining area | "" (hall), AC room, garden… | `utils/diningArea.js` |
| Table session | One OPEN visit per table grouping orders | `TableSession` |
| QR token | Random secret in table QR (`Table.qrToken`) | `tableController` |
| Guest order token | 12 h JWT letting an unauthenticated viewer access one order | `utils/guestOrderToken.js` |
| Dining radius | Customer dine-in must be within `dineInRange` metres (GPS) | `utils/diningRadius.js` |
| Duty | OPEN `AttendanceSession`; waiters must be on duty for order actions | `attendanceService`, `dutyMiddleware` |
| Duty history | Append-only ON/OFF/BREAK log | `DutyHistory` |
| Manager scope | Manager can't act on admin/manager records | `managerScope.js` |
| Section | Fixed menu grouping (`MenuItem.category`) | `utils/menuSections.js` |
| Menu time | Named schedule window copied onto categories | `menuTimeService` |
| Sold out today | `isAvailable:false` until `soldOutUntil` (business-day end) | `menuItemService` |
| Smart category | Computed category (Khoai Signature, Today's special…) | `smartCategoryService` |
| Making cost / COGS | Recipe cost snapshot per order line | `utils/recipeCost.js` |
| Stock ledger | Append-only stock movement log | `StockLedger` |
| Inventory V3 | Flag-gated accounting/inventory extension (counts, expenses) | `inventoryV3*` |
| Printer key | Long-lived credential for print-service (hash stored) | `PrinterDevice` |
| USB_DIRECT | Driverless WinUSB printer mode | `usbDirectDriver.js` |
| Printers room | Socket room for print bridges | `socket.js` |
| Stale/SKIPPED job | Print job not printed within 30 min, dropped | `printerDeviceService` |
| Staff device / PIN | LOCAL-mode registered device and phone+PIN login | `localAuthService` |
| Pepper | `LOCAL_PIN_PEPPER`, server secret mixed into PIN hashes | `utils/localPin.js` |
| Delivery job / offer / round | One delivery per order; broadcast offers per round | `deliveryService` |
| COD custody | Cash held by rider until admin verifies (`CodCollection`) | |
| Tracking token | Signed, revocable link for live delivery tracking | `utils/delivery.js` |
| Outbox / inbox | Planned sync queues site↔cloud | doc 05 |
| Relay | Planned cloud forwarder to a LOCAL site | doc 05 §6 |
