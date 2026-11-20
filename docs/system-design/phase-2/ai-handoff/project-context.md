# Project Context — Zen OS (for AI tools)

Read this first. Facts are verified from the repository on 2026-11-20 unless labelled. No secrets, hostnames, phone numbers or IPs are included — never invent them.

## What it is
Zen OS is a **single-restaurant** POS and operations platform (first client brand in UI: "Hotel Khoai"; package prefix "Sohoj"). One deployment = one restaurant = one MongoDB database. Volume ≈ 200 orders/day.

## Parts
| Part | Tech | Status |
|---|---|---|
| `restaurant-server` — the only backend | Node 22, Express 5, Socket.IO 4, Mongoose 9 | IMPLEMENTED |
| `admin` web app | React 19, Vite 8, PWA | IMPLEMENTED |
| `waiter`, `kitchen` web apps | React 18, Vite 5, PWA | IMPLEMENTED |
| `customer` web app | React 18, Vite 5 | IMPLEMENTED |
| `delivery-app` rider app | React Native 0.77 + Kotlin (Android) | IMPLEMENTED (unmerged branch) |
| `print-service` Windows print bridge | Node → `SohojPrintService.exe` | IMPLEMENTED |
| Offline Edition (same backend on a restaurant PC) | `DEPLOYMENT_MODE=LOCAL`, local MongoDB replica set, PIN login | PARTIAL (phases O1/O2, uncommitted) |
| Cloud sync | — | PLANNED, not approved |
| Android print agent | — | PROPOSED (design docs only, no code) |

## People / roles
`admin` (owner), `manager`, `inventory_manager`, `waiter`, `chef`, `customer`, `staff` (no login), `delivery` (rider). All are documents in one `User` collection.

## Non-negotiable rules
1. The server decides price, order status, source, payment status, role and stock.
2. Order status follows a strict state machine (see workflow brief).
3. Exactly one KOT per order; edits after the KOT create change slips.
4. Money is PAID only by a checksum-verified gateway result or an explicit staff action; a UPI link or redirect is never proof.
5. Chefs never receive customer contact or payment data in real time.
6. One writer per restaurant database (also offline).
7. Never hard-code status strings; use the canonical enums.

## Canonical enums
* Order status: `AWAITING_PAYMENT, PENDING_CONFIRMATION, CONFIRMED, PREPARING, READY, DELIVERED, COMPLETED, CANCELLED`
* Order type: `DINE_IN, TAKEAWAY, ONLINE` · Source: `CUSTOMER, WAITER, ADMIN`
* Payment status: `PENDING_VERIFICATION, PAID, FAILED` · Payment method: `Cash, Online, Both` (mixed case is correct)
* Bill status: `OPEN, SETTLED` · Print job: `PENDING, PRINTING, PRINTED, FAILED, SKIPPED`
* PhonePe attempt: `CREATED, PENDING, SUCCESS, FAILED, AMOUNT_MISMATCH`
* Delivery job: `SEARCHING, ASSIGNED, AT_RESTAURANT, PICKED_UP, AT_CUSTOMER, DELIVERED, FAILED, CANCELLED`
* Deployment mode: `CLOUD_PRIMARY` (default), `LOCAL_PRIMARY`

## Open decisions (do not assume an answer)
OD-1 offline scope (restricted: waiter/admin/manager + bill printing, vs full); OD-2 guest ordering; OD-3 printer-key rotation; OD-5 PhonePe V1/V2 and refunds; OD-6 delivery/packing charges; OD-7 Android print agent.

## Status labels you must keep
IMPLEMENTED · PARTIAL · PLANNED · PROPOSED · UNKNOWN · OPEN DECISION. Never present PLANNED/PROPOSED items as existing.
