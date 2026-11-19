# Zen OS — Intellectual Property Protection Report

Audit date 2026-11-19 · branch `feature/offline-first` @ `ff0d526` · read-only inspection.
This is a technical and commercial analysis, **not legal advice**. Section 5 lists what a lawyer must draft.

---

## 1. What Zen OS's IP actually is

Ranked by how hard it would be for a competitor to recreate it without your repository:

| Rank | Asset | Where it lives | Why it is valuable |
|---|---|---|---|
| 1 | **Order lifecycle engine**: state machine, role-gated transitions, edit-after-kitchen with stock give-back and change slips, auto-send timer, pay-first flow | `restaurant-server/utils/orderStateMachine.js`, `services/orderService.js` (1,163 lines), `services/payFirstService.js`, `services/kotService.js`, `services/tableSessionService.js` | Months of field-tested rules from real restaurant operation (see the rule density in `CLAUDE.md` §4). This is the product. |
| 2 | **Inventory & costing engine**: per-order atomic deduction inside the KOT transaction, unit conversion, recipe costing, making-cost snapshots, purchase-bill OCR import, V3 ledger | `services/inventoryService.js` (907), `inventoryV3*.js`, `utils/recipeCost.js`, `utils/units.js`, `utils/purchaseImport*.js`, `utils/purchaseBill.js`, `utils/inventoryV3Calculations.js` | Differentiator vs basic POS products; feeds profit insights. |
| 3 | **Pricing/billing**: GST, service charge, AC charge, coupons with audience rules, combined bills, split Cash/Online payments | `utils/pricing.js`, `services/billingService.js`, `combinedBillService.js`, `acServiceCharge.js`, `couponService.js`, `utils/paymentMode.js` | Money correctness; regulatory (GST) fit for India. |
| 4 | **Business insights & staff management**: EBITDA/insights, best-sellers, smart category ordering, attendance/duty history, leave, staff pay & reports | `services/insightsService.js`, `bestSellerService.js`, `smartCategoryService.js`, `categoryOrderingService.js`, `attendanceService.js`, `leaveService.js`, `staffReportService.js`, `employeeService.js` | Upsell/retention features. |
| 5 | **Menu intelligence**: schedules, menu times, sold-out-until-business-day-end, sections, add-ons, menu import parser | `services/menuScheduleService.js`, `menuTimeService.js`, `menuStructureService.js`, `utils/menuSections.js`, `utils/menuAddons.js`, `utils/menuImportParser.js` | Operational nuance. |
| 6 | **Printing reliability design**: idempotent KOT/bill jobs, change slips, disk-persisted reconcile-on-reconnect queue, USB-share and USB_DIRECT drivers, Bengali text-as-image rendering, logo/QR | `print-service/src/queue.js`, `processor.js`, `renderers/*`, `drivers/*`, `textImage.js`; backend `printerController.js`, `printerDeviceService.js` | Hard-won field reliability on cheap Indian thermal printers. |
| 7 | **Data model** | `config/getModels.js` (47 schemas, 44 indexes), `config/inventoryV3Models.js` | Reveals the full feature set. |
| 8 | **Architecture knowledge** | `CLAUDE.md`, `README.md`, `SECURITY_AUDIT.md`, `docs/*`, `discovery/*` | A cloner's shortcut: why things are the way they are, and which mistakes to avoid. Arguably more valuable per byte than the code. |
| 9 | **Admin application** | `admin/src` (223 tracked files; Orders, Inventory, Insights, Employees, Coupons, Offers…) | Largest UI investment; the thing restaurant owners buy. |
| 10 | Customer / Waiter / Kitchen apps | `customer/`, `waiter/`, `kitchen/` | Valuable but more replicable; their value is mostly the backend they talk to. |
| — | Brand & client relationships | `brand.js` per app, `docs/HOTEL_KHOAI_CHANGE_ROUND.md`, `print-service/data/restaurant-profile.json` | Trade name, client list — confidential business information. |

Low-IP / commodity parts: thin controllers and routes, `middleware/sanitizeInput.js`, `validateIds.js`, Vite/PWA config, i18n strings, generic UI components, `print-service/src/drivers/lanDriver.js` (raw TCP 9100), `mockDriver.js`.

---

## 2. Component classification

### 2.1 CORE PROPRIETARY — owner-only, never shared with contractors

| Component | Paths |
|---|---|
| Order engine | `restaurant-server/services/orderService.js`, `payFirstService.js`, `kotService.js`, `tableSessionService.js`, `utils/orderStateMachine.js` (implementation — the **enum values** are an external interface, see 2.4), `utils/orderNumber.js` |
| Pricing & billing | `utils/pricing.js`, `services/billingService.js`, `combinedBillService.js`, `acServiceCharge.js`, `couponService.js`, `couponOfferService.js`, `offerStatsService.js` |
| Inventory & costing | `services/inventoryService.js`, `inventoryV3Operations.js`, `inventoryV3ReadService.js`, `inventoryV3SettingsService.js`, `utils/recipeCost.js`, `utils/units.js`, `utils/inventoryV3Calculations.js`, `utils/inventoryConstants.js`, `utils/purchaseImport*.js`, `utils/purchaseBill.js`, `utils/supplierInput.js`, `scripts/setup-inventory-v3.js` |
| Insights & staff | `services/insightsService.js`, `bestSellerService.js`, `smartCategoryService.js`, `categoryOrderingService.js`, `staffReportService.js`, `attendanceService.js`, `leaveService.js`, `employeeService.js`, `utils/attendanceStateMachine.js` |
| Menu engine | `services/menuScheduleService.js`, `menuTimeService.js`, `menuStructureService.js`, `menuItemService.js`, `categoryService.js`, `utils/menuSchedule.js`, `menuSections.js`, `menuCategories.js`, `menuAddons.js`, `menuImportParser.js`, `scripts/importMenu.js`, `scripts/migrate-khoai.js` |
| Full schema | `config/getModels.js`, `config/inventoryV3Models.js` |
| Admin app | entire `admin/` |
| Knowledge & security docs | `CLAUDE.md`, `SECURITY_AUDIT.md`, `discovery/`, `docs/HOTEL_KHOAI_CHANGE_ROUND.md`, `docs/INVENTORY_V3_ROLLOUT.md`, `docs/inventory-reference.html`, `.claude/agents/`, this audit folder |
| Test suite | `restaurant-server/test/` (64 files — encodes every business rule as executable spec) |
| Anything with client data | `print-service/data/*.json`, `Admin_provider*`, `print-service/client-update-*`, `print-service/release*`, `dist/` |

### 2.2 RESTRICTED — only when essential, only a reviewed extract, time-boxed

| Component | Paths | Who might need it | Share how |
|---|---|---|---|
| Auth & RBAC | `controllers/authController.js`, `middleware/authMiddleware.js`, `rbac.js`, `managerScope.js`, `dutyMiddleware.js`, `utils/roles.js`, `sendOTP.js`, `otpGuard.js`, `guestOrderToken.js`, `firebaseAdmin.js` | Dev A (offline local auth), Dev B (agent enrollment) | **Do not share code.** Give them the *contract*: "send `Authorization: Bearer <JWT>`; roles are …; device enrolls with a printer key". |
| Realtime layer | `sockets/socket.js`, `utils/tenantKey.js` | Dev A, Dev B | Share the **event catalogue** (names, rooms, payload shapes) as an AsyncAPI-style doc, not the file. |
| Payment module | `services/paymentService.js` (273 lines), `controllers/paymentController.js`, `routes/paymentRoutes.js`, `utils/paymentMode.js` | Dev C | The provider-specific half (`initiatePhonePePayment`, `fetchPhonePeStatus`, `verifyCallbackSignature`, `decodeCallback`, `mapPhonePeCode`) is a clean, model-free seam — shareable **as an extract** to define the adapter interface. `applyPhonePeResult` and everything touching `Order` stays core. |
| Print backend | `controllers/printerController.js`, `routes/printerRoutes.js`, `services/printerDeviceService.js` | Dev B | Contract only (`docs/audit/zen-os-android-print-agent-integration-contract.md` already drafts it). |
| Print service | `print-service/src/queue.js`, `processor.js`, `socketClient.js`, `renderers/kotRenderer.js`, `billRenderer.js`, `layout.js`, `textImage.js`, `logo.js`, `payQr.js` | Dev B | Prefer **golden output fixtures** (byte-exact ESC/POS samples + photos of printed slips) over source. If source is needed to match formats, share only `renderers/` + `layout.js`, in a fresh repo, after removing restaurant data. |
| Waiter & Kitchen apps | `waiter/`, `kitchen/` (incl. new `offline/`, `pwa/`) | Dev A | Only if Dev A's phase-2 scope explicitly includes client-side outbox work; otherwise not. |
| Customer app | `customer/` incl. `services/paymentService.js` | Dev C (checkout UX) | Only the checkout/payment-return screens, as an extract, if the owner doesn't wire the UI personally. |

### 2.3 DEVELOPER ACCESSIBLE — safe to share for assigned tasks

| Item | Notes |
|---|---|
| `print-service/src/drivers/lanDriver.js`, `mockDriver.js`, `renderLines.js` | Commodity transport code; useful reference for Dev B. Review for embedded IPs first. |
| `print-service/test/*` fixtures that contain **no** real restaurant data | Show expected output shapes. |
| `waiter|kitchen|admin/src/offline/connectivity.js`, `savedData.js`, `OfflineBanner.jsx`, `pwa/registerPwa.js`, `UpdatePrompt.jsx` | Small, generic; shows Dev A what exists (read-only last-loaded cache + PWA shell). |
| Sanitised `.env.example` files with **placeholder** values | Names of required variables only. |
| Brand-neutral UI tokens, fonts | Commodity. |
| `docs/audit/zen-os-android-print-agent-*.md` | Already written as contractor-facing design/contract docs — **review and strip** any business commentary (executive summary mentions sales positioning) before sharing. |

### 2.4 EXTERNAL INTERFACE — shareable contracts (to be authored by owner)

None of these exist yet as standalone artefacts (no OpenAPI/Swagger file in repo — fact sheet §3). Creating them is the single highest-leverage step for safe collaboration:

| Contract | Content | Consumer |
|---|---|---|
| `enums.json` | Order status / type / payment status / payment method / food type values, exactly as in `utils/orderStateMachine.js` and `utils/foodTypes.js` — **values only, not transitions or role map** | All |
| `openapi/orders.yaml` (subset) | Place order, get order, list open orders, status transition request, idempotency key semantics | Dev A |
| `asyncapi/realtime.yaml` | Socket auth handshake shape; events `order:new`, `order:status_changed`, `order:cancelled`, `kot:created`, `bill:print`, `get-queue` ack; payload schemas (kitchen-safe variants) | Dev A, Dev B |
| `print-contract.md` | Print job JSON shape, `PATCH /admin/printer/kot/:id/status` semantics, job types (`KOT`, `BILL`, change slip-as-KOT), idempotency rules, golden ESC/POS fixtures | Dev B |
| `payment-adapter.d.ts` / `.md` | `initiate`, `checkStatus`, `verifyWebhook`, `decodeWebhook`, `refund`, `mapStatus` → normalized `{state: SUCCESS|FAILED|PENDING, amountPaise, providerTxnId, raw}`; rules: amount always from server, verified-result-only, idempotent apply | Dev C |
| `sync-protocol.md` | Event/outbox envelope, idempotency keys, conflict rules per entity, which fields are server-authoritative (CLAUDE.md rule 2: price, status, source, payment, role, stock) | Dev A |
| Mock/staging API | A deployed **staging** backend with synthetic data that contractors call over HTTPS with test accounts — they consume the API without seeing its code | All |

---

## 3. Modules that should never be shared unless absolutely necessary

1. `services/orderService.js` + `utils/orderStateMachine.js` — the crown jewel.
2. `services/inventoryService.js` + inventory V3 + `utils/recipeCost.js` / `units.js`.
3. `utils/pricing.js` + billing/coupon services.
4. `config/getModels.js` (full schema).
5. `restaurant-server/test/` (executable spec of every rule).
6. `CLAUDE.md`, `SECURITY_AUDIT.md`, `discovery/`.
7. The whole `admin/` app.
8. Anything under `Admin_provider*`, `print-service/data`, `print-service/client-update-*`, real `.env` files.

The hard case is **offline capability (Dev A)**: a true LAN-only mode (waiter → kitchen → printer with the internet down) needs a server running inside the restaurant, and the only server that knows Zen OS's rules is `restaurant-server`. Any design where the contractor builds that server **must** touch items 1–4. See TASK_DISTRIBUTION_PLAN §A for how to stage this so that exposure is late, limited, and contractually covered — or kept with the owner.

---

## 4. What technical controls can and cannot do

| Control | Prevents | Does **not** prevent |
|---|---|---|
| Private repo | Public visibility, search indexing | A collaborator cloning, copying, zipping, uploading to their own server, pasting into AI tools |
| GitHub read-only role (org only) | Pushing | Reading/cloning the **entire repo and its entire history** — there is no per-folder read permission in GitHub |
| Disable forking (org setting) | One-click GitHub forks | `git clone` + push elsewhere |
| CODEOWNERS / branch protection | Unreviewed merges into protected branches | Reading anything |
| Removing a collaborator | Further pulls/pushes; GitHub deletes their **forks** of a private repo | Local clones, copies, backups they already have |
| Separate, history-less extract repos | Exposure of code you never put there | Copying of what you *did* put there |
| Staging API without code | Seeing implementation | Observing behaviour (black-box reverse engineering of API semantics) |
| Watermarks / per-contractor canary strings in extracts | — (nothing) | — but they **prove the source** of a later leak, which matters in court |
| Obfuscation / minification of shared code | Casual reading | A determined reader; also hampers legitimate work — not recommended |

**Conclusion: the only real technical protection is not giving the code in the first place.** For code you must give, protection is **legal** (assignment, confidentiality, restrictions, remedies) plus **evidential** (access logs, watermarking, signed acknowledgements of what was received).

---

## 5. Legal protections (require a properly drafted agreement — consult an Indian IP/contracts lawyer)

Jurisdiction-specific points the lawyer should address (India assumed from the PhonePe/UPI/GST context):

| Topic | Why it cannot be solved technically | Key drafting points |
|---|---|---|
| **IP assignment** | Copyright vests in the **author** by default. Under the Copyright Act 1957 s.17, the employer-owns rule covers employees under a *contract of service*; an **independent contractor** (*contract for service*) is generally the first owner of what they write unless rights are assigned. | Written, signed assignment (s.18–19) of all rights in deliverables, specifying **rights, worldwide territory and full term** — s.19(5)/(6) default an unspecified duration to 5 years and territory to India. Present-tense assignment ("hereby assigns") of future works on creation; moral-rights waiver / non-assertion to the extent permitted (s.57); obligation to execute further documents. |
| **Pre-existing & third-party code** | You can't see what they copied in | Contractor discloses pre-existing IP; grants you a perpetual, irrevocable, royalty-free licence to any of it embedded in deliverables; warranty of no infringement; open-source list with licences (no GPL/AGPL in deliverables without written approval). |
| **Confidentiality / NDA** | Code can be copied once seen | Definition covering source, schemas, API contracts, docs, credentials, client identities, data; survives termination (e.g., 5 years, indefinite for trade secrets and source); return-or-destroy with **signed certificate** at offboarding. |
| **Restrictions on reuse** | No technical control | No use of Confidential Information to build/assist a competing restaurant-management product; no reverse engineering of the staging API; no redistribution; no publication of code (incl. portfolio/GitHub) without consent. Note: post-termination **non-competes are generally void in India** (Indian Contract Act s.27) — rely on confidentiality + non-use, non-solicitation of your clients/staff (narrowly drafted), not a blanket non-compete. |
| **AI-tool clause** | No technical control | Prohibit pasting Confidential Information into third-party AI services except those you approve in writing (and with training/retention disabled). |
| **Personal data** | Can't police their laptop | DPDP Act 2023: you are the Data Fiduciary for diner/employee data; contractors must receive **no** personal data. If unavoidable: data-processing terms, purpose limitation, security, breach notice, deletion. |
| **Security obligations** | — | Use only provided environments; no production access; report any accidental exposure within 24 h; MFA on GitHub; device encryption. |
| **Deliverables & acceptance** | — | Acceptance criteria per milestone (see TASK_DISTRIBUTION_PLAN); payment on acceptance; warranty/bug-fix period (e.g., 60–90 days); source + build instructions + tests as part of every deliverable. |
| **Remedies** | — | Injunctive relief, indemnity for IP infringement and confidentiality breach, liquidated damages only if your lawyer advises they are enforceable. Governing law & courts / arbitration seat. |
| **Termination & offboarding** | — | Immediate access revocation right; handover of all work-in-progress; certificate of deletion; payment for accepted work only. |
| **Subcontracting** | They might hand your code to someone else | No subcontracting or team members without written consent and the same agreement signed by each person. |

Also fix your own house: `restaurant-server/package.json` declares `"license": "ISC"` (a permissive open-source licence) and no app has a `LICENSE` or copyright notice. Recommend (owner action, outside this audit): set `"license": "UNLICENSED"` and `"private": true`, and add a proprietary `LICENSE`/copyright header naming your legal entity in every repo you create for contractors. This removes any argument that the code was offered under ISC.
