# 15 — Data Synchronization Design

**Status: PLANNED (design only, `docs/offline-edition/05-cloud-sync-strategy.md`). Production cloud sync NOT approved (doc 10 decision 6). No sync code exists** — no `SyncOutbox`, `SyncInbox`, `SyncState`, change-stream consumer or `/api/sync/*` route (grep, High). This document restates the design for architecture review and adds observations; it does not invent new mechanisms. Diagram: [`diagrams/14-sync-sequence.mmd`](diagrams/14-sync-sequence.mmd).

## 1. Model

One writer per restaurant (the site). Sync is **up-replication** site → cloud mirror, plus a small **inbox** cloud → site for things that originate in the cloud. No general two-way merge.

## 2. Sequence (as designed)

```mermaid
sequenceDiagram
  autonumber
  participant DB as Site MongoDB (replica set)
  participant AG as Sync agent (site)
  participant OB as SyncOutbox / SyncState
  participant CL as Cloud /api/sync/v1/push
  participant MR as Cloud mirror DB
  DB-->>AG: change stream (fullDocument: updateLookup)
  AG->>OB: insert row {syncSeq, collection, docId, op, version, payload}; save resume token
  loop every batch (≤200 rows / 1 MB) while online
    AG->>CL: push rows, key = siteId:syncSeq
    CL->>MR: upsert {_id, siteId} where version < incoming
    CL-->>AG: per-row ok | duplicate | conflict | rejected
    AG->>OB: advance watermark over contiguous ok/duplicate prefix
  end
  Note over AG,CL: offline → exponential backoff 2 s…5 min, never drops rows;<br/>local operations never wait on sync
  CL-->>AG: inbox items (remote orders, PhonePe callbacks, customer upserts, revocations)
  AG->>DB: re-execute via normal services (re-priced on site), record applied id (exactly once)
```

## 3. Design elements and observations

| Element | Design (doc 05) | Observation from this audit |
|---|---|---|
| Capture | change streams, zero edits to services | sound; requires replica set (already enforced) |
| Ordering/idempotency | per-site `syncSeq` counter; cloud stores highest contiguous ack | good; ensure `syncSeq` assignment and outbox insert are atomic with resume-token save |
| Excluded data | auth secrets, OTP, device secrets, `PrinterDevice.keyHash`, LocalAuth PIN hashes | also exclude `DeliveryJob.otpCode`, `StaffDevice.secretHash`, `LocalSetupState.codeHash` (select:false fields) — confirm list |
| Conflict policy | site wins for all site-owned entities; customers shared (field LWW); conflicts to `SyncConflict` for humans | consistent with single-writer; cloud must reject writes for LOCAL sites (`409 SITE_IS_LOCAL_PRIMARY`) |
| Append-only collections | synced as inserts | DutyHistory/DeliveryEvent/LocalAuthEvent hooks block updates — mirror must also insert-only |
| PhonePe | cloud relays raw callback; **site** verifies X-VERIFY and applies | preserves "verified-only" rule |
| Remote orders | cloud relays; site re-runs `placeOrderTx` with site pricing; idempotent by `idempotencyKey` | good; cloud must never answer for an offline site (`503 SITE_OFFLINE`) |
| Recovery | resume token; digest reconciliation; cloud re-push request | needs `updatedAt` on every collection — `Counter`, `DeliveryLocation`, `DeliveryEvent`, `LocalRateLimit`, `LocalAuthEvent` lack timestamps (use `_id`/`at`) |
| Monitoring | Admin → Sync page, health, backlog alert | not built |
| TTL collections | `DeliveryLocation` 7 d etc. | TTL deletes appear as change-stream deletes — decide whether to mirror them |

## 4. Risks if built

Large-document payloads (Order with statusHistory) on a slow uplink; Atlas storage growth from mirroring; schema drift between site and cloud versions (deploy cadence differs); clock skew irrelevant for ordering (uses `syncSeq`) but relevant for "last synced" UX; credential management per site (doc 06 §6).

## 5. Status summary

| Item | Status |
|---|---|
| Outbox/inbox, retry policy, idempotency, conflict register | PLANNED |
| Mock cloud for testing (second local server) | PLANNED |
| Cloud ingest/relay module | PLANNED, requires separate approval |
| Automatic sync on reconnect | PLANNED (O6) |
