# 03 — High-Level System Architecture

## 1. Architectural style (verified)

* **Server-authoritative modular monolith**: one Node.js backend (`restaurant-server`) holding all business rules, one MongoDB database, thin clients.
* **Event push** over Socket.IO with role-scoped rooms; clients refetch on events.
* **Edge print bridge** on-premises, pulling and receiving jobs over an outbound socket.
* **Two deployment shapes** of the same backend: CLOUD_PRIMARY (production) and LOCAL_PRIMARY (Offline Edition, partial).

## 2. System context

```mermaid
flowchart LR
  classDef person fill:#08427b,color:#fff
  classDef sys fill:#1168bd,color:#fff
  classDef ext fill:#888,color:#fff
  Owner[Admin / Owner]:::person
  Mgr[Manager / Inventory manager]:::person
  Wtr[Waiter]:::person
  Chef[Chef]:::person
  Cust[Customer]:::person
  Rider[Delivery partner]:::person
  Zen[Zen OS]:::sys
  DB[(MongoDB)]:::ext
  FB[Firebase Auth + FCM]:::ext
  PP[PhonePe PG V1]:::ext
  SMS[Twilio / MSG91]:::ext
  CL[Cloudinary]:::ext
  GG[Google Maps / Routes]:::ext
  PR[Thermal printers]:::ext
  Owner & Mgr & Wtr & Chef & Cust & Rider --> Zen
  Zen --> DB & FB & SMS & CL & GG
  Zen <--> PP
  Zen --> PR
```

## 3. Containers (verified)

```mermaid
flowchart TB
  subgraph Clients
    ADM[Admin SPA/PWA]
    WTR[Waiter PWA]
    KIT[Kitchen PWA]
    CUS[Customer SPA]
    DEL[Delivery app - Android]
  end
  API[restaurant-server<br/>REST /api + Socket.IO + ticks]
  DB[(MongoDB<br/>Atlas or local replica set)]
  PS[print-service<br/>Windows exe + disk queue]
  PR[Printers]
  ADM & WTR & KIT & CUS & DEL -->|HTTPS + WSS| API
  API --> DB
  PS -->|WSS printer key| API
  PS --> PR
```

## 4. Deployment shapes

| Shape | Writer | Status |
|---|---|---|
| CLOUD_PRIMARY | cloud backend (Render, inferred) + Atlas | IMPLEMENTED (production) |
| LOCAL_PRIMARY | restaurant PC backend + local replica set + LAN app hosting | PARTIAL: O1/O2 implemented, uncommitted |
| LOCAL_PRIMARY + cloud mirror/relay | PC writer, cloud read-only mirror | PLANNED, not approved |

```mermaid
flowchart LR
  subgraph Cloud[CLOUD_PRIMARY - implemented]
    C1[Backend] --> C2[(Atlas)]
  end
  subgraph Site[LOCAL_PRIMARY - partial]
    L1[Backend on PC] --> L2[(Local replica set)]
    L3[Static apps 8080-8083] 
  end
  Site -. PLANNED sync, not approved .-> Cloud
```

## 5. Quality attributes and how the architecture meets them

| Attribute | Mechanism | Status |
|---|---|---|
| Correctness under concurrency | atomic conditional updates, unique indexes, transactions, optimistic revision | IMPLEMENTED |
| Exactly-once KOT | unique KOT per order + durable bridge queue keyed by job id | IMPLEMENTED |
| Data protection | role rooms, PII-stripped kitchen payloads, select:false secrets | IMPLEMENTED (exceptions R-02, R-04) |
| Availability (internet outage) | Offline Edition | PARTIAL |
| Scalability | single instance; sufficient for ~200 orders/day | IMPLEMENTED (not horizontally scalable — R-11) |
| Operability | console logs, `/api/health`, `/local/health` | PARTIAL |

## 6. Key cross-cutting rules

Server authority (rule 2), state machine (rule 4), idempotent jobs (rule 5), canonical enums (no hard-coded status strings), one writer per database, verified-only payments.
