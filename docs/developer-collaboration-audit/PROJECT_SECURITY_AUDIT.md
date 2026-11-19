# Zen OS — Project Security Audit (collaboration readiness)

| | |
|---|---|
| Audit date | 2026-11-19 |
| Branch inspected | `feature/offline-first` @ `ff0d526` (working tree, read-only) |
| Remote | `origin` → a private-or-unknown-visibility repository on the owner's **personal** GitHub account (`gourangabwn98/zen-os-restaurant-management`) |
| Method | Static repository inspection, `git ls-files`, `git log --all`, archive listings (`unzip -l`), env-variable **names** only. No secret value was read into this report, no app code was run, nothing was modified. |
| Scope question | "If I give an external developer access to this repository / these environments today, what do they get?" |

Companion reports: [IP_PROTECTION_REPORT](IP_PROTECTION_REPORT.md) · [DEVELOPER_ACCESS_MATRIX](DEVELOPER_ACCESS_MATRIX.md) · [RISK_REGISTER](RISK_REGISTER.md) · [FINAL_CTO_RECOMMENDATION](FINAL_CTO_RECOMMENDATION.md)

---

## 1. Verdict

**The repository is NOT safe to share with any external developer in its current state — not even read-only, not even a single branch.**

Three facts drive that verdict. All three are about **git history**, which every collaborator receives in full on `git clone`, regardless of which branch you tell them to work on:

1. **A live print-service credential is committed.** `Admin_provider.zip` (tracked at repo root, added in the `2026-10-1x` print-service commits) contains `Admin_provider/.env` with a **non-empty `PRINTER_KEY`** and a **non-localhost `BACKEND_URL`**. `print-service/client-update-2026-10-10.zip` contains a second `.env` with a non-empty `PRINTER_KEY`. The root `.gitignore` excludes the `Admin_provider/` *folder* but not the *zip*, so the archive went in. A `PrinterDevice` key authenticates a socket into the `tenant:{key}:printers` room and the print-queue endpoints — i.e., it receives every KOT and bill payload (order items, totals, table, and on bills the guest name/phone).
2. **Real customer data is committed.** The same `Admin_provider.zip` contains `data/queue.json` — a disk-persisted print queue with **25 jobs whose payloads contain customer names and phone numbers** (confirmed by key scan only; values not read). Tracked `print-service/data/restaurant-profile.json` and `payment-qr.json` carry the live restaurant's name, address, phone, UPI ID and payment-QR URL.
3. **A vulnerability roadmap is committed.** `SECURITY_AUDIT.md` (tracked) lists the system's weaknesses, with file and line numbers. Per `discovery/fact_sheet.md` §10 and re-verified today, at least two of its findings are **still open in code** (see §4). Handing that file to a third party hands them an attack plan against your production system.

Deleting these files in a new commit does **not** fix this — they remain in history. See §6 for the required remediation order.

---

## 2. What an external developer would receive from a clone today

| Asset | In repo? | Evidence | Exposure |
|---|---|---|---|
| Complete backend source (23 route files, 27 controllers, 34 services, 32 utils, ~8.2k lines of services alone) | Yes | `restaurant-server/` | Entire business logic — see IP report |
| Full database schema (32+ models) | Yes | `restaurant-server/config/getModels.js`, `config/inventoryV3Models.js` | Complete data model |
| Five frontends (admin 223 files, customer 101, waiter 95, kitchen 50) | Yes | `admin/`, `customer/`, `waiter/`, `kitchen/` | Complete product UI |
| Print service source + **2 compiled .exe builds** + 2 zips | Yes | `print-service/`, `print-service/client-update-*` | Ready-to-run binaries |
| Live `PRINTER_KEY` ×2 + prod `BACKEND_URL` | **Yes, in zips** | `Admin_provider.zip`, `print-service/client-update-2026-10-10.zip` | **Credential leak** |
| Customer names/phones (25 print jobs) | **Yes, in zip** | `Admin_provider.zip → data/queue.json` | **Personal-data leak (DPDP Act 2023)** |
| Restaurant identity + UPI ID | Yes | `print-service/data/restaurant-profile.json`, `payment-qr.json` | Client business data |
| Architecture knowledge base | Yes | `CLAUDE.md` (24 KB), `README.md` | A condensed "how to rebuild Zen OS" guide |
| Vulnerability report | Yes | `SECURITY_AUDIT.md` | Attack roadmap |
| Client-specific change log | Yes | `docs/HOTEL_KHOAI_CHANGE_ROUND.md` | Client name + their requirements |
| AI-agent definitions | Yes | `.claude/agents/*.md` (6 files) | Your internal QA/review process |
| Real `.env` files | **No** (gitignored, never committed in any branch — verified with `git log --all --diff-filter=A`) | `restaurant-server/.env`, `admin/.env`, `customer/.env`, `waiter/.env`, `print-service/.env` | Safe in git; **exposed only if the working folder itself is shared** |
| Backend `.env.example` | Yes | Every historical version checked: placeholders only (`<user>`, `replace…`) | Safe |
| Firebase **web** API key | Yes | `customer/public/firebase-messaging-sw.js` | Public-by-design client identifier — not a secret. Still identifies your **production** Firebase project. |
| CI/CD secrets | **None exist** | No `.github/`, no workflow files | Nothing to leak — but also no automated gate (see §5) |
| Deployment config | Partial | `admin|customer|waiter/vercel.json` (SPA rewrites only), Render referenced in docs/comments | No credentials; reveals hosting topology |

**Not in the repo but on the same workstation** (`D:\Adds_cafe\`): `Restaurant-Management-System.zip`, older copies `restaurant-server/`, `print-service/`, `sohoj-customer/`, `waiter-app/`, `Sojoj os admin frontend/` (each has its own `.env` file), `ZenOS-Android-Printer/` (Gradle project, not a git repo), `business-docs/`. Never share this parent folder, a screen-share of it, or a zip of it.

---

## 3. Production credential inventory (names only)

Backend `restaurant-server/.env` / `.env.example`:

| Variable | What it unlocks | Severity if leaked |
|---|---|---|
| `MONGO_URI` | Entire production database: all orders, customers (phones), employees, payments, inventory | **Critical** |
| `JWT_SECRET` | Forge a token for **any** user incl. admin (HS256, 7-day staff / 30-day customer tokens, no revocation — `authController.js:245,414`) | **Critical** |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | Firebase Admin SDK: mint auth tokens, read/modify all Firebase users, send FCM pushes to all customers | **Critical** |
| `PHONEPE_MERCHANT_ID`, `PHONEPE_SALT_KEY`, `PHONEPE_SALT_INDEX`, `PHONEPE_ENV` | Sign PhonePe requests/forge callbacks as your merchant | **Critical** |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE`, `TWILIO_WHATSAPP_FROM` | Send SMS/WhatsApp billed to you, as you | High |
| `MSG91_AUTH_KEY`, `MSG91_SENDER_ID`, `MSG91_TEMPLATE_ID` | Same, MSG91 | High |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Upload/delete all menu images | Medium |
| `CLIENT_URL`, `CUSTOMER_FRONTEND_URL`, `PUBLIC_API_URL` | Not secret — topology | Low |

Print service `print-service/.env`: `BACKEND_URL`, **`PRINTER_KEY`** (High — reads every print payload), plus tuning flags.
Frontends (`VITE_*`): Firebase web config, reCAPTCHA site key, API URL — **all public by design** (they ship in the browser bundle), but they point at **production** projects, so a developer must never get the production `.env` "to get started quickly".

Platform accounts that hold or bypass the above (not visible in repo; owner must audit): MongoDB Atlas org/project, Firebase/Google Cloud project IAM, Render (backend env vars + deploy hooks), Vercel (3 projects' env vars, preview deployments), PhonePe merchant dashboard, Twilio/MSG91 consoles, Cloudinary console, GitHub account, the domain registrar/DNS.

---

## 4. Production exposure that exists *independently* of repo access

These matter because every external developer will legitimately use the customer/waiter apps and the API while working.

| ID | Finding | Evidence (today) | Why it matters for collaboration |
|---|---|---|---|
| S-1 | **Full order objects incl. guest name/phone broadcast to the anonymous `tenant` room** (SECURITY_AUDIT C2, still open) | `restaurant-server/sockets/socket.js:342,366,374` — `emit(rooms.tenant(...), "new-order" / "order-status-updated" / "order-rejected", order)`; every socket, including an unauthenticated guest, joins `rooms.tenant` at `socket.js:126` | Anyone who opens a production customer URL with devtools can watch live orders and customer phones. A contractor debugging sockets will see this on day one. **Fix before onboarding Developer A (offline/sockets).** |
| S-2 | **Unauthenticated `GET /api/test-whatsapp/:phone`** (SECURITY_AUDIT H6, still open) | `restaurant-server/server.js:129` | Anyone can make your Twilio account message an arbitrary number — cost + reputation abuse. |
| S-3 | CORS `origin: "*"` | `server.js:68-69` | Any website can call the API from a victim's browser (mitigated by bearer tokens in localStorage, not cookies). |
| S-4 | No HTTP rate limiting, no `helmet`, no OTP *verify*-attempt limit | `discovery/fact_sheet.md` §5, §10; only `utils/otpGuard.js` (5 sends/hour) | Brute-force surface on staff OTP login. |
| S-5 | JWT without revocation, 7–30 day lifetime | `authController.js:245` (30d), `:414` (7d); no `tokenVersion` | If a contractor is ever issued a **production** staff/admin token (e.g., "log in to check something"), you cannot revoke it without rotating `JWT_SECRET` for everybody. → Never give contractors production accounts. |
| S-6 | Dependency vulnerabilities | `discovery/fact_sheet.md` §9: backend 1 critical / 6 high; admin 1 critical / 16 high | Not a collaboration blocker, but contractors will run `npm install` on these trees. |
| S-7 | Public payment callback has no JWT by design | `routes/paymentRoutes.js:25`; protected only by `X-VERIFY` checksum (`paymentService.verifyCallbackSignature`) | Correct design — but means `PHONEPE_SALT_KEY` is the *only* thing protecting "mark this order PAID". Never share it. |

Positive findings (keep them): real `.env` files never committed; backend `.env.example` history clean; `config/securityCheck.js` refuses to start without `JWT_SECRET` and never prints values; printer keys stored hashed (`services/printerDeviceService.js:13`, SHA-256); C1 admin-login bypass fixed (`authController.js` `verifyIdToken`); OTP echo gated to non-production; `sanitizeInput` strips `$` operators; multi-tenant header resolution removed (`dbFromHeader` now always uses `MONGO_URI` — `middleware/authMiddleware.js:94`); payment idempotency via atomic `applyPhonePeResult`.

---

## 5. Collaboration-specific attack surface

| Vector | Current state | Risk |
|---|---|---|
| **Personal-account repository** | `origin` is on a personal account | GitHub personal-account private repos have **no read-only collaborator role** — an invited collaborator gets push access. Fine-grained roles (Read/Triage/Write/Maintain) need an **Organization**. |
| **Push = production deploy** | Render/Vercel appear git-integrated (fact sheet §2, §11); no CI, no branch protection visible | A collaborator who can push to `main` (or whichever branch Render/Vercel track) deploys to the live restaurant. |
| **Vercel preview deployments** | Not inspectable from repo | If Preview-environment variables in Vercel equal production values, any pushed branch builds with them. Frontend vars are public anyway, but this pattern must not extend to any future server-side Vercel function. |
| **No test/CI gate** | No `.github/`; 3 backend tests failing on this branch (fact sheet §7); admin lint failing | You cannot rely on automation to catch a contractor's regression; review is 100% manual today. |
| **Binaries in git** | `.exe` + zips (~120 MB) | A contractor-supplied binary could be swapped in silently; and these binaries contain the key above. |
| **Knowledge docs** | `CLAUDE.md`, `SECURITY_AUDIT.md`, `discovery/*`, `docs/audit/*` | These are higher-value to a would-be cloner than much of the code. |
| **AI tooling** | `.claude/agents/` committed | Contractors using cloud AI assistants will paste your code into third-party services. Address contractually (see legal section of IP report). |

---

## 6. Mandatory remediation BEFORE any external access (ordered)

These are owner actions. This audit did not perform any of them.

1. **Revoke and reissue the leaked printer keys** — Admin → Printer devices (`DELETE /api/admin/printer/devices/:id`, `POST /api/admin/printer/devices`), update the restaurant PC's `.env` on-site. Treat both committed keys as compromised regardless of repo visibility.
2. **Confirm the repo is private** and review **who already has access** (GitHub → Settings → Collaborators) and any deploy keys / GitHub Apps (Vercel, Render) installed on it.
3. **Do not share this repository's history with anyone, ever.** Rather than rewriting history (risky on a live repo; old clones keep the data anyway), create **new, history-less repositories** from reviewed extracts for contractors (see REPOSITORY_ISOLATION_STRATEGY). If you later want this repo itself cleaned, use `git filter-repo` to remove `Admin_provider.zip`, `print-service/client-update-*`, `print-service/data/*.json`, then force-push and have every holder re-clone — a deliberate, separately planned operation.
4. Fix S-1 (strip PII from / remove the legacy `tenant`-room emits) and S-2 (delete `/api/test-whatsapp`) — both small, and both are things a contractor would otherwise discover on day one.
5. Rotate any credential that has ever been pasted into chat, email, a screen-share or a shared drive. If unsure, rotate `JWT_SECRET` (logs everyone out), Firebase service-account key, PhonePe salt key, Twilio auth token, Cloudinary secret, Atlas DB user password.
6. Stand up the isolated development environment (DEVELOPMENT_ENVIRONMENT_STRATEGY) **before** onboarding — contractors must never be told "use production for now".
7. Move the repository into a GitHub Organization owned by your business entity (REPOSITORY_ISOLATION_STRATEGY §3).

---

## 7. Items explicitly not verified (owner to check)

- Actual GitHub visibility, existing collaborators, deploy keys, installed GitHub Apps (the `gh` CLI is not installed here).
- Render and Vercel dashboards: which branch auto-deploys, who has team access, Preview env values.
- Atlas network access list (is it `0.0.0.0/0`?), DB users and their roles, backup settings.
- Firebase IAM members and number of service-account keys.
- Whether the committed `PRINTER_KEY` values are still active in the production `PrinterDevice` collection.
- Contents of `ZenOS-Android-Printer/` and `business-docs/` (outside this repo; not inspected).
