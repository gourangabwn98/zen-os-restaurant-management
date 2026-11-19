# Zen OS — Repository Isolation Strategy

Audit date 2026-11-19. Read with [DEVELOPER_ACCESS_MATRIX](DEVELOPER_ACCESS_MATRIX.md).

## 1. The facts that constrain the design

1. **This monorepo cannot be partially shared.** GitHub has no path-level read permission. Anyone with Read on `zen-os-restaurant-management` can clone all six apps and **all history on all branches** (`main`, `dev`, 5 feature branches), including `Admin_provider.zip` with a live `PRINTER_KEY` and customer data (see PROJECT_SECURITY_AUDIT §1).
2. **The repo is on a personal account.** Personal-account repositories offer only "collaborator" access, which includes **push**. There is no read-only collaborator, no teams, no org-level fork policy, no org audit log.
3. **CODEOWNERS and branch protection control merging, not reading.** On private repositories, enforced branch protection/rulesets and required CODEOWNERS reviews need a paid plan (GitHub Pro for personal accounts, GitHub Team for organizations — confirm current plan terms).
4. **Revocation is not retrieval.** Removing someone stops future pulls and deletes their GitHub forks of a private repo; it does not delete their local clones.
5. **Deployments are coupled to git.** Backend on Render, frontends on Vercel (per fact sheet §2). Write access to a tracked branch = production deploy.

Therefore: **contractors get new repositories that contain only what their task needs, created from scratch (no history), inside an organization, with the owner as the only merger. The core monorepo stays owner-only.**

## 2. Options evaluated

| Option | Code exposure | Dev efficiency | Integration effort for owner | Verdict |
|---|---|---|---|---|
| Add contractors to the existing repo (private) | **Total** incl. secrets in history | High | Low | **Reject** |
| Same repo, ask contractors to use only one branch/folder | Total (honour system) | High | Low | **Reject** — not a control |
| Git submodules inside core, contractor has access to submodule only | Low (only submodule) | Medium | Medium | Acceptable for B/C later; adds tooling friction |
| Fork of core with sensitive files deleted | **Total** — history carries everything | High | Medium | **Reject** |
| Fresh "extract" repo with selected files copied (no history) | Only what you copy | Medium–High | Medium | **Use** when code context is truly required |
| Feature-specific repos built **against contracts + staging API** | Near zero | Medium (needs good contracts) | Medium | **Primary model** |
| Packaged deliverable (npm package / Android app / library) consumed by core | Near zero | High once contract set | Low–Medium | **Primary delivery format** |
| Black-box API-only work (contractor calls staging, never sees code) | Zero code | Good for B and C, poor for A | Low | Use for B, C |

## 3. Recommended structure

```
GitHub Organization: <your-business-name>  (owned by your legal entity's account, 2FA required)
│
├── zen-os-core                 PRIVATE · owner only · = today's monorepo, transferred in
│                               (transfer keeps history; still never shared)
├── zen-os-contracts            PRIVATE · all contractors READ · owner MAINTAIN
│   ├── enums/                  order status, type, payment status/method, food type (values only)
│   ├── openapi/                orders subset, printer endpoints, payments endpoints
│   ├── asyncapi/               socket handshake + events + kitchen-safe payload schemas
│   ├── print/                  job JSON schema + golden ESC/POS fixtures + photos of slips
│   ├── payment/                adapter interface + normalized result + rules
│   ├── sync/                   outbox envelope, idempotency, conflict rules
│   └── mock-server/            optional tiny mock implementing contracts (owner-built)
│
├── zen-os-offline-sync         PRIVATE · Dev A WRITE (PR-only) · owner merges
├── zen-os-android-print-agent  PRIVATE · Dev B WRITE (PR-only) · owner merges
└── zen-os-payment-adapter      PRIVATE · Dev C WRITE (PR-only) · owner merges
```

Each contractor repo:
- Starts empty with a proprietary `LICENSE` (copyright your entity, "all rights reserved"), `CODEOWNERS` (`* @owner`), `README` with the task brief, `.gitignore` covering `.env*`, `*.jks`, `*.keystore`, `local.properties`, `google-services.json`.
- Contains **no secrets** and **no real data**; contractors keep sandbox keys in an untracked local `.env`.
- Has **no** Vercel/Render/Play Console integration. Building/publishing to production is owner-only.
- May get **owner-approved CI** (lint + unit tests) with no repository secrets.
- Optional: a unique **canary string** per contractor in any extract you copy in (e.g., a distinctive comment or constant), recorded privately, to prove provenance if code later appears elsewhere.

Settings at org level: base permission *No permission*; forking private repos *disabled*; members cannot create public repos; outside-collaborator invitations owner-only; require 2FA; enable audit log streaming/export if your plan allows.

## 4. Per-developer isolation verdict

| Developer | Can it be isolated? | How |
|---|---|---|
| **B — Android printing** | **Yes, fully.** | It's a separate client that speaks a contract: authenticate with a device key → receive `kot:created` / `bill:print` (or pull queue) → render ESC/POS → print → `PATCH` status. The backend contract is already drafted in `docs/audit/zen-os-android-print-agent-integration-contract.md`. Dev B needs the contract, golden receipt fixtures, a staging printer-device key and test printers — no Zen OS source. If byte-exact parity is hard, share `renderers/` + `layout.js` as an extract. |
| **C — Payments** | **Yes, mostly.** | `services/paymentService.js` already separates provider calls (pure HTTP+crypto) from order application (`applyPhonePeResult`). Dev C builds a **gateway adapter package** implementing a fixed interface (initiate, status, verify webhook, decode webhook, refund, map status) for the chosen provider(s), tested against the provider sandbox with no Zen OS models. Owner wires it into `paymentService`/`paymentController` and keeps the "verified-result-only, atomic apply" rule in core. Reconciliation reports are built by owner (they read `Order`). |
| **A — Offline/sync** | **Only partially.** | Real LAN-only operation means a server inside the restaurant that enforces the same rules as `restaurant-server` (state machine, pricing, stock deduction, KOT idempotency). That is core IP. Isolate what can be isolated: phase A1 (architecture + sync protocol + generic sync engine/outbox library + conflict tests against a mock), contract-only. Phase A2 (wiring into the backend/apps) is either done by the owner or by one trusted developer on a **time-boxed extract** under signed IP assignment. See TASK_DISTRIBUTION_PLAN §A. |

## 5. How code comes back into Zen OS (without giving access to Zen OS)

```
Contractor repo (their PR)  ──review──►  owner merges to contractor-repo main
          │                                         │
          │                              owner tags release vX.Y.Z
          ▼                                         ▼
   CI: lint + tests on contracts          owner pulls the tagged artefact into zen-os-core
                                          (one of the three methods below) on an owner-only
                                          integration branch → runs core tests + builds →
                                          staging deploy → acceptance → main → production
```

Integration methods (owner chooses per deliverable):

| Deliverable | Method into core |
|---|---|
| Payment adapter (Node) | Private npm package via GitHub Packages, *or* vendored copy into `restaurant-server/services/gateways/<provider>/` by the owner, from a specific reviewed tag. Pin by version/commit. |
| Sync engine library | Same as above (vendored into backend and/or frontends). |
| Android print agent | Not merged into core at all — it's a separate app. Core only gets the (owner-written) backend changes the contract needs. Owner builds and signs the APK with the **owner's** signing key (contractor never holds the release keystore). |
| Contract changes | Proposed as PRs to `zen-os-contracts`; owner approves. |

Rules: never `git merge` a contractor repo's history into core; never add a contractor repo as a remote of core; never let a contractor-built binary go to production without the owner building it from reviewed source.

## 6. Branch & review rules for `zen-os-core` (owner workflow)

Even as sole developer, adopt now so contractor code lands safely:
- Default branch protected; work on `integration/<feature>` branches; PR into `dev` then `main`.
- Disconnect Render/Vercel auto-deploy from any branch contractors could ever influence; deploy production only from `main`.
- Add a minimal CI (backend `test/*.test.js`, frontend `npm run build`, admin lint) — CLAUDE.md already defines these as the correctness gate. Currently 3 backend tests and admin lint fail on this branch (fact sheet §7–8): fix them first so CI is meaningful.
- Remove binaries/zips from future commits; publish print-service builds as GitHub **Releases** in a private repo instead.
