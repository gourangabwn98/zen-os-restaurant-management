# Phase 2 Diagram Index

Every Mermaid diagram embedded in the Phase 2 documents, extracted as a standalone file (the document is the source of truth; files were generated from it). 40 diagrams.

Not rendered or validated with a Mermaid parser (none installed; nothing was installed). A manual check removed constructs known to break Mermaid (semicolons in messages/labels, parentheses inside unquoted labels).

Labels inside diagrams: "PLANNED" / "PROPOSED" / dashed lines mark elements without code.

C4 model: [../c4/workspace.dsl](../c4/workspace.dsl). DBML (field-level): [../../diagrams/schema.dbml](../../diagrams/schema.dbml).

| File | Type | Document | Section |
|---|---|---|---|
| `03-01-flowchart.mmd` | flowchart | [03-high-level-architecture.md](../03-high-level-architecture.md) | 2. System context |
| `03-02-flowchart.mmd` | flowchart | [03-high-level-architecture.md](../03-high-level-architecture.md) | 3. Containers (verified) |
| `03-03-flowchart.mmd` | flowchart | [03-high-level-architecture.md](../03-high-level-architecture.md) | 4. Deployment shapes |
| `04-01-flowchart.mmd` | flowchart | [04-frontend-backend-architecture.md](../04-frontend-backend-architecture.md) | 1.1 Common structure of the four web apps |
| `04-02-flowchart.mmd` | flowchart | [04-frontend-backend-architecture.md](../04-frontend-backend-architecture.md) | 2. Backend architecture (verified) |
| `04-03-flowchart.mmd` | flowchart | [04-frontend-backend-architecture.md](../04-frontend-backend-architecture.md) | Domain module map |
| `05-01-erDiagram.mmd` | erDiagram | [05-database-architecture-erd.md](../05-database-architecture-erd.md) | 3. ERD — orders, floor and printing |
| `05-02-erDiagram.mmd` | erDiagram | [05-database-architecture-erd.md](../05-database-architecture-erd.md) | 4. ERD — inventory |
| `05-03-erDiagram.mmd` | erDiagram | [05-database-architecture-erd.md](../05-database-architecture-erd.md) | 5. ERD — people and delivery |
| `06-01-sequenceDiagram.mmd` | sequenceDiagram | [06-api-architecture.md](../06-api-architecture.md) | 2. Request pipeline |
| `06-02-flowchart.mmd` | flowchart | [06-api-architecture.md](../06-api-architecture.md) | 5. Communication map |
| `07-01-flowchart.mmd` | flowchart | [07-socketio-architecture.md](../07-socketio-architecture.md) | 1. Handshake |
| `07-02-sequenceDiagram.mmd` | sequenceDiagram | [07-socketio-architecture.md](../07-socketio-architecture.md) | 4. Event flow — new customer order to kitchen |
| `08-01-stateDiagram-v2.mmd` | stateDiagram-v2 | [08-order-kot-workflow.md](../08-order-kot-workflow.md) | 1. Order state machine |
| `08-02-sequenceDiagram.mmd` | sequenceDiagram | [08-order-kot-workflow.md](../08-order-kot-workflow.md) | 2. End-to-end sequence — customer QR order, dine-in |
| `08-03-sequenceDiagram.mmd` | sequenceDiagram | [08-order-kot-workflow.md](../08-order-kot-workflow.md) | 3. Staff order and kitchen |
| `08-04-flowchart.mmd` | flowchart | [08-order-kot-workflow.md](../08-order-kot-workflow.md) | 4. KOT lifecycle and change slips |
| `08-05-sequenceDiagram.mmd` | sequenceDiagram | [08-order-kot-workflow.md](../08-order-kot-workflow.md) | 5. Billing and completion |
| `09-01-flowchart.mmd` | flowchart | [09-printing-architecture.md](../09-printing-architecture.md) | 1. Current architecture (IMPLEMENTED) |
| `09-02-stateDiagram-v2.mmd` | stateDiagram-v2 | [09-printing-architecture.md](../09-printing-architecture.md) | 2. Job status lifecycle |
| `09-03-sequenceDiagram.mmd` | sequenceDiagram | [09-printing-architecture.md](../09-printing-architecture.md) | 4. Sequence — reconnect recovery |
| `09-04-flowchart.mmd` | flowchart | [09-printing-architecture.md](../09-printing-architecture.md) | 6. Android print agent (PROPOSED) |
| `10-01-flowchart.mmd` | flowchart | [10-payment-architecture.md](../10-payment-architecture.md) | 2. Three separate state fields on an order |
| `10-02-sequenceDiagram.mmd` | sequenceDiagram | [10-payment-architecture.md](../10-payment-architecture.md) | 3. PhonePe pay-first sequence |
| `10-03-stateDiagram-v2.mmd` | stateDiagram-v2 | [10-payment-architecture.md](../10-payment-architecture.md) | 4. Gateway attempt state |
| `10-04-stateDiagram-v2.mmd` | stateDiagram-v2 | [10-payment-architecture.md](../10-payment-architecture.md) | 5. Staff payment and settlement |
| `10-05-flowchart.mmd` | flowchart | [10-payment-architecture.md](../10-payment-architecture.md) | 7. Gaps and proposed architecture (PLANNED / PROPOSED) |
| `11-01-flowchart.mmd` | flowchart | [11-offline-architecture-comparison.md](../11-offline-architecture-comparison.md) | Option F — Full offline, local-primary (approved design) |
| `11-02-flowchart.mmd` | flowchart | [11-offline-architecture-comparison.md](../11-offline-architecture-comparison.md) | Option R1 — Restricted offline, local-primary + capability gate (PROPOSED) |
| `11-03-flowchart.mmd` | flowchart | [11-offline-architecture-comparison.md](../11-offline-architecture-comparison.md) | Option R2 — Restricted offline, cloud-primary with local failover (PROPOSED, not recommended) |
| `12-01-flowchart.mmd` | flowchart | [12-synchronization-architecture.md](../12-synchronization-architecture.md) | 2. Components |
| `12-02-sequenceDiagram.mmd` | sequenceDiagram | [12-synchronization-architecture.md](../12-synchronization-architecture.md) | 3. Up-sync sequence |
| `12-03-stateDiagram-v2.mmd` | stateDiagram-v2 | [12-synchronization-architecture.md](../12-synchronization-architecture.md) | 4. Reconnect behaviour |
| `13-01-flowchart.mmd` | flowchart | [13-security-threat-model.md](../13-security-threat-model.md) | 1. Trust boundaries |
| `13-02-flowchart.mmd` | flowchart | [13-security-threat-model.md](../13-security-threat-model.md) | 4. Authentication and authorization architecture |
| `14-01-flowchart.mmd` | flowchart | [14-deployment-architecture.md](../14-deployment-architecture.md) | 1. Current production (inferred from repo — Medium confidence) |
| `14-02-flowchart.mmd` | flowchart | [14-deployment-architecture.md](../14-deployment-architecture.md) | 2. Offline Edition (LOCAL_PRIMARY) — O1/O2 implemented, installer PLANNED |
| `14-03-flowchart.mmd` | flowchart | [14-deployment-architecture.md](../14-deployment-architecture.md) | 5. Proposed target deployment (PROPOSED) |
| `15-01-flowchart.mmd` | flowchart | [15-testing-strategy.md](../15-testing-strategy.md) | 2. Strategy (PROPOSED) |
| `17-01-flowchart.mmd` | flowchart | [17-implementation-roadmap.md](../17-implementation-roadmap.md) | 1. Sequence |
