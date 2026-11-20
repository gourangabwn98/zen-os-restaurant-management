# 13 — Invoice / Order Numbering in the Offline Edition (Decision 5: deferred)

Status: **Documentation only.** Per decision 5, invoice numbering is **unchanged**. No GST invoice
series is introduced. Any change waits for business/accountant approval.

## 1. How numbering works today (unchanged in O1)
* A bill is identified by the **order number** `ORD00001, ORD00002, …` (`utils/orderNumber.js`).
* It comes from one atomic counter document (`counters` collection, `_id: "orderId"`, `$inc`). The first
  time it runs on a database it is seeded from the number of existing orders.
* Numbers are **unique, but gaps are allowed by design**. An order whose transaction aborts skips its number.
* There is no per-financial-year reset and no site/branch prefix.
* The legacy `Invoice` model has an `invoiceNumber` field that is not used as a GST series.

## 2. What the local-primary model changes about numbering
Because the restaurant PC is the **only writer** (decision 1), the counter lives in the local database
and is incremented there only. Inside one restaurant, numbers stay unique offline and online. The existing
atomic counter needs no change. Only these situations need care:

| Situation | Risk | Handling (no code change in O1) |
|---|---|---|
| **Cutover from cloud to local** (doc 09 §6) | A new empty local DB seeds the counter from its own order count (0) and starts at `ORD00001` again, which collides with numbers already issued and printed from the cloud | Cutover must copy the cloud counter value (or all orders) before the first local order. To be part of the cutover checklist. |
| **Restore from backup** | Counter rewinds. Numbers issued after the backup (already on paper bills) are issued again | After any restore, set the counter above the highest number on any printed bill (doc 11 §5.1) |
| **Cloud mirror holding several restaurants** (O6/O7) | `ORD00001` exists at every site | Mirror keys must be `{siteId, orderId}`, never `orderId` alone. Already planned in doc 05 §4 (`{ _id, siteId }`). |
| **Running cloud and local as writers at the same time** | Two counters, so duplicate numbers | Forbidden operationally (doc 11 §5.2) |

## 3. Questions for the accountant (before any change)
1. Does a bill need a **GST invoice serial number** separate from the order number? Indian GST rules
   generally expect invoice serials to be **consecutive and unique within a financial year**. Today's order
   numbers are unique but can have **gaps** (aborted/cancelled orders) and **do not reset** each financial year.
2. Are cancelled orders' numbers acceptable as gaps, or must they be recorded as cancelled invoices?
3. Is a **prefix per outlet** required if the business opens more branches (e.g. `KHO/2026-27/000123`)?
4. Should numbering differ between the online (cloud) product and the Offline Edition? Recommendation: no.
   One rule for both.

If a series is approved later (old plan item O10), it would be minted only on the writer (the PC in local
mode, the cloud in cloud mode) with the same atomic counter pattern, keyed per financial year. It would
also affect online bills if enabled there, which is why it needs its own approval.
