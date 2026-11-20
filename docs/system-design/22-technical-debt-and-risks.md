# 22 — Technical Debt, Risks and Open Questions

Status legend: [01 §2](01-project-overview.md#2-status-legend-used-in-every-document). Severity: Critical / High / Medium / Low. All items verified by reading code unless marked otherwise. No values of secrets were read or reproduced.

## 1. Risk register

| ID | Severity | Risk | Evidence | Recommendation (not implemented) |
|---|---|---|---|---|
| R-01 | **Critical** | A `PRINTER_KEY` is committed to git twice: `Admin_provider.zip` → `Admin_provider/.env` and `print-service/client-update-2026-10-10.zip` → `client-update-2026-10-10/.env`. The same zip also contains `data/queue.json` with 11 print jobs carrying `customerName`/`customerPhone`. Anyone with repo access can connect as a printer: receive every KOT/bill payload (incl. customer PII) and report fake `PRINTED` statuses. | `git ls-files`; zip entry listing (names only) | Revoke those `PrinterDevice` keys in Admin → printers and issue new ones; remove the archives; decide (owner approval needed) whether to purge history. |
| R-02 | **High** | Legacy socket events send the **full order document** (guest name/phone, payment status, totals) to the `tenant` room, which **every anonymous socket joins**. No frontend listens to these events. (Prior audit item C2, still open.) | `sockets/socket.js:159` (all join tenant), `:414` `new-order`, `:438` `order-status-updated`, `:446` `order-rejected` | Delete the legacy emits (`new-order`, `order-status-updated`, `order-rejected`, and the unused staff-room `order-approval-request`, `kot-print`, `bill-print`). |
| R-03 | **High** | Unauthenticated `GET /api/test-whatsapp/:phone` sends a WhatsApp message (Twilio cost, spam) to any number. (Prior H6, still open.) | `server.js:151-160` | Remove the route. |
| R-04 | High | In cloud mode the socket handshake does not reject `status: Inactive` staff; a deactivated waiter with an unexpired JWT (7 days) can still join the `staff` room and receive all order/PII events. REST is protected. | `sockets/socket.js:108-109` (check only when `localMode`) | Apply the Inactive check in both modes; disconnect sockets on deactivation. |
| R-05 | High | Sessions: HS256 JWT, 7 days (staff) / 30 days (customer, admin OTP), in `localStorage`, no refresh, no revocation list in cloud mode (only per-request `User.status`). | `authController.js:244-245, 412-422` | Shorter tokens + `tokenVersion`, or server sessions. |
| R-06 | High | No CI, no automated gate before deploy; branch `main` is behind; several features exist only on unmerged branches; what is in production is unknown. | absence of `.github/workflows`; `discovery/fact_sheet.md` §0 | Add CI running backend tests + app builds; record deployed SHA. |
| R-07 | Medium | Employee OTP: generated with `Math.random`, stored in an in-process `Map` (lost on restart, not shared across instances); send limit and verify-try limit are per process. Phone enumeration via 403/200 on `check-phone`/`send-otp`. | `authController.js` `waiterSendOTP`, `waiterVerifyOTP`; `utils/otpGuard.js` | `crypto.randomInt`; DB/TTL store; uniform responses. |
| R-08 | Medium | No `helmet`, no global rate limit, CORS `origin:"*"`, no `trust proxy`. | `server.js:89-107` | Add headers, origin allow-list, limiter on auth/order routes. |
| R-09 | Medium | Print jobs not printed within **30 min are auto-SKIPPED** (backend `AUTO_EXPIRE_MINUTES=30` and print-service `MAX_JOB_AGE_MINUTES=30`). A long printer/PC outage silently drops KOTs from paper (kitchen screen still shows them). | `services/printerDeviceService.js:93`; `print-service/src/config.js:48` | Alert staff when jobs are skipped; make the window a setting. |
| R-10 | Medium | `placeOrderTx` opens the table session **before** `Order.create` and links it after, outside a transaction → a failed insert can leave a table OCCUPIED with no order. | `services/orderService.js:327-331, 397, 411-413` | Wrap in a transaction or compensate. |
| R-11 | Medium | Single-process real time: no Socket.IO adapter; in-process ticks and rate limiters. Horizontal scaling breaks live push (print-service has a 5 s poll fallback; apps do not). | `sockets/socket.js` (no adapter), `server.js` ticks | Stay single-instance, or add Redis adapter. |
| R-12 | Medium | Offline Edition: nothing in code prevents the cloud and a LOCAL PC both writing the same restaurant; rule is procedural only. | `docs/offline-edition/11-…` §5.2 | Site lock / cloud write guard (planned in doc 05 §4). |
| R-13 | Medium | No backup automation (cloud: UNKNOWN Atlas config; local: manual `mongodump`, restore rewinds order counter). Lost `LOCAL_PIN_PEPPER` = all PINs reset, no tool yet. | doc 11 §5.1; doc 18 §5 | O9 backup/recovery kit. |
| R-14 | Medium | Unknown routes return **500** instead of 404. Raw `err.message` returned to clients. | `middleware/errorMiddleware.js` | Set 404 in `notFound`. |
| R-15 | Medium | `Invoice` model is legacy: `orderType` default `"Dining"` (old vocabulary), `paymentMethod` enum lacks `Both`, lowercase status enum. Reports that read it can disagree with `Order`. | `config/getModels.js:919-940`; `controllers/invoiceController.js:35` | Confirm whether still used; align or retire. |
| R-16 | Low | Public profile endpoint returns the whole `RestaurantProfile` (incl. `printerIps`, staff policy). | `routes/profileRoutes.js:29-43` | Return a public projection. |
| R-17 | Low | Kitchen room: admins do not join it (docs say admin + chef); kitchen app has dead listeners (`order:confirmed`, `employee:attendance:updated`). | `sockets/socket.js:162` | Align doc or code. |
| R-18 | Low | Firebase Admin init crashes the server without `FIREBASE_*` even offline. | `utils/firebaseAdmin.js`; doc 10 finding 3 | Lazy init. |
| R-19 | Medium | Delivery fee and packing charge are configurable in Admin → Profile (`deliveryBaseFee`, `deliveryFeePerKm`, `freeDeliveryAbove`, `packingCharge`) but **no code applies them** — admins may believe customers are charged. | grep: no readers outside the schema | Implement in `utils/pricing.js` or remove from the UI (P-05). |
| R-20 | Medium | Two print bridges connected at once (two PCs, or a second key) both receive every job → double printing; no routing/lease. | `socket.js` printers room broadcast | Document single-bridge rule; lease protocol before multi-agent (doc 20). |

## 2. Technical debt

* **Docs drift:** `CLAUDE.md`/`README.md` say customers may order as guests — code requires login (`orderService.js:174-180`). README names a `backend/` folder, "no payment gateway", missing `seed.js`. `CLAUDE.md` role list omits `inventory_manager`, `staff`, `delivery` in the rules section and omits `delivery-app/` from the repo map. Comments in `orderStateMachine.js` header and `orderService.autoSendDueOrders` / `server.js:243` still say stock/KOT happen at confirmation or that auto-send is "conditional on PENDING_CONFIRMATION" (it is `CONFIRMED`).
* **Legacy code kept:** `Chef` model, `chefRoutes.js`, `ChefsPage.jsx`, commented-out old auth in `authController.js`, legacy socket events, `bcryptjs` import unused.
* **Dependency drift:** admin on React 19/Vite 8/router 7, others on 18/5/6; server-only packages in admin; `npm audit` criticals/highs in several apps (fact sheet §9, 2026-11-19).
* **Copied constants** across apps (status labels, i18n) — rename risk described in `CLAUDE.md`.
* **Tests:** 2–3 pre-existing backend test failures on this branch (dining-radius fixtures, menuStructure); frontend tests minimal; no coverage.
* **Binaries in git:** `.exe` (~85 MB each), zips, `debug.keystore`, Excel lock file `~$03_…xlsx`.
* **Inline `autoAuth`** duplicated in 6 route files.

## 3. Open questions (unresolved — not guessed)

| ID | Question |
|---|---|
| Q-01 | Offline scope: the requirement says only waiter/admin/manager + bill printing offline; approved doc 02 also keeps kitchen/KOT, inventory, customer Wi-Fi ordering and in-house delivery. Which is authoritative? Should anything be **disabled** offline? |
| Q-02 | Which commit/branch is deployed to production backend and each frontend? Is kitchen hosted, and where? |
| Q-03 | Is guest (no-login) customer ordering intentionally removed in the cloud, or only pending O3? |
| Q-04 | Atlas tier, backup schedule, network access list, region? |
| Q-05 | Will PhonePe issue V1 or V2 credentials? Refund handling until G10? |
| Q-06 | Is the `Invoice` collection still used for anything financial? |
| Q-07 | Android print agent: approved to proceed, and which printer models? |
| Q-08 | Should the leaked printer keys be rotated and git history purged (needs owner approval)? |

## 4. Second-pass audit (performed)

| Check | Result |
|---|---|
| Missing modules | Found and added modules absent from `CLAUDE.md`'s map: `delivery-app/`, `Admin_provider/` (+ tracked zip), `discovery/`, `.claude/agents/`, `local/` |
| Planned features labelled implemented | Re-checked: sync, O3–O11, PhonePe V2/refunds, Android agent, GST series all labelled PLANNED/PROPOSED; delivery and O1/O2 labelled "branch/uncommitted" |
| Incorrect assumptions corrected | `Order.user` is the caller (staff for staff orders), not null; OTP verify attempts **are** capped (correction to `discovery/fact_sheet.md` H2); delivery/packing charges confirmed unused (was UNKNOWN); delivery job enum confirmed |
| Conflicting documentation | Guest ordering (docs vs code); admin in kitchen room (docs vs code); offline scope (requirement vs doc 02); stale comments in `orderStateMachine.js`, `autoSendDueOrders`, `server.js:243`; README outdated |
| Undocumented dependencies | Firebase required at boot even offline; Tesseract language download; Google keys; PowerShell/GDI+ for print text |
| Security / consistency / printing / sync risks | Captured as R-01…R-20 |
| Links and redaction | All relative links in the package resolve; no secrets, phone numbers, IPs, domains or remote URLs reproduced |

## 5. Incomplete investigation (this audit)

Not done: running tests/builds (results quoted from 2026-11-19/20 reports), live production checks, exhaustive per-call frontend→API tracing, full reading of every controller (inventory V3, insights, staff HR read at export level only), `npm audit` re-run, delivery-app native code review beyond file inventory.
