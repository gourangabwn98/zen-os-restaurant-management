# Diagram Index

All sources are hand-written from the 2026-11-20 read-only audit. Mermaid (`.mmd`) renders on GitHub / VS Code; `workspace.dsl` opens in Structurizr Lite or CLI; `schema.dbml` opens in dbdiagram.io. Dashed elements are PLANNED or PROPOSED. The diagrams have not been rendered or syntax-checked with a tool.

| # | Diagram | File | Used in |
|---|---|---|---|
| 1 | System context | `01-system-context.mmd`, `workspace.dsl` (SystemContext) | 03 |
| 2 | C4 container (cloud + local) | `02-c4-container.mmd`, `workspace.dsl` (Containers) | 04 |
| 3 | C4 component — backend | `03-c4-component-backend.mmd` | 04, 06 |
| 3b | C4 component — print-service | `04-c4-component-print-service.mmd` | 04, 13 |
| 4 | Overall application architecture | `05-application-overview.mmd` | 05 |
| 5 | Backend request lifecycle | `06-backend-architecture.mmd` | 06 |
| 6 | Database ER relationships | `07-database-er.mmd`, `schema.dbml` | 07, 08 |
| 7 | API communication | `08-api-communication.mmd` | 09 |
| 8 | Socket.IO event architecture | `09-socket-events.mmd` | 10 |
| 9 | Order lifecycle state diagram | `10-order-lifecycle.mmd` | 12 |
| 10 | Payment lifecycle | `11-payment-lifecycle.mmd` | 12 |
| 11 | Printing architecture | `12-printing-architecture.mmd` | 13 |
| 12 | Offline-first architecture | `13-offline-architecture.mmd` | 14 |
| 13 | Data synchronization sequence (PLANNED) | `14-sync-sequence.mmd` | 15 |
| 14 | Deployment architecture | `16-deployment.mmd`, `workspace.dsl` (DeploymentCloud, DeploymentLocal) | 17 |
| 15 | Authentication & authorization flow | `15-auth-flow.mmd` | 16 |
| 16 | External integration architecture | `17-external-integrations.mmd` | 18 |
| 17 | Android printing (PROPOSED) | `18-android-printing.mmd` | 20 |
| 18 | Future delivery platform (PROPOSED) | `19-delivery-proposed.mmd` | 21 |
