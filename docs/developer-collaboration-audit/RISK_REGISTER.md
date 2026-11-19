# Zen OS — Risk Register (developer collaboration)

Audit date 2026-11-19. Likelihood (L) and Impact (I) on 1–5; Rating = L×I (≥15 Critical, 10–14 High, 5–9 Medium, ≤4 Low). "Open" = true today.

| ID | Risk | Evidence | L | I | Rating | Mitigation | Owner | Status |
|---|---|---|---|---|---|---|---|---|
| R01 | Live `PRINTER_KEY` + prod `BACKEND_URL` committed in two zips; anyone with repo access can join the printers room and read every KOT/bill | `Admin_provider.zip`, `print-service/client-update-2026-10-10.zip` | 4 | 5 | **20 Critical** | Revoke/reissue keys now; never share this repo's history; later `git filter-repo` | Owner | Open |
| R02 | Customer names/phones (25 print jobs) committed | `Admin_provider.zip → data/queue.json` | 4 | 4 | **16 Critical** | Same as R01; treat as personal-data incident under DPDP Act (assess; document) | Owner | Open |
| R03 | Contractor copies/reuses full Zen OS source | Personal repo, no path-level read in GitHub | 4 | 5 | **20 Critical** | Never share core; contract-first repos; legal assignment + confidentiality | Owner | Open (mitigated by plan) |
| R04 | Vulnerability report given away | `SECURITY_AUDIT.md` tracked; C2/H6 still open | 3 | 5 | **15 Critical** | Exclude from all extracts; fix open findings first | Owner | Open |
| R05 | Live order data incl. guest phone broadcast to anonymous sockets | `sockets/socket.js:126,342,366,374` | 4 | 4 | **16 Critical** | Remove/strip legacy `tenant` emits | Owner | Open |
| R06 | Contractor push triggers production deploy | Render/Vercel git integration, no branch protection evident | 2 | 5 | 10 High | Contractors never on core; production deploys only from protected `main` | Owner | Open |
| R07 | Personal-account collaborators always get push; no read-only | GitHub personal repos | 3 | 4 | 12 High | Move to Organization | Owner | Open |
| R08 | IP not legally owned by Zen OS (contractor is first author by default) | Copyright Act 1957 s.17–19 | 3 | 5 | **15 Critical** | Written assignment: rights, worldwide, full term; signed before work starts | Owner + lawyer | Open |
| R09 | Code declared ISC-licensed; no proprietary notice | `restaurant-server/package.json` `"license": "ISC"`; no LICENSE files | 2 | 3 | 6 Medium | `UNLICENSED` + proprietary LICENSE in all repos | Owner | Open |
| R10 | Contractor uses production data or accounts "to test quickly" | No staging/seed exists (`seed.js` missing) | 3 | 5 | **15 Critical** | Build staging + synthetic seed before onboarding | Owner | Open |
| R11 | Contractor-held production JWT can't be revoked | No `tokenVersion`; 7–30 day tokens | 2 | 4 | 8 Medium | Never issue production logins; staging uses different `JWT_SECRET` | Owner | Open |
| R12 | Unauthenticated `/api/test-whatsapp/:phone` abused (cost/spam) | `server.js:129` | 3 | 3 | 9 Medium | Delete route | Owner | Open |
| R13 | No CI; failing tests/lint ⇒ regressions from contractor code undetected | fact sheet §7–8 (3 backend tests, admin lint failing) | 4 | 3 | 12 High | Fix tests; add CI; manual review checklist | Owner | Open |
| R14 | Offline sync creates duplicate orders / double stock deduction / divergent totals | Cross-cutting; state machine + transactions in core | 3 | 5 | **15 Critical** | Idempotency keys, hub-authoritative policy, chaos tests (TASK_DISTRIBUTION_PLAN §A) | Dev A + owner | Planned |
| R15 | Offline phase A3 requires core exposure | Architectural | 4 | 4 | **16 Critical** | Owner does A3, or one trusted dev on time-boxed extract after A1/A2 | Owner | Planned |
| R16 | Android printing duplicates/loses KOTs; disturbs current Windows printing | Print queue contract in `print-service/src/queue.js` | 3 | 4 | 12 High | Durable queue keyed by job `_id`; Windows service stays as fallback; per-restaurant opt-in | Dev B + owner | Planned |
| R17 | Payment marked PAID without verified result; double refund; amount from client | Payment contract | 2 | 5 | 10 High | Verified-only, atomic apply stays in core; adapter idempotency tests; server-derived amounts | Dev C + owner | Planned |
| R18 | Contractor commits gateway/sandbox secrets or Android keystore | — | 3 | 3 | 9 Medium | `.gitignore` templates; owner holds release keystore; secret scanning on org | Owner | Planned |
| R19 | Contractor pastes code into third-party AI tools | — | 4 | 3 | 12 High | Contract clause; share less code | Owner + lawyer | Planned |
| R20 | Malicious/vulnerable dependency introduced | Existing `npm audit`: backend 1 critical/6 high; admin 1/16 | 3 | 4 | 12 High | Dependency review in each PR; lockfiles; audit | Owner | Open |
| R21 | Leftover access after engagement | — | 3 | 3 | 9 Medium | Offboarding checklist; access register | Owner | Planned |
| R22 | Owner workstation exposes everything (old copies with `.env` in `D:\Adds_cafe\*`, root zip) via screen-share/remote support | Directory listing | 2 | 5 | 10 High | Never screen-share that folder; clean up obsolete copies; use a separate OS user for contractor calls | Owner | Open |
| R23 | Knowledge concentration (bus factor 1); contractors can't be productive without the owner | 163/171 commits by owner | 4 | 3 | 12 High | Contracts repo doubles as documentation; integration log | Owner | Open |
| R24 | Client confidential info leaked (client name, requirements) | `docs/HOTEL_KHOAI_CHANGE_ROUND.md`, `print-service/data/restaurant-profile.json` | 3 | 3 | 9 Medium | Exclude; use fictional restaurant on staging | Owner | Planned |
| R25 | CORS `*`, no rate limiting/helmet on an API that contractors will hammer on staging and could probe on prod | `server.js:68`; fact sheet §5 | 2 | 3 | 6 Medium | Staging CORS allow-list; rate limiting (hardening backlog) | Owner | Open |
