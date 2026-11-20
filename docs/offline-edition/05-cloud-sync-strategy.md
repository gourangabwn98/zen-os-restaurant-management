# 05 — Cloud Synchronization Strategy

Status: **PROPOSAL.**

## 1. Principle
Because the local server is the single writer (doc 02), sync is **mostly one-way replication up** (site → cloud), plus a small, explicit **inbox down** (cloud → site) for things that genuinely originate in the cloud. There is no general two-way merge, so "stale local data overwrites newer server data" cannot happen for site-owned entities: the site *is* the newest copy.

## 2. Capture: transactional outbox from change streams
* The sync agent opens a MongoDB **change stream** on the site DB (requires the replica set — we have one), with `fullDocument: "updateLookup"`.
* Each change is written to `SyncOutbox { syncSeq, collection, docId, op, version, payload, createdAt }`. `syncSeq` = atomic per-site counter.
* The change-stream **resume token** is persisted in `SyncState` after each outbox write → survives app/server restarts with no gap and no duplicates.
* Why change streams and not hooks in every service: zero edits to the 37 services, and it captures every write path (including scripts and future code).
* Excluded collections: `SyncOutbox/Inbox/State/Log`, `LocalAuthEvent` PIN hashes, `otp` fields, `Device` secrets, `PrinterDevice.keyHash`.

## 3. Transport
* Batches of ≤ 200 rows / 1 MB, `POST https://cloud/api/sync/v1/push` with site credentials (doc 06 §6).
* Each row carries an **idempotency key** = `siteId:syncSeq`. The cloud stores the highest contiguous acked `syncSeq` per site.
* **Partial success**: response lists per-row `ok | duplicate | conflict | rejected`. The agent advances its watermark only over the contiguous `ok/duplicate` prefix; conflicts go to `SyncConflict` and do not block later rows of *other* documents (rows for the same `docId` behind a conflict wait).
* Retry: exponential backoff 2 s → 5 min cap, jitter; infinite; never drops rows.
* Liveness: the agent probes the cloud every 30 s; local operation **never waits** on sync.

## 4. Apply on the cloud
* Cloud upserts into its mirror DB with `{ _id, siteId }` and a guard `version < incoming.version` (Mongoose `__v`/`updatedAt` + `syncSeq` as tiebreak). Out-of-order or replayed rows become no-ops.
* For a LOCAL_PRIMARY site, cloud APIs that would write site-owned entities return `409 SITE_IS_LOCAL_PRIMARY` (except relay endpoints, §6).

## 5. Inbox (cloud → site)
Only these originate in the cloud:

| Inbox item | Source | Applied by |
|---|---|---|
| Remote customer order (delivery/takeaway from home) | cloud relay | Site re-runs `placeOrderTx` **with server-side pricing on the site** — the cloud's price is ignored. Idempotent by the order's `idempotencyKey`. |
| PhonePe callback / status | PhonePe → cloud | Forwarded raw (body + `X-VERIFY`); the **site** verifies the checksum itself and applies via the existing `applyPhonePeResult`. The cloud never marks anything PAID. |
| Customer account (Firebase login done in the cloud) | cloud | Upsert `User{role:customer}` by phone |
| Remote rider actions | cloud relay | Re-executed through the normal delivery service on the site |
| Licence / config pushed by Zen support | cloud | Applied only to whitelisted fields |

Inbox rows have a cloud-side id; the site records applied ids in `SyncInbox` (unique) → exactly-once apply.

## 6. Relay (remote clients while the site has internet)
The local server keeps one outbound WSS to the cloud. Remote riders / remote customers hit the cloud; the cloud forwards the request over that socket to the site and returns the site's answer. If the site is unreachable the cloud answers `503 SITE_OFFLINE` — it **never** answers on the site's behalf. This is how delivery works outside the LAN without exposing the restaurant PC to the internet.

## 7. Recovery
* Agent restart → resume token. Lost resume token / restored backup → **reconciliation**: compare per-collection `{_id, updatedAt}` digests with the cloud and re-enqueue the differences.
* Cloud wiped/restored → it requests a re-push from its last acked `syncSeq`.

## 8. Cloud-side work (needs separate approval)
`/api/sync/v1/*` ingest, mirror write guard, relay socket, per-site credential. Shipped as an **opt-in module** that is inert for CLOUD_PRIMARY restaurants. Deploying it to the production cloud is a separate decision; until then sync can be developed and tested against a **local mock cloud** (a second restaurant-server on a second local DB).

## 9. Conflict policy per entity

| Entity | Owner | Policy |
|---|---|---|
| Orders, items, status events, KOT jobs | Site | Site wins always; cloud mirror only |
| Payments / `paymentStatus` | Site | Site applies verified gateway results; cloud copy is read-only |
| Invoices / bill numbers | Site | Site wins; numbers minted only on site |
| Inventory items, stock levels, ledger, batches, purchases, wastage, v3 operations/expenses | Site | Site wins; ledger rows are append-only, synced as inserts (never merged) |
| Menu, categories, add-ons, coupons, tables, profile/settings | Site | Edited only on the site's admin. Cloud admin for a LOCAL site is read-only for these. (If remote editing is wanted later: relay the edit to the site, don't write the mirror.) |
| Employees / roles / status | Site | Site wins. **Revocation exception**: a deactivation issued from the cloud is an inbox command that the site applies immediately (security beats ownership). |
| Customers | Shared | Upsert by phone; field-level last-writer-wins on profile fields only; never merges order history |
| Attendance / duty history | Site | Append-only |
| Delivery jobs, offers, events, COD | Site | Site wins; rider device claims (offline) are submitted as commands and validated by the site (doc 07) |
| GPS breadcrumbs | Device → site | Insert-only, dedupe by `{rider, at}` |
| Anything in `SyncConflict` | — | Shown in Admin → Sync with both versions; resolved by a human; never auto-overwritten |

## 10. Monitoring
Admin → **Sync** page (new): online/offline, last successful push, outbox depth, oldest unsynced row age, conflicts, rejected rows, inbox lag. Health endpoint exposes the same. Alert banner in admin when backlog > 1 h old while online.
