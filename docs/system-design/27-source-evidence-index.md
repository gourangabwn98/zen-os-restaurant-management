# 27 — Source Evidence Index

Paths are relative to the repo root; line numbers refer to the audited working tree (2026-11-20) and will drift. "Read" = file read in full or in the cited range during this audit.

## Backend core
| ID | Claim | Evidence |
|---|---|---|
| E-SRV-01 | Middleware order, CORS `*`, sanitize, health with `RENDER_GIT_COMMIT` | `restaurant-server/server.js:89-120` (read) |
| E-SRV-02 | Unauthenticated WhatsApp test route | `server.js:151-160` |
| E-SRV-03 | LOCAL-only mounts, static apps, bootstrap announcer | `server.js:164-191, 359-381` |
| E-SRV-04 | Background ticks and intervals | `server.js:203-344` |
| E-CFG-01 | Single DB connection cache | `config/db.js` (read) |
| E-CFG-02 | Deployment mode + local URI rules | `config/deploymentMode.js` (read) |
| E-CFG-03 | Startup security checks | `config/securityCheck.js`, `config/localModeCheck.js` (read) |
| E-MDL-01 | All cloud schemas, indexes, model registry | `config/getModels.js` (read 1–1243) |
| E-MDL-02 | Delivery schemas | `config/deliveryModels.js` (read) |
| E-MDL-03 | Inventory V3 schemas (`autoIndex:false`) | `config/inventoryV3Models.js` (read) |
| E-MDL-04 | Local auth schemas | `config/localAuthModels.js` (read) |
| E-AUTH-01 | protect / optionalProtect / dbFromHeader | `middleware/authMiddleware.js` (read) |
| E-AUTH-02 | RBAC helpers, role sets | `middleware/rbac.js`, `utils/roles.js` (read) |
| E-AUTH-03 | JWT lifetimes 30 d / 7 d | `controllers/authController.js:244-245, 412-422, 777-780` |
| E-AUTH-04 | OTP in-memory, Math.random, tries cap | `authController.js` `waiterSendOTP`, `waiterVerifyOTP` (read 395-500) |
| E-AUTH-05 | OTP send guard | `utils/otpGuard.js` (read) |
| E-AUTH-06 | LOCAL login gates | `local/staffLoginGate.js`, `local/lanOnly.js` (read) |
| E-MW-01 | sanitize, rate limit, manager scope, duty, errors | `middleware/*.js` (read) |
| E-ERR-01 | 404 → 500 | `middleware/errorMiddleware.js` (read) |

## Orders & payments
| ID | Claim | Evidence |
|---|---|---|
| E-ORD-01 | State machine, role map, admin override, PAID-before-COMPLETED | `utils/orderStateMachine.js` (read) |
| E-ORD-02 | Login required to place | `services/orderService.js:174-180` |
| E-ORD-03 | Table session opened before insert, outside txn | `orderService.js:322-331, 397, 411-413` |
| E-ORD-04 | Initial status rules, payload | `orderService.js:340-391` |
| E-ORD-05 | sendToKitchenTx transaction | `orderService.js:462-513` |
| E-ORD-06 | confirmOrderTx, holdUntil | `orderService.js:522-556, 441-444` |
| E-ORD-07 | autoSendDueOrders (stale comment) | `orderService.js:558-589` |
| E-BIL-01 | settleBills atomic write | `services/billingService.js:55-140` (read) |
| E-KOT-01 | KOT/change slip creation, 11000 handling | `services/kotService.js` |
| E-PAY-01 | PhonePe V1 hosts, signing, constant-time verify, amount check, final states | `services/paymentService.js:33-121, 280-380` |
| E-PAY-02 | PHONEPE_ENV parsing | `utils/phonePeEnv.js` (read) |
| E-PAY-03 | Payment methods, pay-first window 15 min, split | `utils/paymentMode.js` |
| E-PAY-04 | V2/refund gaps | `docs/phonepe-integration/INTEGRATION_GAP_ANALYSIS.md`, `V2_IMPLEMENTATION_PLAN.md` (read) |
| E-INV-01 | `$gte` deductions, stockDeducted flag, alerts | `services/inventoryService.js:123-306` |
| E-DEL-01 | Delivery statuses | `utils/deliveryStateMachine.js:21-33` |
| E-DEL-02 | Delivery fees not used | grep of `deliveryBaseFee|deliveryFeePerKm|freeDeliveryAbove|packingCharge` → no readers |

## Real time & printing
| ID | Claim | Evidence |
|---|---|---|
| E-RT-01 | Handshake, rooms, client events, emitters | `sockets/socket.js` (read 1–618) |
| E-RT-02 | Inactive not checked in cloud handshake | `socket.js:108-109` |
| E-RT-03 | Legacy tenant emits (PII) | `socket.js:408, 414, 438, 446, 469, 480` |
| E-RT-04 | Admin not in kitchen room | `socket.js:160-164` |
| E-RT-05 | Frontend listeners | grep `.on("…")` in `admin|customer|waiter|kitchen|delivery-app/src` |
| E-PRN-01 | Durable queue contract | `print-service/src/queue.js` (read) |
| E-PRN-02 | Reconnect, poll, report | `print-service/src/socketClient.js`, `src/index.js:92-107` |
| E-PRN-03 | Role-only routing | `print-service/src/printerManager.js:38-42` |
| E-PRN-04 | Retry/age config | `print-service/src/config.js:44-71` |
| E-PRN-05 | Bengali GDI+ raster | `print-service/src/textImage.js:1-40` |
| E-PRN-06 | 30-min auto expiry backend | `services/printerDeviceService.js:93-99` |
| E-PRN-07 | Leaked printer keys + PII in committed zips | `git ls-files`; `unzip -l` / names-only grep of `Admin_provider.zip`, `print-service/client-update-2026-10-10.zip` |

## Frontends & offline
| ID | Claim | Evidence |
|---|---|---|
| E-FE-01 | Versions | `*/node_modules/*/package.json` |
| E-FE-02 | Routes/pages/services | `*/src/App.jsx`, `*/src/pages`, `*/src/services` |
| E-FE-03 | Access filter | `admin/src/utils/access.js` (read) |
| E-FE-04 | Interceptors, localStorage tokens | `*/src/services/api.js` |
| E-OFF-01 | Read-only IndexedDB cache, connectivity probe | `waiter/src/offline/*.js` (read; identical in admin, kitchen) |
| E-OFF-02 | No outbox / RxDB | grep `outbox|rxdb|pouchdb|dexie|backgroundSync` |
| E-OFF-03 | Offline Edition status | `docs/offline-edition/02, 05, 07, 10, 11, 18, 19` (read/skimmed) |
| E-OFF-04 | Mode-gated code locations | grep `isLocalPrimary|localServer` |

## Repo, deployment, prior audits
| ID | Claim | Evidence |
|---|---|---|
| E-REPO-01 | Tracked binaries/archives | `git ls-files` |
| E-REPO-02 | Branches | `git branch -a` |
| E-REPO-03 | No CI/Docker | absence of `.github/workflows`, `Dockerfile` |
| E-DEP-01 | Vercel configs | `admin|customer|waiter/vercel.json` |
| E-DEP-02 | Env names | `restaurant-server/.env.example`, `local-edition.env.example`, `print-service/.env.example` (names only) |
| E-PRIOR-01 | Earlier test/build/audit results | `discovery/fact_sheet.md`, `SECURITY_AUDIT.md`, `docs/delivery/04-…` |
| E-AND-01 | Android print agent design only | `docs/audit/*` (summary + architecture read; contract/roadmap headings) |
