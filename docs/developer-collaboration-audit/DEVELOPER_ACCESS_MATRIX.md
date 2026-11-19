# Zen OS — Developer Access Matrix

Audit date 2026-11-19. Applies the classification in [IP_PROTECTION_REPORT](IP_PROTECTION_REPORT.md) to each developer.
Principle: **least privilege, contract-first, no production, time-boxed, revocable.**

Legend: **—** no access · **R** read · **W** write (via PR only, protected default branch) · **Test** test-only credentials/accounts the owner issues · **Contract** documentation/spec only, no code · **Extract** a reviewed, history-less copy of specific files in a dedicated repo.

## 1. Code & documentation

| Resource | Owner | Dev A — Offline/Sync | Dev B — Android printing | Dev C — Payments |
|---|---|---|---|---|
| `zen-os-core` (this monorepo, full history) | Admin | — | — | — |
| `CLAUDE.md`, `SECURITY_AUDIT.md`, `discovery/`, `docs/*` (client docs) | Admin | — | — | — |
| `zen-os-contracts` (enums, OpenAPI/AsyncAPI, print + payment + sync contracts, fixtures) | Admin (Maintain) | R | R | R |
| `zen-os-offline-sync` (new) | Admin | W | — | — |
| `zen-os-android-print-agent` (new) | Admin | — | W | — |
| `zen-os-payment-adapter` (new) | Admin | — | — | W |
| Order engine, pricing, inventory, insights, schema, tests | Admin | — (phase A2: **Extract** only if owner decides; see TASK_DISTRIBUTION_PLAN §A) | — | — |
| Auth/RBAC (`authController`, `rbac`, `roles`, …) | Admin | Contract | Contract (device enrollment only) | Contract (who may call initiate/refund) |
| `sockets/socket.js` | Admin | Contract (AsyncAPI) | Contract (printers room events) | — |
| `services/paymentService.js` provider half | Admin | — | — | Extract (5 provider functions) |
| `applyPhonePeResult`, `payFirstService`, `Order` model | Admin | — | — | Contract |
| `print-service/src/renderers/*`, `layout.js`, `textImage.js` | Admin | — | Extract (only if golden fixtures prove insufficient) | — |
| `print-service/src/drivers/lanDriver.js`, `mockDriver.js` | Admin | — | Extract | — |
| `print-service/src/queue.js` (reconcile contract) | Admin | Contract | Contract | — |
| `waiter/`, `kitchen/` `src/offline`, `src/pwa` | Admin | Extract (phase A2, if client outbox in scope) | — | — |
| `customer/` checkout screens | Admin | — | — | — (owner wires UI) |
| `admin/` | Admin | — | — | — |
| `docs/audit/zen-os-android-print-agent-*.md` | Admin | — | R (after owner review/redaction) | — |
| `ZenOS-Android-Printer/` (outside repo) | Admin | — | Seed for their repo, after owner reviews it for secrets | — |

## 2. Environments & services

| Resource | Dev A | Dev B | Dev C |
|---|---|---|---|
| **Production** MongoDB Atlas project | — | — | — |
| **Production** Firebase / GCP project | — | — | — |
| **Production** Render service & env vars | — | — | — |
| **Production** Vercel projects & env vars | — | — | — |
| **Production** PhonePe merchant / any live gateway keys | — | — | — |
| Production Twilio / MSG91 / Cloudinary | — | — | — |
| Production restaurant PC, print-service, `PRINTER_KEY`, printers | — | — | — |
| Real customer / employee / order data (incl. dumps, screenshots) | — | — | — |
| **Staging API URL** (owner-deployed `restaurant-server`, synthetic data) | Test (waiter/chef/admin test accounts) | Test (one staging printer-device key) | Test (customer + staff test accounts) |
| Staging DB (separate Atlas project) direct connection | — (API only) | — | — |
| Dev Firebase project (test phone numbers) | Test (web config only) | — | Test (web config only) |
| Gateway sandbox/UAT credentials | — | — | **Own** sandbox account they create, or owner-issued UAT keys used only in their local `.env` |
| Staging printer device key | — | Test (revoked at offboarding) | — |
| Physical test printers (owner-bought, not the restaurant's) | — | Loaned / they buy & invoice | — |
| GitHub Actions secrets / environments | — | — | — |
| Render/Vercel team membership (staging) | — | — | — |
| Owner's workstation, `D:\Adds_cafe\*`, shared drives | — | — | — |

## 3. GitHub roles (inside a GitHub Organization — see REPOSITORY_ISOLATION_STRATEGY)

| Setting | Value |
|---|---|
| Org base permission | **No permission** |
| Owner | Org Owner (with 2FA, recovery codes stored offline); one break-glass second owner account controlled by the business |
| Contractors | Outside collaborators (not members) or members of one Team each, with **Write** on their own repo only, **Read** on `zen-os-contracts` |
| Forking of private repos | Disabled at org level |
| Required 2FA | On for the org |
| Default branch rules (every contractor repo) | PR required, 1 approval from `@owner` via CODEOWNERS, no force-push, no deletion, linear history, status checks required (once CI exists), signed commits recommended |
| Who can merge | Owner only (restrict push to default branch to owner) |
| Releases/tags | Owner only |
| Actions | Allowed only for owner-approved actions; no repository secrets in contractor repos; "Require approval for all outside collaborators" for workflow runs |
| Deploy keys / GitHub Apps on contractor repos | None (no Vercel/Render integration on contractor repos) |
| Audit log | Reviewed at each milestone and at offboarding |

## 4. Time-boxing

| Developer | Access starts | Access ends | Review points |
|---|---|---|---|
| A | After signed agreement + phase A1 kickoff | End of accepted milestone; phase A2 access is a **new, separate grant** | Every milestone; monthly audit-log review |
| B | Same | Same; staging printer key revoked at offboarding | Same |
| C | Same | Same; contractor rotates/deletes their sandbox keys; owner rotates any UAT keys issued | Same |
