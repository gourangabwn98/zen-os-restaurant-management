# 09 — Printing Architecture

Three distinct things: **Windows print-service** (IMPLEMENTED), **Android prototype** (ABSENT — no code), **Android print agent** (PROPOSED, `docs/audit/*`). Earlier detail: `../13-printing-architecture.md`, `../20-android-printing-architecture.md`.

## 1. Current architecture (IMPLEMENTED)

```mermaid
flowchart LR
  subgraph Backend[restaurant-server]
    C1[sendToKitchenTx] --> KJ[(KOTJob)]
    C2[modifySentOrderTx] --> CJ[(KOTChangeJob)]
    C3[printBill / printCombinedBill] --> BJ[(BillPrintJob)]
    KJ & CJ & BJ --> EM[emit to printers room]
    GQ[get-queue ack<br/>expires >30 min] --- KJ & CJ & BJ
    RS[report-job-status<br/>atomic update] --> KJ & CJ & BJ
  end
  subgraph PC[Restaurant Windows PC]
    SC[socketClient<br/>reconnect 1-30 s, poll 5 s] --> Q[(data/queue.json)]
    Q --> PR[processor<br/>retry sweep 3 s]
    PR --> RN[renderers + logo + pay QR + Bengali raster]
    PR --> PM[printerManager<br/>role KOT/BILL/BOTH]
    PM --> L[LAN TCP 9100]
    PM --> U[USB via Windows share]
    PM --> D[USB_DIRECT WinUSB]
  end
  EM --> SC
  SC --> GQ
  PR --> RS
  L & U & D --> P[Thermal printer]
```

## 2. Job status lifecycle

```mermaid
stateDiagram-v2
  [*] --> PENDING
  PENDING --> PRINTING
  PRINTING --> PRINTED
  PRINTING --> FAILED: print error, attempt +1
  PRINTING --> PENDING: printer offline, no attempt used
  FAILED --> PRINTING: retry with backoff below MAX_ATTEMPTS
  PENDING --> SKIPPED: older than 30 min or admin skip-stale
  FAILED --> SKIPPED: older than 30 min or admin skip-stale
  PRINTED --> [*]
  SKIPPED --> [*]
```

## 3. Guarantees

| Guarantee | Mechanism | Holds? |
|---|---|---|
| One KOT per order | unique index + conditional status write in transaction | Yes |
| No reprint after PRINTED (same bridge) | local queue keyed by backend job id; PRINTED terminal | Yes |
| No lost job across restarts | MongoDB jobs + disk queue + reconcile | Yes, **unless older than 30 min** |
| Single bridge per PC | instance lock | Yes |
| No double print across two bridges | — | **No** (broadcast room) |
| At-most-once if crash after printer accepted bytes | — | No (at-least-once) |
| Bill double-click | — | No (no request key on single bill) |

## 4. Sequence — reconnect recovery

```mermaid
sequenceDiagram
  participant PS as print-service
  participant API as Backend
  participant DB as MongoDB
  PS->>API: connect (printerKey)
  PS->>API: get-queue (ack)
  API->>DB: SKIP jobs older than 30 min
  API->>DB: find PENDING/PRINTING/FAILED KOT, change slips, bills
  API-->>PS: jobs
  PS->>PS: upsert (PRINTED never regresses)
  loop each pending job
    PS->>API: report PRINTING
    PS->>PS: print
    PS->>API: report PRINTED or FAILED
  end
```

## 5. Gaps and proposed changes (PROPOSED)

| Gap | Proposal |
|---|---|
| Silent 30-min skip | staff alert + configurable window |
| Role-only routing | station/category routing on `PrinterDevice` + job assignment |
| Two bridges double-print | job lease (claim/lease protocol from `docs/audit/…integration-contract.md` §6) |
| Leaked keys in git (R-01) | rotate; stop committing builds |
| Windows-only Bengali | Android renderer must re-implement |
| No remote monitoring | alert when `PrinterDevice.lastSeenAt` stale |

## 6. Android print agent (PROPOSED)

```mermaid
flowchart LR
  BE[Backend printers room<br/>phase 1: existing protocol<br/>later: lease API] --> AG
  subgraph AND[Fixed Android edge device - PROPOSED]
    AG[Foreground service] --> AQ[(Durable queue)]
    AQ --> AR[ESC/POS + bitmap Bengali, logo, QR]
    AR --> AL[LAN 9100]
    AR -.later.-> AU[USB OTG, tested models]
  end
  AL --> P[LAN printer]
  WIN[Windows print-service<br/>kept in parallel] --> P
```

Prerequisites: OD-7 approval, certified printer models, single-agent first, lease protocol before multi-agent, LAN backend URL support for Offline Edition.
