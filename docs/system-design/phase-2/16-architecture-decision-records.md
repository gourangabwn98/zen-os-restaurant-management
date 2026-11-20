# 16 — Architecture Decision Records

Format: Context · Decision · Consequences · Status · Evidence. **Accepted** = recorded in code/`CLAUDE.md`/approved docs. **Proposed** = not decided; listed so the owner can decide. Nothing here changes a decision.

---

### ADR-001 Single-restaurant mode, one database
**Context:** header/slug tenant resolution caused apps to read/write different databases. **Decision:** every request uses `MONGO_URI`; tenant code removed. **Consequences:** simple and safe; one deployment per restaurant; scaling to many restaurants means many deployments. **Status:** Accepted. **Evidence:** `CLAUDE.md` rule 1, `middleware/authMiddleware.js`.

### ADR-002 Server is authoritative for price, status, source, payment, role, stock
**Decision:** never trust these from clients. **Consequences:** offline client-side writes impossible by design. **Status:** Accepted. **Evidence:** `CLAUDE.md` rule 2, `utils/pricing.js`.

### ADR-003 Strict order state machine with role map
**Decision:** all transitions via `orderStateMachine.js`; admin override = flag only. **Status:** Accepted.

### ADR-004 Kitchen send = one transaction (PREPARING + stock + KOT)
**Context:** stock moved without tickets when split. **Decision:** `sendToKitchenTx` at edit-window end. **Status:** Accepted.

### ADR-005 Idempotent jobs via unique indexes and atomic conditional updates
**Decision:** KOT unique per order; change slips per revision; never `save()` on job status. **Status:** Accepted.

### ADR-006 On-premises print bridge with device key, disk queue and pull reconciliation
**Decision:** Windows service; share-copy for USB; `usb` for WinUSB; no `printer` addon. **Consequences:** Windows dependency; one PC SPOF. **Status:** Accepted.

### ADR-007 Verified-only payments
**Decision:** PAID only via checksum-verified gateway result or staff action; amount must match; final states. **Status:** Accepted.

### ADR-008 Role-scoped Socket.IO rooms; PII-stripped kitchen room
**Status:** Accepted. **Note:** legacy tenant emits contradict it (R-02) — see ADR-P03.

### ADR-009 Explicit-action duty; append-only duty history
**Status:** Accepted.

### ADR-010 OTP provider auto-detection
**Status:** Accepted.

### ADR-011 Offline Edition = local-primary single writer; cloud read-only mirror
**Context:** offline invariants require one writer. **Alternatives:** device-local queues (rejected), multi-master (rejected). **Status:** Accepted (approved), O1 implemented. **Evidence:** `docs/offline-edition/02`, doc 10 decision 1.

### ADR-012 Staff PIN login on approved devices in LOCAL mode
**Status:** Accepted, O2 implemented. **Evidence:** doc 18.

### ADR-013 Local HTTPS via restaurant CA; customer QR may stay HTTP with signed table tokens
**Status:** Accepted (approved 2026-11-20), not implemented. **Evidence:** doc 12, doc 19 §0.

### ADR-014 Browser cache is read-only
**Status:** Accepted. **Evidence:** `offline/savedData.js` header.

### ADR-015 Home delivery: COD custody ≠ payment; atomic accept; riders not staff
**Status:** Accepted, implemented on branch. **Evidence:** `CLAUDE.md` Home delivery.

### ADR-016 Customers must log in to place orders
**Status:** Implemented without a recorded rationale; conflicts with docs → **OD-2**.

### ADR-017 Production cloud sync
**Status:** **Not approved** (doc 10 decision 6).

### ADR-018 GST invoice series per site
**Status:** Deferred (doc 13).

---

## Proposed ADRs (for decision)

### ADR-P01 Offline scope: Restricted (R1) vs Full (F)
**Context:** BR-16 vs doc 02. **Options:** F; R1 (local-primary + server-side capability gate); R2 failover (not recommended — two writers). **Recommendation:** R1 if the restricted requirement stands, with KOT printing included. **Status:** Proposed (OD-1). **Detail:** [11](11-offline-architecture-comparison.md).

### ADR-P02 Capability gate module for offline restrictions
**Decision proposed:** one module computes allowed capabilities from server-side connectivity probe; route guards return `OFFLINE_RESTRICTED`. **Status:** Proposed (depends on ADR-P01).

### ADR-P03 Remove legacy socket events
**Decision proposed:** delete six legacy emits; no listeners exist. **Status:** Proposed.

### ADR-P04 Rotate printer keys and stop committing build artifacts
**Status:** Proposed (OD-3).

### ADR-P05 CI as the deploy gate; record deployed SHA
**Status:** Proposed.

### ADR-P06 Session hardening (short tokens + revocation)
**Status:** Proposed.

### ADR-P07 Print job lease and station routing before multiple bridges/agents
**Status:** Proposed (from `docs/audit/*-integration-contract.md`).

### ADR-P08 Android print agent, LAN first, Windows kept in parallel
**Status:** Proposed (OD-7).

### ADR-P09 PhonePe API version switch (V1 default, V2 when credentials issued) + refunds
**Status:** Planned in `docs/phonepe-integration/` (OD-5).

### ADR-P10 Single source for enums/labels across apps
**Status:** Proposed.

### ADR-P11 Payment attempt history collection
**Status:** Proposed.
