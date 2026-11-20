# 01 — Business Requirements Document (BRD)

Sources: implemented behaviour (discovery report), `CLAUDE.md`, `docs/HOTEL_KHOAI_CHANGE_ROUND.md`, `docs/offline-edition/02,10`, `docs/delivery/01,03`, `docs/phonepe-integration/CLIENT_REQUIREMENTS.md`, and requirements the owner stated in this engagement. Each requirement says where it comes from: **[Stated]** owner instruction in this engagement, **[Doc]** written in a repo document, **[Derived]** inferred from implemented behaviour (the owner should confirm).

## 1. Business context

Zen OS is a restaurant POS and operations platform. First client: one restaurant ("Hotel Khoai" brand in UI strings). It is run as **one deployment per restaurant** (single database; multi-tenancy was removed — `CLAUDE.md` rule 1). Expected volume: **~200 orders/day** [Stated], multiple staff devices, real-time kitchen and floor coordination, physical KOT and bill printing.

## 2. Stakeholders

| Stakeholder | Interest |
|---|---|
| Owner (admin) | revenue, control, reports, staff, menu, settings, payments |
| Manager | runs the floor and back office for the owner within limits |
| Inventory manager | stock, purchases, recipes |
| Waiter | take and serve orders fast, bills, payments |
| Chef | clear, timely kitchen tickets |
| Customer | browse, order, pay, track, call waiter |
| Delivery partner | receive, pick up, deliver, collect cash |
| Zen OS vendor / support | install, operate, update, support many restaurants (product) |
| Accountant | GST bills, day close, payables |

## 3. Business goals

| ID | Goal | Source |
|---|---|---|
| BG-1 | Take dine-in, takeaway and delivery orders from staff and from customers (QR / online) with one consistent price | [Derived] |
| BG-2 | Get every order to the kitchen as a printed KOT and on the kitchen screen, exactly once | [Doc] `CLAUDE.md` rule 5 |
| BG-3 | Bill accurately (GST, service charge, AC-room charge, coupons) and collect cash / UPI / PhonePe / split | [Derived] |
| BG-4 | Never mark money as received without proof (verified gateway result or a staff action) | [Doc] `CLAUDE.md` Payment |
| BG-5 | Control stock and food cost through recipes, purchases and wastage | [Doc] Inventory sections |
| BG-6 | Manage staff: roles, duty, leave, pay, performance | [Derived] |
| BG-7 | Keep operating when the internet fails | [Stated] + [Doc] offline-edition |
| BG-8 | Offer home delivery with own riders and cash-on-delivery control | [Doc] `docs/delivery/` |
| BG-9 | Print without a dedicated PC (future) | [Doc] `docs/audit/` (PROPOSED) |
| BG-10 | Protect customer data and payment integrity | [Doc] `SECURITY_AUDIT.md` |

## 4. Business requirements

| ID | Requirement | Source | Status |
|---|---|---|---|
| BR-01 | Staff (waiter/manager/admin) can place orders for tables, takeaway and delivery | [Derived] | IMPLEMENTED |
| BR-02 | Customers order from a table QR code; staff must accept before cooking | [Doc] `CLAUDE.md` rule 4 | IMPLEMENTED |
| BR-03 | Customers must be logged in to place an order | [Derived] `orderService.js:174-180` | IMPLEMENTED — **OD-2** (docs say guests may order) |
| BR-04 | Orders stay editable for a short window (default 3 min) before the kitchen starts | [Doc] `CLAUDE.md` rule 4 | IMPLEMENTED |
| BR-05 | Staff can change an order after the kitchen started; the kitchen gets a change slip listing only differences | [Doc] | IMPLEMENTED |
| BR-06 | Each order produces exactly one KOT; reprints of bills are allowed | [Doc] | IMPLEMENTED |
| BR-07 | Kitchen staff never see customer contact or payment data | [Doc] `CLAUDE.md` Socket rooms | IMPLEMENTED (paper KOT carries name/phone by design, KH-08) |
| BR-08 | Bills support GST, service charge, AC-room per-guest charge, coupons, combined bills, split cash+online | [Derived]/[Doc] KH-11 | IMPLEMENTED |
| BR-09 | Online payment through PhonePe; customers paying online pay before staff see the order | [Doc] | IMPLEMENTED (V1) |
| BR-10 | Refunds for online payments | [Doc] gap G10 | PLANNED |
| BR-11 | Bengali text on printed tickets and bills | [Doc] print-service README | IMPLEMENTED |
| BR-12 | Stock is deducted when cooking starts, with low-stock alerts | [Doc] | IMPLEMENTED |
| BR-13 | Managers may manage waiters/chefs/other staff, never admins or other managers | [Doc] `CLAUDE.md` rule 3 | IMPLEMENTED |
| BR-14 | Duty (attendance) changes only on an explicit action; every ON/OFF is audited | [Doc] | IMPLEMENTED |
| BR-15 | Home delivery with rider broadcast, OTP hand-over and COD custody verified by management | [Doc] `docs/delivery/03` | IMPLEMENTED (branch) |
| BR-16 | **When internet is lost, only waiter, admin and manager operations and bill printing remain available** | [Stated] | NOT IMPLEMENTED — **OD-1**; conflicts with doc 02 full scope |
| BR-17 | Data entered offline reaches the cloud automatically when internet returns | [Stated] | PLANNED (sync not approved) |
| BR-18 | Android-based printing without a PC | [Stated] (investigation area) + [Doc] | PROPOSED |
| BR-19 | GST invoice series per site | [Doc] doc 13 | PLANNED (deferred) |
| BR-20 | Delivery fee / packing charge | [Derived] (fields exist) | NOT APPLIED — **OD-6** |

## 5. Business rules (non-negotiable, from `CLAUDE.md`)

1. Server decides price, order status, source, payment status, role and stock.
2. A UPI link or redirect is never proof of payment.
3. Only a verified gateway result or an explicit staff action marks PAID; a rider never does.
4. A chef may only start preparing and mark ready.
5. One writer per restaurant database at any time (also offline).

## 6. Constraints

| Constraint | Source |
|---|---|
| One restaurant per deployment | `CLAUDE.md` rule 1 |
| Minimal frontend dependencies (no state library, no UI kit) | `CLAUDE.md` |
| Print bridge must run on-premises | `CLAUDE.md` Print service |
| Offline Edition phases need explicit owner approval; stop after each phase; no commit/deploy without approval | owner decisions (offline-edition docs, memory) |
| Production cloud sync not approved | doc 10 decision 6 |

## 7. Success measures (PROPOSED — no targets exist in the repo)

| Measure | Proposed target |
|---|---|
| Order placed → KOT printed (online, printer up) | ≤ edit window + 20 s |
| Duplicate KOT prints | 0 |
| Orders marked PAID without proof | 0 |
| Staff able to work during an internet outage (Offline Edition) | 100 % of in-scope operations (per OD-1) |
| Data loss on PC restart | 0 committed orders |

## 8. Out of scope (today)

Multi-restaurant tenancy; aggregator integrations (Swiggy/Zomato/ONDC); loyalty; table reservations beyond walk-in waitlist; accounting export beyond xlsx day reports.
