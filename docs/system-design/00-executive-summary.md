# 00 — Executive Summary: Zen OS Architecture Discovery

Audit date 2026-11-20 · Read-only · Branch `features/offline-edition` working tree (incl. uncommitted work) · Production version UNKNOWN. Status labels: [01 §2](01-project-overview.md#2-status-legend-used-in-every-document).

## 1. Repository
Monorepo without workspaces: `restaurant-server` (only backend), four React web apps (`admin`, `waiter`, `kitchen`, `customer`), a React Native rider app (`delivery-app`, not in `CLAUDE.md`'s map), a Windows print bridge (`print-service`), extensive design docs, discovery spreadsheets. No CI, Docker or shared code package. → [02](02-repository-and-technology-inventory.md)

## 2. Actual architecture
A single-restaurant, server-authoritative system: one Express 5 + Socket.IO 4 + Mongoose 9 backend over one MongoDB database; thin SPAs; an on-premises print bridge that dials out to the backend. Business rules (state machine, pricing, payment application, stock, KOT idempotency) live in services and are enforced with atomic conditional writes, unique indexes and transactions — consistently and well. → [03](03-system-context.md), [04](04-c4-container-architecture.md), [06](06-backend-architecture.md)

## 3. Technology stack
Node 22 (ESM), Express 5.2, Mongoose 9.9, Socket.IO 4.8, MongoDB Atlas / local replica set, JWT HS256, Firebase Auth/FCM, PhonePe PG V1, Twilio/MSG91, Cloudinary, Tesseract.js; React 19/Vite 8 (admin) and React 18/Vite 5 (others), PWAs; React Native 0.77 + Kotlin; print-service on node-thermal-printer + usb + Windows GDI+.

## 4. Business modules (all IMPLEMENTED unless noted)
Orders (QR/staff/takeaway/delivery; edit window; edits after KOT; follow-ups), billing (settle, split, combined, reopen), payments, KOT/bill printing, tables & sessions & waitlist, menu (schedules, sold-out, import, add-ons), inventory (+ V3 behind a flag), staff/HR/duty, coupons & push offers, call-waiter, reviews, insights, home delivery (branch), Offline Edition O1–O2 (branch, uncommitted). → [11](11-business-workflows.md), [25](25-implementation-status-matrix.md)

## 5. Database
55 collection definitions: 31 core + 6 delivery (always registered), 12 Inventory V3 (created by a setup script), 6 LOCAL-only auth. `Order` is the central aggregate with snapshots, actors and audit history. No soft delete; three append-only collections enforced by hooks. → [07](07-database-dictionary.md), [08](08-database-relationships.md)

## 6. API and real time
276 REST handlers in 25 route files, no versioning/spec. Socket.IO with role-scoped rooms (staff / kitchen PII-stripped / printers / order / user / delivery). **Defect:** legacy events push full orders to a room anonymous sockets join. → [09](09-api-architecture.md), [10](10-realtime-architecture.md)

## 7. Deployment
Inferred Render (backend) + Vercel (admin/customer/waiter) + Atlas; kitchen hosting unknown; print bridge `.exe` on a restaurant Windows PC. No CI, monitoring or verified backups. → [17](17-deployment-infrastructure.md)

## 8. Offline readiness — Low (cloud) / Medium (Offline Edition, partial)
In cloud mode an internet outage leaves staff with read-only cached screens: no orders, no printing. The Offline Edition (local server + PIN login) is implemented through O2 but uncommitted; HTTPS, LAN customer ordering, installer/backup and **sync are planned only** (sync not approved). The stated requirement "offline = waiter/admin/manager + bill printing only" is **not implemented and conflicts** with the approved broader offline scope — decision needed (P-01). → [14](14-offline-first-architecture.md), [15](15-data-synchronization-design.md)

## 9. Printing readiness — High for one PC, with caveats
Idempotent jobs, durable local queue, reconcile-on-connect, LAN/USB/driverless USB, Bengali raster. Caveats: Windows-only, single PC, role-only routing, jobs silently skipped after 30 min, multiple bridges double-print. Android printing: **design only, no code**. → [13](13-printing-architecture.md), [20](20-android-printing-architecture.md)

## 10. Payment readiness — Medium
PhonePe V1 is carefully implemented (verified-only, constant-time checksum, amount match, atomic final states, pay-first expiry). Missing: refunds, broader reconciliation, V2 (if PhonePe issues V2 keys). Cash/UPI/split solid. → [12](12-order-and-payment-lifecycle.md)

## 11. Security — business logic strong, platform hygiene weak
Critical: a printer key and customer data are committed inside two zip archives. High: PII leak to anonymous sockets; unauthenticated WhatsApp test route; deactivated staff can still open sockets in cloud mode; long-lived tokens without revocation; no CI. → [16](16-security-architecture.md), [22](22-technical-debt-and-risks.md)

## 12. Technical debt
Docs drift (guest ordering, roles, repo map, stale comments), legacy models/routes/events, dependency version split, binaries in git, minimal frontend tests, configured-but-unused delivery/packing charges, in-memory OTP/rate limits. → [22](22-technical-debt-and-risks.md)

## 13. Recommended target architecture
Keep the single-writer, server-authoritative design. Fix the security items first, add CI, then proceed with the approved Offline Edition order (O3 if needed → O5 HTTPS → O9 backup → O6/O7 sync after approval), pilot an Android LAN print agent with a single agent before multi-agent leasing. → [23](23-architecture-recommendations.md), [24](24-architecture-decision-register.md)

## 14. Missing information
Deployed SHAs and branches; Atlas tier/backup/network config; kitchen hosting; whether guest ordering removal is intended; offline scope; PhonePe V1 vs V2 credentials; Android agent approval; Google key restrictions. → [22 §3](22-technical-debt-and-risks.md#3-open-questions-unresolved--not-guessed)

## 15. Next steps
1. Rotate the leaked printer keys; remove legacy socket emits and the test route; socket Inactive check (days).
2. Decide P-01 (offline scope) and P-03 (guest ordering).
3. Add CI and record deployed SHA; commit/review the offline-edition branch.
4. Implement PhonePe refunds/reconciliation; decide V2.
5. Continue Offline Edition per approved phases; then sync design approval.
