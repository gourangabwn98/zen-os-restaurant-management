# 07 — Database Dictionary

Source of truth: `restaurant-server/config/getModels.js` (31 models), `config/deliveryModels.js` (6), `config/inventoryV3Models.js` (12), `config/localAuthModels.js` (6, LOCAL mode only). DBML: [`diagrams/schema.dbml`](diagrams/schema.dbml). Relationships: [08](08-database-relationships.md).

Conventions: collection name = Mongoose default (lower-case plural of the model name, e.g. `KOTJob` → `kotjobs`). `ts` = `timestamps: true` (`createdAt`, `updatedAt`). `actor` = embedded `{ id: ObjectId→User, role: CUSTOMER|WAITER|ADMIN|CHEF|GUEST|DELIVERY, name }` (`actorSchema`, `getModels.js:97-105`). No soft-delete flags exist anywhere; "deactivate" is done with `status: Inactive` on some entities (High). No migrations framework (ABSENT); one-off scripts in `scripts/`.

## 1. Identity & configuration

### User (`users`) — ts
| Field | Type | Req | Default | Notes |
|---|---|---|---|---|
| name | String | | | trim |
| phone | String | | | **unique, sparse**, login key |
| email | String | | | unique, sparse, lowercase |
| password | String | | | unused (password login commented out) |
| otp, otpExpiry | String, Date | | | legacy; staff OTP now held in memory |
| isVerified, vegMode | Boolean | | false | |
| language | String | | "English" | |
| themePreference | enum light/dark/system | | "dark" | |
| isAdmin | Boolean | | false | always treated as admin |
| role | enum admin, manager, inventory_manager, waiter, chef, customer, staff, delivery | | customer | |
| jobTitle | String ≤40 | | "" | for role `staff` |
| address, waiterName | String | | | |
| status | enum Active/Inactive | | Active | deactivation |
| lastLoginAt | Date | | | |
| pushTokens | [String] | | [] | FCM tokens |
| notificationsSeenAt | Date | | null | |
| hr | sub-doc {salary, otRate, shiftHours 1–16, joinedAt, idProofType, idProofLast4, emergencyName/Phone, photo, payoutUpi, payoutBank} | | {} | PII; only last-4 of ID |
Indexes: phone (unique sparse), email (unique sparse). Owner: auth + employee services.

### RestaurantProfile (`restaurantprofiles`) — ts, singleton by convention (`findOne()`; **no uniqueness enforced**)
Fields: restaurantName (req), phone, email, contactPerson, gstRate, serviceCharge, acServiceChargePerGuest (20, 0–10000), packingCharge, logo, banners[{imageUrl, link, active}], printerIps[{ip, name, active}], address, city, latitude, longitude, dineInRange (200 m), deliveryRange (5000 m), fssaiNumber, gstNumber, aboutRestaurant, openingTime/closingTime ("09:00"/"22:00"), avgDeliveryTime, minOrderAmount, freeDeliveryAbove, deliveryBaseFee, deliveryFeePerKm, social links, website, services{dineIn, takeAway, delivery}, notificationSound, upiId, upiPayeeName, paymentQr, **paymentMode** enum CASH/ONLINE/BOTH (BOTH), **editWindowMinutes** (3, 0–15), timezone ("Asia/Kolkata"), businessDayEndsAt ("03:00"), delivery{defaultCapacity 3, offerTtlSeconds 45, maxRounds 5, trackingTtlHours 2, presenceTimeoutMinutes 10, maxOtpAttempts 5, payment{codEnabled true, onlineEnabled false, defaultMethod COD|ONLINE}}, staffPolicy{paidLeavePerMonth 4, salaryDay 5}.
No indexes. Secrets (PhonePe salt key) deliberately **not** stored here.

### Counter (`counters`)
`_id` String (sequence name, e.g. "orderId"), `seq` Number. Atomic `$inc` for order numbers (`utils/orderNumber.js`).

### PrinterDevice (`printerdevices`) — ts
name (req), keyHash (req, `select:false`, SHA-256), role KOT/BILL/BOTH, connectionType LAN/USB, lanIp, lanPort 9100, usbPrinterName, status Active/Revoked, lastStatus online/offline/error, lastSeenAt, lastError. No unique index on keyHash (lookup by hash — Low risk).

## 2. Menu

### Category (`categories`) — ts
name (req, **unique**), nameBn, image, schedule (`menuScheduleSchema`: enabled, startTime, endTime, days[0–6], startDate, endDate), menuTime → MenuTime, sortOrder, kind MANUAL/SMART, smartKey (unique partial when string), icon, notShareable, orderingEnabled (true).

### MenuTime (`menutimes`) — ts
name (req ≤30), schedule (req), color, sortOrder. Copied onto categories; never read at order time.

### MenuItem (`menuitems`) — ts
name (req), nameBn, price (req), originalPrice, description, **category** (String, req — section key from `utils/menuSections.js`, *not* a ref), subcategory, itemId (unique sparse, import code), size, foodType (display), isFastAvailable, isChefsPick, isTodaysSpecial, isMostPopular, categoryImage, **tag** enum Veg/Non Veg/Others (req, authoritative), image, isAvailable (true), rating (4.0), tags[], soldOutUntil, addons[{_id, name, price, type, isAvailable}] (≤ `ADDONS_MAX`=1).
Indexes: soldOutUntil (partial), {category, subcategory}, itemId (unique sparse).

### Chef (`chefs`) — ts — **legacy, unused**
name, phone (unique), status, createdBy → User.

## 3. Orders, tables, printing

### Order (`orders`) — ts — central aggregate
| Group | Fields |
|---|---|
| Identity | orderId (String, **unique**, from Counter), user → User, isGuest, idempotencyKey (no default; partial unique index on string) |
| Lines | items[orderItem: menuItem → MenuItem (req), name, nameBn, price (incl. add-ons), qty ≥1, notes, addons[{addonId, name, price, type, qty}], basePrice, size, makingCost (snapshot)] |
| Money | subtotal (req), tax (req), serviceCharge, guests, acServiceRate, acServiceCharge, discount, total (req), coupon snapshot {code, title, discountType PERCENT/FLAT, discountValue, maxDiscount, minOrderAmount} |
| Context | guestName, guestPhone (PII), orderType DINE_IN/TAKEAWAY/ONLINE, tableNo, tableName, tableDisplayNo, diningArea ""/AC_ROOM/GARDEN…, parentOrder → Order, parentOrderNo, tableSession → TableSession, tableVerified, source CUSTOMER/WAITER/ADMIN (req), createdBy actor, notes, waiterName, waiterId → User, priority NORMAL/URGENT, deliveryAddress {address, landmark, latitude, longitude, contactName, contactPhone, distanceMeters} |
| Lifecycle | status (8-value enum, default PENDING_CONFIRMATION), confirmedBy/At, preparedBy/preparingAt, readyBy/At, deliveredBy/At, completedBy/At, cancelledBy/At, cancelReason, statusHistory[{status, changedBy, changedAt, note}], cancelDeadline, paymentDeadline, autoPrepareAt, sendError, revision (optimistic lock) |
| Payment | paymentStatus PENDING_VERIFICATION/PAID/FAILED, paymentMethod Cash/Online/Both, paymentSplit {cash, online}, paidBy, paidAt, payment {provider NONE/PHONEPE, merchantTransactionId, phonepeTransactionId, state CREATED/PENDING/SUCCESS/FAILED/AMOUNT_MISMATCH, amount (paise), lastCheckedAt, raw} |
| Bill | billStatus OPEN/SETTLED (no default; read via `effectiveBillStatus`), billSettledAt, billSettledBy |
| Stock | stockDeducted, stockReversed, stockDeductions[{inventoryItem, name, qty, unit}] |
| Feedback | rating 1–5 |
Indexes: idempotencyKey (unique partial), {status, createdAt}, createdAt, tableSession, confirmedAt, deliveredAt, completedAt, paidAt, parentOrder (partial), payment.merchantTransactionId (partial). `pre('save')` assigns orderId if absent.
Missing index candidates: `user` (customer "my orders"), `{status, autoPrepareAt}` (15 s tick), `{status, paymentDeadline}` (pay-first tick) — Medium; fine at ~200 orders/day, matters with years of history.

### Table (`tables`) — ts
tableNo (req, **unique**), seats (4), status Active/Inactive, label, notes, diningArea, displayNo, qrUrl, qrCode, occupancyStatus AVAILABLE/OCCUPIED (driven by sessions), qrToken (random hex).

### TableSession (`tablesessions`) — ts
table → Table, tableNo (req), status OPEN/CLOSED, openedAt, closedAt, openedBy, closedBy, orders[] → Order. Unique partial {tableNo, status} where OPEN.

### KOTJob (`kotjobs`) — ts
order → Order (req, **unique**), orderId, tableNo, orderType, items[{name, nameBn, qty, notes, addons[]}], notes, customerName, customerPhone (paper only), diningArea, tableName, tableDisplayNo, priority, status PENDING/PRINTING/PRINTED/FAILED/SKIPPED, printerId → PrinterDevice, attempts, lastError, printedAt, createdBy.
Missing: `{status, createdAt}` index (the queue query filters by status) — Low.

### KOTChangeJob (`kotchangejobs`) — ts
Same shape as KOTJob plus revision (req). Unique {order, revision}; index {status, createdAt}.

### BillPrintJob (`billprintjobs`) — ts
order → Order (nullable), orderId, tableNo, orderType, payload (Mixed, req — rendered bill), status (as KOT), printerId, attempts, lastError, printedAt, createdBy, combinedOrders[], combinedKey, requestKey. Indexes: requestKey (unique sparse), {combinedKey, createdAt}. Not unique per order (reprints allowed). Single-order print has no request key → double-click can create two jobs (Low).

### Invoice (`invoices`) — ts — **legacy shape**
orders[] → Order, orderId, user, isGuest, orderType (String, default **"Dining"**), subtotal, tax, serviceCharge, total, items[{name, price, qty}], tableNo, status pending/completed/paid/cancelled/refunded, paymentStatus, paymentMethod Cash/Online (**no Both**), generatedAt, notes. See R-15.

### WaitlistEntry (`waitlistentries`) — ts
guestName (req), guestPhone, partySize ≥1, notes, status WAITING/NOTIFIED/SEATED/CANCELLED, tableNo, notifiedAt, seatedAt, cancelledAt, createdBy. Index {status, createdAt}.

### WaiterCall (`waitercalls`) — ts
order → Order (req), orderNumber, tableNo, tableName, customerName, attempt 1|2, targets[] → User, status OPEN/ACKNOWLEDGED/RESOLVED/EXPIRED/CANCELLED, active, expiresAt, acknowledgedBy/At, resolvedBy/At. Unique partial {order, active:true}; index {targets, active}.

## 4. Payments-adjacent, engagement

### Coupon (`coupons`) — ts
code (req, **unique**, uppercase), title, description, discountType, discountValue, maxDiscount, minOrderAmount, startsAt, endsAt (req), isActive, audience ALL/REGISTERED/GUEST, announce, notification → NotificationLog, createdBy. Index {isActive, startsAt, endsAt}.

### NotificationLog (`notificationlogs`) — ts
title, body (req), couponCode, sentBy, recipientCount, status SCHEDULED/SENDING/SENT/FAILED/CANCELLED, startsAt, expiresAt, sendingAt, sentAt, error. Index {status, startsAt}.

### SupportTicket (`supporttickets`) — ts
name, phone, email, subject, message (req), order → Order, user → User, status OPEN/RESOLVED.

### StaffReview (`staffreviews`) — ts
order (req), orderNo, kind FOOD/SERVICE, employee → User, employeeRole, rating 1–5, tags, comment ≤500, customerName, tableNo, complaint, lookedInto {at, by, note}. Unique {order, kind}.

## 5. People

### AttendanceSession (`attendancesessions`) — ts
employee → User (req), role (admin/manager/waiter/chef/staff), managed, changedBy, employeeName, status OPEN/CLOSED, presenceStatus ONLINE/BREAK/OFFLINE, loginAt, logoutAt, lastSeenAt, breaks[{startedAt, endedAt, durationSeconds}], totalBreakSeconds, totalWorkingSeconds, autoClosed. Unique partial {employee, status:OPEN}; more indexes on loginAt/role.

### DutyHistory (`dutyhistories`) — createdAt only — **append-only** (update/delete hooks throw)
employee, employeeName, employeeRole, action (DUTY_ACTIONS), source SELF/ADMIN, changedBy (req), session → AttendanceSession, at, reason. Unique {session, action, at}.

### StaffLeave (`staffleaves`) — ts
employee, from, to, days ≥1, reason, status PENDING/APPROVED/DECLINED/CANCELLED, paid, source SELF/ADMIN, requestedBy, decidedBy/At.

### StaffPay (`staffpays`) — ts
employee, month "YYYY-MM", type ADVANCE/SALARY, amount, method Cash/UPI/Bank, note, breakdown (Object), by. Unique partial {employee, month, type} where SALARY.

## 6. Inventory (v2, always on)

| Model (collection) | Key fields | Indexes / constraints |
|---|---|---|
| Supplier (`suppliers`) | name (req), phone, email, address, gstNumber, status, suppliedItems[{inventoryItem, name}], autoOrderPreference, creditPreference, creditTerms | — |
| InventoryItem (`inventoryitems`) | name (req), nameBn, unit (STOCK_UNITS), category, **currentStock ≥0**, reorderLevel, criticalLevel, costPrice, supplier →, isBatchTracked, status | name **unique** |
| InventoryBatch (`inventorybatches`) | inventoryItem (req), batchNo, quantity ≥0, costPrice, expiryDate, purchase → StockPurchase, receivedAt | {inventoryItem, expiryDate} |
| Recipe (`recipes`) | menuItem (req, **unique**), ingredients[{sourceType STOCK/CUSTOM, inventoryItem, name, quantity, unit, unitCost, cost}], status, totalCost, costIncomplete, costedAt | menuItem unique |
| StockPurchase (`stockpurchases`) | supplier, items[{inventoryItem, name, unit, manual, quantity, costPrice, amount, batchNo, expiryDate}], totalCost, invoiceNumber, billNumberSource, purchaseDate, billDate, billTime, billPhoto, notes, paymentType, paymentSource, payable{to, amount, settledAt, settledSource, settledBy}, createdBy | {payable.to, payable.settledAt}, purchaseDate |
| StockLedger (`stockledgers`) | inventoryItem (req), type (LEDGER_TYPES), quantity (signed), balanceAfter, relatedOrder/Purchase/Wastage, reason, createdBy | {inventoryItem, createdAt}, {type, createdAt}, relatedOrder. Append-only **by convention** (no hook) |
| WastageLog (`wastagelogs`) | inventoryItem (nullable), itemName, quantity, unit, reason, reasonText, costImpact, notes, recordedBy, wastageDate | — |

## 7. Inventory V3 (`config/inventoryV3Models.js`) — `strict:"throw"`, `autoCreate:false`, `autoIndex:false`

Collections are created only by `scripts/setup-inventory-v3.js` (indexes not auto-built — a missed setup run means **unique indexes absent**, Medium). Money in integer paise; quantities as decimal strings.

| Model | Purpose | Unique |
|---|---|---|
| InventoryV3Settings | singleton `_id:"default"`: enabled, foodCostTargetBps, countIntervalDays, autoOrderMode, revision | _id |
| InventoryItemV3Config | per-item usualStockQty, costClass | inventoryItem |
| InventorySupplierV3Config | autoOrderMode, creditFrequency, groups | supplier |
| InventoryFinancialEntry | expenses/income: requestKey, treatment, category, amountPaise, effectiveDate, paymentSource, source, reversalOf | requestKey; occurrenceKey (partial); reversalOf (partial) |
| InventoryRecurringRule | ruleKey+revision, frequency, amount | {ruleKey, revision} |
| InventoryCostSchedule | depreciation/amortisation of an entry | financialEntry |
| InventoryCountSession | stock counts DRAFT→SUBMITTED→APPROVED/REJECTED, lines ≤1000 | requestKey |
| InventoryBookExpectation / BookConfirmation | expected bookkeeping events | key / {localDate, kind} |
| InventoryLossClassification | WASTE vs STAFF_FREE_MEAL per wastage | wastage |
| InventoryV3Operation | idempotency ledger: requestKey + payloadHash → resultRef | requestKey |
| InventoryV3Audit | event, sourceRef, snapshot | — |

## 8. Delivery (`config/deliveryModels.js`)

| Model | Key fields | Constraints |
|---|---|---|
| DeliveryPartnerState | partner → User (**unique**), online, activeCount ≥0, capVersion, capacity 1–10, suspended…, lastLocation, fcmTokens | {online, suspended} |
| DeliveryJob | order (**unique**), status (DELIVERY_JOB_STATUSES), partner, round, offerExpiresAt, escalated, pickup/drop snapshots, distanceMeters, cod, **otpCode (select:false)**, otpAttempts, trackingVersion, timestamps per step, fail/cancel reasons | {status, offerExpiresAt}, {partner, status} |
| DeliveryOffer | job, partner, round, status, expiresAt, respondedAt | unique {job, partner, round} |
| DeliveryLocation | partner, jobs[], lat/lng, accuracy, speed, heading, at, receivedAt | **TTL 7 days** on receivedAt |
| DeliveryEvent | job, order, partner, type, actor, at, data | **append-only** (hooks throw) |
| CodCollection | order (**unique**), job, partner, amount, collectedAt, status COLLECTED/VERIFYING/VERIFIED/DISPUTED, verified/disputed info | {status, collectedAt} |

## 9. Offline Edition auth (`config/localAuthModels.js`, LOCAL only)

| Model | Key fields | Constraints |
|---|---|---|
| StaffDevice | deviceId (unique), secretHash (select:false), pairingCode, label, platform, status PENDING/APPROVED/REJECTED/REVOKED, allowedRoles, pendingExpiresAt | TTL on pendingExpiresAt (24 h unapproved) |
| StaffPin | user (unique), pinHash (scrypt+pepper, select:false), mustChange, failedCount, lockoutCount, lockedUntil | |
| LocalSession | sid (unique), user, device, role, expiresAt, lastUsedAt, revokedAt, purgeAt | TTL purgeAt (30 days) |
| LocalRateLimit | `_id` key, count, resetAt | TTL resetAt |
| LocalAuthEvent | type, at, actor, user, device, phone, ip, reason | append-only hooks |
| LocalSetupState | `_id:"bootstrap"`, codeHash, codeExpiresAt, failedAttempts, completedAt | |

## 10. Data-consistency observations

* **Snapshots by design:** order lines copy name/price/size/add-ons/making cost; KOT jobs copy items; delivery jobs copy addresses. Edits to menu/profile never rewrite history (good).
* **String reference:** `MenuItem.category` is a section key string, not a Category ref; category renames go through `ensureMenuSections` (rename map) — Medium coupling.
* **Denormalised counters/state:** `Table.occupancyStatus` (from sessions), `InventoryItem.currentStock` (ledger is the audit, stock is the authority), `DeliveryPartnerState.activeCount` (repaired by tick).
* **Dangerous operations:** `DELETE /api/admin/users/:id` (hard delete of a User referenced by orders/actors — actor snapshots keep names, but refs dangle); `DELETE /api/menu/:id` (orders keep snapshots; recipes may orphan); `deleteTable`, `deleteSupplier`, `deleteItem` are hard deletes. `scripts/importMenu.js --remove-old` deletes items. No soft delete anywhere.
* **Append-only enforcement** exists only for DutyHistory, DeliveryEvent, LocalAuthEvent (model hooks; raw driver writes bypass them).
* **Migration risk:** schema changes are additive with defaults; older documents rely on read-time fallbacks (`effectiveBillStatus`, `tableDisplayNo` null, add-on `_id` backfill in `menuItemSchema.pre("init")`). Inventory V3 needs an explicit setup script.
