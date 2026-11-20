# Zen OS — System Design, Phase 2

Date 2026-11-20 · Documentation only · No application code, configuration, database, printer, payment or git state was changed. Earlier documents (`docs/system-design/00–27`, `PHASE-1-DISCOVERY-REPORT.md`) are preserved unchanged.

**Primary technical reference:** [`../PHASE-1-DISCOVERY-REPORT.md`](../PHASE-1-DISCOVERY-REPORT.md). Where this folder and the earlier `00–27` package disagree, **this folder wins** (it incorporates the corrections in discovery §16.2).

## Labels used everywhere

| Label | Meaning |
|---|---|
| **IMPLEMENTED** | In code on branch `features/offline-edition` (may be uncommitted — said explicitly where it matters) |
| **PARTIAL** | Some of it is in code |
| **PLANNED** | In an approved or written plan in the repo; no code |
| **PROPOSED** | Suggested (by an existing doc or by this package); not approved |
| **OPEN DECISION** | Needs the owner's answer before design can be final |
| **UNKNOWN** | Not determinable from the repository |

## Open decisions carried from discovery (unanswered)

| ID | Question | Where it matters |
|---|---|---|
| OD-1 | Offline scope: *restricted* (waiter, admin, manager, bill printing) or *full* (doc 02 scope)? Is KOT printing included offline? | 01, 02, 11, 12, 17 |
| OD-2 | Is login-required customer ordering intended in the cloud? | 01, 02, 08 |
| OD-3 | Rotate the leaked printer keys now; rewrite git history? | 13, 17 |
| OD-4 | Should `docs/system-design/00–27` be corrected in place later, or retired in favour of this folder? | README |
| OD-5 | PhonePe V1 or V2 credentials? Refund policy until refunds exist? | 10 |
| OD-6 | Charge delivery fee / packing charge (configured, not applied)? | 02, 10 |
| OD-7 | Android print agent go/no-go and printer models | 09, 17 |

## Documents

| # | Document |
|---|---|
| 01 | [Business Requirements Document](01-business-requirements.md) |
| 02 | [Functional Requirements Specification](02-functional-requirements.md) |
| 03 | [High-Level System Architecture](03-high-level-architecture.md) |
| 04 | [Frontend and Backend Architecture](04-frontend-backend-architecture.md) |
| 05 | [Database Architecture and ERD](05-database-architecture-erd.md) |
| 06 | [API Architecture](06-api-architecture.md) |
| 07 | [Socket.IO Architecture](07-socketio-architecture.md) |
| 08 | [Order and KOT Workflow](08-order-kot-workflow.md) |
| 09 | [Printing Architecture](09-printing-architecture.md) |
| 10 | [Payment Architecture](10-payment-architecture.md) |
| 11 | [Restricted vs Full Offline Architecture Comparison](11-offline-architecture-comparison.md) |
| 12 | [Synchronization Architecture](12-synchronization-architecture.md) |
| 13 | [Security and Threat Model](13-security-threat-model.md) |
| 14 | [Deployment Architecture](14-deployment-architecture.md) |
| 15 | [Testing Strategy](15-testing-strategy.md) |
| 16 | [Architecture Decision Records](16-architecture-decision-records.md) |
| 17 | [Implementation Roadmap](17-implementation-roadmap.md) |
| — | [`diagrams/`](diagrams/README.md) — every Mermaid diagram as a standalone `.mmd` file |
| — | [`c4/workspace.dsl`](c4/workspace.dsl) — Structurizr C4 model (verified elements only) |
| — | [`ai-handoff/`](ai-handoff/) — 7-file handoff package for other AI tools |

## Corrections relative to the earlier package (`00–27`)

1. Admin and waiter subscribe to 8 order/table events through `ORDER_EVENTS` (`*/src/hooks/useLiveOrders.js:7-10`) — earlier doc 05 said the waiter did not.
2. `kot:status_changed`, `bill:status_changed`, `inventory:alert`, `waiter_call:activity` are consumed by `admin/src/notifications/model.js`; `table:cleared` by admin and waiter — earlier doc 10 said "no listener".
3. Offline Edition API has 15 handlers (`routes/localAuthRoutes.js:35-53`), not the subset earlier docs listed.
4. The leaked printer key was first reported on 2026-11-19 in `docs/developer-collaboration-audit/RISK_REGISTER.md` R01; this folder cross-references instead of re-announcing.
5. Risk IDs: this folder uses the earlier `22-technical-debt-and-risks.md` IDs (R-01…R-20) and maps them to the developer-collaboration register where they overlap (see 13).
