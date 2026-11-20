# 01 — Project Overview

> Part of the Zen OS System Design Discovery Package (`docs/system-design/`).
> Audit date: 2026-11-20 · Read-only discovery · No code, data, config or git history was changed.

## 1. Scope of this audit

| Item | Value |
|---|---|
| Repository | Monorepo `Restaurant-Management-System` (git remote: `<origin-remote>`, redacted) |
| Branch audited | `features/offline-edition` **working tree, including uncommitted changes** (29 modified + 19 untracked paths at audit start) |
| Default branch | `main` (behind this branch; see [02](02-repository-and-technology-inventory.md) §1) |
| What is deployed in production | **UNKNOWN.** The repo contains no deploy manifest that pins a SHA. `GET /api/health` returns `RENDER_GIT_COMMIT` at runtime (`restaurant-server/server.js:113-120`), but this audit did not call production. |
| Method | Static reading of source, schemas, routes, configs and existing docs. Diagram sources were written by hand from that reading. No tests, builds, print jobs, payments or database calls were run during this audit. Test/build results quoted come from earlier runs recorded in `discovery/fact_sheet.md` (2026-11-19) and `docs/offline-edition/10-final-status-report.md` / `18-…` (2026-11-20), and are marked as such. |

Because the audited tree is a feature branch with uncommitted work, **anything this package calls IMPLEMENTED means "present in this working tree", not "running in production".** Where a feature exists only on this branch, the status matrix ([25](25-implementation-status-matrix.md)) says so.

## 2. Status legend (used in every document)

| Label | Meaning |
|---|---|
| **IMPLEMENTED** | Verified in source code in this working tree. |
| **PARTIAL** | Some of the functionality exists in code; named gaps remain. |
| **PLANNED** | Written down in a design/plan document in the repo; no code. |
| **PROPOSED** | A suggestion or future direction (in existing docs or in this package's recommendations); not yet a plan anyone approved. |
| **UNKNOWN** | Not enough evidence in the repository to decide. |
| **ABSENT** | Looked for and not found (stated explicitly so it is not mistaken for UNKNOWN). |

Confidence: **High** = read the implementing code; **Medium** = read part of the code or a reliable in-repo report; **Low** = inferred from comments, names or docs only.

## 3. What Zen OS is (verified)

Zen OS (also branded "Sohoj" in package names, and "Hotel Khoai" as the first client's brand in UI strings) is a **single-restaurant** POS and operations platform:

* **One backend** — `restaurant-server/` (Node.js, Express 5, Mongoose 9, Socket.IO 4) — against **one MongoDB database** (`MONGO_URI`). Multi-tenant resolution was deliberately removed (`middleware/authMiddleware.js` header comment; `CLAUDE.md` rule 1). Confidence: High.
* **Four React web apps** — `admin/`, `customer/`, `waiter/`, `kitchen/` (Vite SPAs; admin/waiter/kitchen are installable PWAs).
* **One React Native Android app** — `delivery-app/` (riders). Not listed in `CLAUDE.md`'s repo map.
* **One on-premises Windows print bridge** — `print-service/` (Node CLI packaged as `SohojPrintService.exe`).
* **An "Offline Edition" mode** of the same backend (`DEPLOYMENT_MODE=LOCAL`) that runs on a restaurant PC against a local MongoDB replica set — phases O1–O2 implemented on this branch, O3+ planned.

## 4. Investigation areas → where the answer is

| Area named in the brief | Short answer | Status | Document |
|---|---|---|---|
| Admin application | React 19 SPA/PWA, ~20 pages, role-filtered for manager / inventory_manager | IMPLEMENTED | [05](05-application-architecture.md) |
| Waiter application | React 18 PWA: tables, new order, order detail, duty, waiter calls | IMPLEMENTED | [05](05-application-architecture.md) |
| Kitchen / Chef application | React 18 PWA: live KOT board (PREPARING/READY), PII-stripped | IMPLEMENTED | [05](05-application-architecture.md) |
| Customer QR ordering | React 18 SPA; **login required to order** (guest ordering is refused server-side) | IMPLEMENTED (login-only) | [11](11-business-workflows.md) |
| Backend API | ~276 route handlers over 25 route files | IMPLEMENTED | [06](06-backend-architecture.md), [09](09-api-architecture.md) |
| MongoDB | 37 cloud collections + 12 Inventory-V3 + 6 Offline-Edition auth collections | IMPLEMENTED | [07](07-database-dictionary.md) |
| Socket.IO real time | Role-scoped rooms; printer-key auth; legacy events leak PII | IMPLEMENTED (with defects) | [10](10-realtime-architecture.md) |
| KOT and bill printing | Persisted jobs + Windows print bridge with disk queue | IMPLEMENTED | [13](13-printing-architecture.md) |
| Payment processing | PhonePe PG **V1** (salt key), UPI deep link, cash, split | IMPLEMENTED; V2 + refunds PLANNED | [12](12-order-and-payment-lifecycle.md) |
| Inventory | Recipe deduction in the kitchen-send transaction; V3 behind a flag | IMPLEMENTED | [11](11-business-workflows.md) |
| Staff and roles | Employees are `User` docs; 8 role values | IMPLEMENTED | [16](16-security-architecture.md) |
| Offline-first operation | Local-primary server (O1/O2); browser read-only cache | PARTIAL | [14](14-offline-first-architecture.md) |
| Automatic sync when internet returns | Designed (outbox/inbox), **no code** | PLANNED | [15](15-data-synchronization-design.md) |
| Android-based mobile printing | Five design documents, **no code in repo** | PROPOSED | [20](20-android-printing-architecture.md) |
| Delivery management | Backend + admin + customer tracking + RN rider app | IMPLEMENTED (branch only) | [21](21-delivery-platform-proposed-architecture.md) |

## 5. Business requirement under special attention

> *When the restaurant loses internet connectivity, only waiter, admin, manager operations and bill printing should be available.*

Finding (detail in [14](14-offline-first-architecture.md) §6): **no code implements a connectivity-based feature restriction**, and the approved Offline Edition design (`docs/offline-edition/02-offline-architecture.md` §3) targets a **broader** offline scope (kitchen/KOT, inventory, customer QR over Wi-Fi, delivery at the restaurant). This mismatch is recorded as open question Q-01 in [22](22-technical-debt-and-risks.md) and as a decision needed in [24](24-architecture-decision-register.md).

## 6. How to read this package

* Start with [00 — Executive summary](00-executive-summary.md) and [25 — Implementation status matrix](25-implementation-status-matrix.md).
* Every claim with an ID like `E-ORD-03` is traced to files in [27 — Source evidence index](27-source-evidence-index.md).
* Diagram sources live in [`diagrams/`](diagrams/README.md) (Mermaid, Structurizr DSL, DBML).
* Secrets, phone numbers, IPs, domains and remote URLs are redacted as `<…>` throughout.
