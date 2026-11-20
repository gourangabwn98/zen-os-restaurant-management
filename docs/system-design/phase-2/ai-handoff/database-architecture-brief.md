# Database Architecture Brief — Zen OS

MongoDB, one database per restaurant, Mongoose 9. Transactions used for kitchen send, edits after KOT, cancellation with stock reversal, delivery accept/hand-over, some menu and inventory operations (requires a replica set). No soft delete. No migrations framework.

## Collections (55)
* Identity/config: User, RestaurantProfile (singleton by convention), Counter (order numbers), PrinterDevice
* Menu: Category, MenuTime, MenuItem, Chef (legacy, unused)
* Orders/floor: Order, Table, TableSession, KOTJob, KOTChangeJob, BillPrintJob, Invoice (legacy), WaitlistEntry, WaiterCall
* Engagement: Coupon, NotificationLog, SupportTicket, StaffReview
* People: AttendanceSession, DutyHistory (append-only), StaffLeave, StaffPay
* Inventory: Supplier, InventoryItem, InventoryBatch, Recipe, StockPurchase, StockLedger (append-only by convention), WastageLog
* Delivery: DeliveryPartnerState, DeliveryJob, DeliveryOffer, DeliveryLocation (TTL 7 d), DeliveryEvent (append-only), CodCollection
* Inventory V3 (feature flag, created by a setup script): 12 companion collections (settings, configs, financial entries, recurring rules, cost schedules, counts, book expectations/confirmations, loss classification, operations, audit)
* Offline Edition only: StaffDevice, StaffPin, LocalSession, LocalRateLimit, LocalAuthEvent (append-only), LocalSetupState

## Key relationships and constraints
| Relationship | Constraint |
|---|---|
| Order → KOTJob | 1:1, unique `order` |
| Order → KOTChangeJob | 1:N, unique `{order, revision}` |
| Order → BillPrintJob | 1:N (reprints); combined bills by `requestKey` (unique) |
| Table → TableSession | one OPEN session per `tableNo` (partial unique) |
| TableSession ↔ Order | many orders per session (two-way references) |
| Order → Order | `parentOrder` = root of follow-up orders |
| MenuItem → Recipe | 1:1, unique |
| Recipe → InventoryItem | ingredients (many) |
| InventoryItem → StockLedger | movements (with related order/purchase/wastage) |
| User → AttendanceSession | one OPEN per employee |
| AttendanceSession → DutyHistory | unique `{session, action, at}` |
| Order → DeliveryJob, CodCollection | 1:1 each, unique |
| DeliveryJob → DeliveryOffer | unique `{job, partner, round}` |
| Order.idempotencyKey | partial unique (string only) |
| MenuItem.category | string section key — **not** a reference |

## Order document (central aggregate)
Identity (`orderId` unique from Counter, `user` = the logged-in caller), lines (menu item ref + name/price/size/add-on snapshots + making cost), money (subtotal, tax, service charge, AC-room charge, discount, total, coupon snapshot), context (type, table, area, session, source, priority, delivery address), lifecycle (status, per-step actor/time, statusHistory, autoPrepareAt, paymentDeadline, revision), payment (paymentStatus, method, split, paidBy/At, PhonePe attempt sub-document), bill (billStatus, settledAt/By), stock (stockDeducted, stockReversed, stockDeductions).

## Known data risks
Table session opened outside the order-insert transaction; hard deletes of referenced documents; missing indexes on `Order.user` and tick queries; Inventory V3 indexes depend on a setup script; legacy `Invoice` enums (`"Dining"`, no `Both`).

## Field-level reference
`docs/system-design/07-database-dictionary.md`, DBML `docs/system-design/diagrams/schema.dbml`.
