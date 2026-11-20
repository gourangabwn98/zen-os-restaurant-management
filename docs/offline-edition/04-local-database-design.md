# 04 — Local Database Design

Status: **PROPOSAL.**

## 1. Recommendation: local MongoDB 7 single-node replica set, same models

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **Local MongoDB (replica set of one)** | Zero model rewrites; transactions, change streams, unique indexes, `$inc` counters all identical; existing tests already run on it | ~600 MB install, a Windows service to manage | **Recommended** |
| Embedded DB (SQLite/NeDB/LokiJS) | Small | Rewrite of ~45 Mongoose models and every transaction; loses atomic guarantees the code relies on | Rejected |
| FerretDB / Postgres-compat | Mongo wire protocol | Transaction & change-stream gaps; unproven with this codebase | Rejected |

Evidence: `test/deliveryReplSet.test.js` (real transactions, write conflicts, unique indexes, rollback) passed 7/7 on mongod 7.0.14 single-node replica set on this machine.

Configuration: `replSetName: zenrs`, `bindIp: 127.0.0.1`, auth enabled (local admin user created by the installer, password in a DPAPI-protected file), WiredTiger cache 1 GB, journal on.

## 2. Identifiers

* `_id`: ObjectIds are generated on the local server — globally unique by construction (timestamp + random + counter), so they are safe to replicate to the cloud as-is. **No ID remapping during sync.**
* Every synced document gets a `siteId` on the cloud side (not stored locally; added by ingest).

## 3. Sequence numbers

| Sequence | Today | Offline Edition |
|---|---|---|
| Order number `ORD00042` | `Counter` `$inc` (single writer) | Unchanged — the local server is the only writer for the site. Cloud never mints numbers for a LOCAL site. |
| Invoice / bill number | **None exists** — bills are keyed by `orderId` | Pre-existing GST gap (GST rules expect a unique consecutive series per financial year, ≤16 chars). Proposed new `Counter` key `invoice:<FY>` minted atomically **at bill settlement**, format `<SITE>-<FY>-<seq>` e.g. `K01-2627-000123`. Site code makes numbers unique across sites in the cloud mirror. Needs your approval — it also changes online bills if enabled there. |
| Purchase system bill numbers | `Counter` per day (`systemBillNumber`) | Unchanged |
| Event sequence for sync | — | New per-site monotonic `syncSeq` (doc 05) |

Rule: **a number is minted only by the site's single writer**. Phones never mint numbers.

## 4. Transactions and atomic stock
Unchanged: order send-to-kitchen = stock deduction + KOT in one transaction; `currentStock: {$gte: qty}` guards; `stockDeducted` flag. Because there is one writer, concurrent orders from 10 phones serialize in the local DB exactly as they do in Atlas today.

## 5. Audit and history
Existing append-only stores stay authoritative: `Order.statusHistory`, `StockLedger`, `DutyHistory`, `DeliveryEvent`, `InventoryV3Audit`, `CodCollection`. New: `SyncLog` (append-only, every outbox batch and ack) and `LocalAuthEvent` (PIN logins, failures, device registrations, revocations).

## 6. Migrations
* No destructive migrations. New fields are additive with defaults.
* New collections (local only unless stated): `SyncOutbox`, `SyncInbox`, `SyncState`, `SyncLog`, `SyncConflict`, `Device`, `LocalAuthEvent`, `MediaAsset`.
* Indexes created idempotently on boot (`Model.init()` as today).

## 7. Retention
* GPS `DeliveryLocation` already TTL 7 days.
* `SyncOutbox` rows deleted 30 days after cloud ack (ack kept in `SyncLog` for 1 year).
* Everything business-related is kept indefinitely locally and in the cloud.

## 8. Backup and recovery (detail in doc 09)
* `mongodump --oplog --gzip` every 4 h + at business-day end → `D:\ZenOS\backups`, 14 daily + 8 weekly kept; optional copy to USB drive.
* Cloud mirror is a second, off-site copy once synced.
* Restore = stop service → `mongorestore --oplogReplay --drop` into a fresh DB → start → sync agent detects `syncSeq` regression and runs a **reconciliation** pass (doc 05 §7) rather than re-sending blindly.
