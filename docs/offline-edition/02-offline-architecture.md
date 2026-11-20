# 02 — Offline Edition Architecture

Status: **PROPOSAL — awaiting approval. No code written.**

## 1. The core decision: one authoritative writer per restaurant

Three shapes were evaluated:

| Option | What it means | Verdict |
|---|---|---|
| A. Device-local offline (each phone keeps an IndexedDB copy and queues writes) | Waiter phone takes an order offline, syncs later | **Rejected as the primary model.** Price, status, stock, numbering and payments are server-authoritative (CLAUDE.md rule 2). Two phones editing the same table offline produce conflicts nobody can resolve safely; stock oversells. Kept only for narrow cases (rider at a customer's door). |
| B. Multi-master (local server and cloud both accept writes, merge later) | Both sides mint order numbers, deduct stock, confirm orders | **Rejected.** Breaks the atomic `Counter`, unique-index idempotency, the order state machine and stock `$gte` guards. Every entity would need a custom merge. |
| **C. Local-primary (recommended)** | The restaurant's on-prem **Zen OS Local Server** is the single writer for that restaurant's operational data. The cloud is a **mirror** (reports, backup, remote viewing) and a **relay** for remote clients when the restaurant has internet. | **Recommended.** The existing backend runs unchanged against a local MongoDB replica set; every invariant stays intact because there is still exactly one writer. |

A restaurant is in exactly one **deployment mode**, set at install time:

* `CLOUD_PRIMARY` — today's production. **Default. Nothing changes.** All new code paths are off.
* `LOCAL_PRIMARY` — Offline Edition. Writes happen on the local server; cloud receives a replicated copy.

Switching a restaurant between modes is a deliberate, supervised cutover (doc 09 §6), never automatic.

## 2. Topology

```
                     ┌──────────── Internet (optional) ────────────┐
                     │  Zen Cloud (existing Render/Atlas deploy)   │
                     │   • Sync ingest  /api/sync/*  (new, gated)  │
                     │   • Mirror DB (read-only for LOCAL sites)   │
                     │   • Relay for remote riders / remote orders │
                     │   • PhonePe callback → relayed to site      │
                     └──────────────▲──────────────────────────────┘
                                    │ outbound only (HTTPS + WSS), from the site
 ┌──────────────────────────────────┼──────────────────────────────────────────┐
 │ Restaurant LAN / Wi-Fi           │                                           │
 │  ┌───────────────────────────────┴───────────────────────────┐              │
 │  │ Restaurant PC — Zen OS Local Server (Windows service)     │              │
 │  │  • restaurant-server (same code, LOCAL_PRIMARY)           │              │
 │  │  • MongoDB 7 single-node replica set (localhost only)     │              │
 │  │  • Static hosting: admin / waiter / kitchen / customer    │              │
 │  │  • Local media store (/media) replacing Cloudinary        │              │
 │  │  • Sync agent (outbox → cloud, inbox ← cloud)             │              │
 │  │  • Backup job · health page                               │              │
 │  │  • print-service (existing exe, BACKEND_URL=localhost)    │──USB/LAN──▶ printers
 │  └──────────────▲────────────────────────────────────────────┘              │
 │      HTTPS/WSS  │ (staff)          HTTP or HTTPS (customers)                 │
 │  Admin PC · Waiter phones · Kitchen display · Customer phones · Rider phones │
 └──────────────────────────────────────────────────────────────────────────────┘
```

## 3. What works offline (internet down, LAN up)

| Area | Offline behaviour |
|---|---|
| Admin, manager, waiter, chef, inventory | **Fully**, against the local server (same screens, same APIs). |
| Customer QR ordering | Over restaurant Wi-Fi, as a **table guest** (doc 06 §4): orders enter `PENDING_CONFIRMATION` and must be accepted by a waiter — the existing human gate. |
| Kitchen / KOT / printing | Fully — print-service talks to `localhost`. |
| Inventory, purchases, receiving, ledger, expenses | Fully. Bill-photo OCR works once the language file is bundled. |
| Billing, invoices, GST | Fully (server-computed). Cash, manual UPI verification, `Both` split. |
| PhonePe | **Not offered** while the gateway is unreachable. Never marked PAID without a verified result. |
| Reports | Fully, from local data. Cloud dashboards show "last synced at". |
| Push notifications / SMS / WhatsApp | Not sent; in-app socket notifications still work. WhatsApp bills queued (opt-in) or skipped. |
| Maps | No tiles; show coordinates, distance and last-known fix with timestamp. |
| Delivery | Assignment, pickup and hand-over at the restaurant work on the LAN. Riders outside the LAN can only reach the system through the cloud relay, i.e. when the restaurant has internet. With no internet, rider actions are captured on the device as **unconfirmed claims** and confirmed on reconnect (doc 07 §Delivery). |
| Remote online ordering (customer at home) | Needs internet on both sides. Arrives via cloud relay; queued orders are **not** accepted by the cloud on the restaurant's behalf. |

## 4. What changes vs. the online product (and what does not)

Unchanged: state machine, pricing, coupons, stock deduction transaction, KOT idempotency, socket rooms, RBAC, print-service protocol, payment rules.

Added (all gated by `DEPLOYMENT_MODE=LOCAL_PRIMARY`):
1. Local auth: PIN login + device registration (doc 06).
2. Table-guest ordering path (doc 06 §4).
3. Local media store and image mirror (doc 03 §5).
4. Static hosting of the four web apps + local HTTPS (doc 03).
5. Sync agent with outbox/inbox (doc 05).
6. Cloud side: sync ingest + relay endpoints — **separate opt-in module, deployed only with your approval** (doc 05 §8).
7. Connectivity-aware feature flags: PhonePe hidden, push/SMS skipped, maps degraded.

## 5. Why not reuse the existing read-only IndexedDB cache as the offline engine
It is correct as a **resilience layer** (a phone that briefly loses Wi-Fi still shows the last tables/orders) and stays. It is not a write path, by design, and should not become one — the local server makes device-side write queues unnecessary for staff on the LAN.
