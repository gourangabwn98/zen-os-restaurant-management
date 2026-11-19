# Zen OS — Final CTO Recommendation

Audit date 2026-11-19 · based on read-only inspection of `feature/offline-first` @ `ff0d526`, full git history, and archive listings. No code, config, branch or deployment was changed. No secret values were read into these reports.

---

## 1. Overall project exposure risk

**Today: HIGH → CRITICAL if any contractor is given repository access.**

- The repository's **history** contains a live print-device credential and real customer phone numbers (inside `Admin_provider.zip` and `print-service/client-update-2026-10-10.zip`). The real `.env` files were never committed, and the backend `.env.example` history is clean.
- A committed `SECURITY_AUDIT.md` documents weaknesses, and two of them are still open in production code: order data with guest PII goes to anonymous sockets (`sockets/socket.js:342/366/374`), and `/api/test-whatsapp/:phone` is unauthenticated (`server.js:129`).
- The repo sits on a personal GitHub account. Collaborators there always get push access, and there is no CI or visible branch protection, while hosting deploys from git.
- No developer agreement, proprietary licence notice or staging environment exists yet. `restaurant-server/package.json` even declares `ISC`.

After the prerequisites in §9 are done, exposure drops to **LOW–MEDIUM**. What remains is limited to what you deliberately put in each contractor's repo, and it's covered by contract.

## 2. What can safely be shared

- **Contracts you write**: order status/type/payment enum *values*, API subsets (OpenAPI), socket event catalogue (AsyncAPI), print-job schema with golden ESC/POS fixtures, a payment-adapter interface and a sync-protocol draft.
- **A staging API** with synthetic data and per-contractor test logins.
- **Low-IP extracts**, reviewed and copied without history: `print-service/src/drivers/lanDriver.js`, `mockDriver.js`; the frontends' `src/offline/*` and `src/pwa/*` helpers; the five PhonePe provider functions from `services/paymentService.js` (for Dev C only); the Android print-agent design docs in `docs/audit/` after redaction (for Dev B only).
- `.env.example` files containing placeholders only.

## 3. What must remain private

`zen-os-core` as a whole, with its history, plus specifically:
- `services/orderService.js`, `utils/orderStateMachine.js` (the transitions and role map), `payFirstService`, `kotService`, `tableSessionService`
- `utils/pricing.js` and the billing and coupon services
- `inventoryService` and Inventory V3, `recipeCost`, `units`
- insights and staff services
- the menu engine
- `config/getModels.js`
- `restaurant-server/test/`
- the whole `admin/` app
- `CLAUDE.md`, `SECURITY_AUDIT.md`, `discovery/`, client docs
- `.claude/`
- every zip, `.exe` and `print-service/data` file
- all real `.env` files and all production dashboards

## 4. Recommended GitHub collaboration structure

Create an organization owned by your business. Transfer this repo in as **`zen-os-core`** (owner-only). Then add:
- **`zen-os-contracts`**: every contractor gets Read.
- **One new repo per contractor**: `zen-os-android-print-agent`, `zen-os-payment-adapter`, `zen-os-offline-sync`. Each starts empty, carries a proprietary LICENSE, and has CODEOWNERS = you, PR-only merges, merges by you only, no deploy integrations and no secrets.

Org settings: base permission None, private forking disabled, 2FA required. Branch protection and required CODEOWNERS review on private repos need a paid plan (GitHub Team for orgs).

## 5. Exact permissions per developer

| | Dev A (Offline) | Dev B (Android print) | Dev C (Payments) |
|---|---|---|---|
| `zen-os-core` | **None** | **None** | **None** |
| `zen-os-contracts` | Read | Read | Read |
| Own repo | Write (PR-only) | Write (PR-only) | Write (PR-only) |
| Staging API | Waiter/chef/manager test logins | 1 staging printer-device key | Customer + staff test logins |
| Sandbox/hardware | Mock server, LAN rig | Owner-bought test printers | Their own gateway sandbox account |
| Production anything | None | None | None |

## 6. Separate repos vs API-based development

Use both. Contractors work in **separate repositories** and develop **against contracts and the staging API**. Fit per task:
- **Dev B (printing)**: fully API-based. The Android agent is a separate client and never needs Zen OS source.
- **Dev C (payments)**: package-based. They build a gateway adapter behind a fixed interface, and you wire it into `paymentService`. The rule "only a verified result may mark PAID, applied atomically" stays in core.
- **Dev A (offline)**: only partially isolatable. Real LAN-only operation needs a local server enforcing Zen OS rules, and that server is core IP. Hire Dev A for **architecture, the sync protocol and a generic sync engine** (A1/A2, contract-only). Do **A3 integration yourself**, or give it to one proven, contracted developer on a time-boxed, history-less extract.

## 7. How you receive code without giving full access

1. The contractor opens a PR in their own repo.
2. You review it and merge it there, then tag a release.
3. You bring that tag into `zen-os-core` on an owner-only integration branch, using one of:
   - a private npm package
   - a vendored copy (into a folder such as `services/gateways/<provider>/`)
   - for the Android agent: nothing enters core except the backend changes you write. You build and sign the APK yourself with your own keystore.
4. Never merge contractor git history into core, and never add their repo as a remote of core.

## 8. How to review and merge independently

- **Per PR**: read the full diff. Check that new dependencies and their licences are acceptable, that there are no secrets and no calls to unknown hosts, and that tests are included. Run the tests yourself.
- **Per milestone**: run the demo on staging against the acceptance criteria in TASK_DISTRIBUTION_PLAN. Pay only after acceptance.
- **Into core**: first make CI meaningful. Fix the 3 failing backend tests and the admin lint errors, then add CI running `restaurant-server` `test/*.test.js`, `npm run build` for each frontend, and admin lint. After that, integrate the contractor tag on a branch, deploy to staging, verify, then promote to `main`. Production deploys only from protected `main`.

## 9. Step-by-step: onboarding

1. **This week, owner only**:
   - Revoke and reissue both printer keys and update the restaurant PC.
   - Check repo visibility and the collaborator list.
   - Fix the PII socket broadcast and delete `/api/test-whatsapp`.
   - Rotate any secret that was ever shared informally.
2. **Create the GitHub org.** Transfer the repo in as `zen-os-core`, enable 2FA, disable private forking, upgrade the plan for branch protection.
3. **Build staging**:
   - separate Atlas project
   - separate Firebase project with test phone numbers
   - separate Render service and Vercel projects
   - a different `JWT_SECRET`
   - PhonePe UAT
   - SMS providers unset (console OTP)
   - a synthetic seed script
4. **Write `zen-os-contracts` v0.1**: enums, print contract and fixtures, payment adapter interface, event catalogue, sync draft.
5. **Legal**: have a lawyer finalise the NDA and a services agreement with a written worldwide, full-term IP assignment (Copyright Act s.18–19), confidentiality, a non-use clause (not a non-compete), an AI-tool clause, no subcontracting, a DPDP data clause, acceptance and payment terms, and a return/destroy certificate.
6. **Per contractor**: verify identity, then sign the NDA, then send the brief, then sign the agreement. After that, invite them as an outside collaborator to their repo plus the contracts repo, issue staging logins and keys, and record everything in the access register (see CONTRACTOR_ONBOARDING_CHECKLIST).
7. **Start with Dev B** (most isolated), then Dev C, then Dev A phase A1.

## 10. Step-by-step: offboarding

1. Tag the final accepted commit, with all work-in-progress pushed to your org repo.
2. Remove the contractor from all repos and confirm their GitHub forks are gone.
3. Revoke their staging logins, printer-device key and tokens. Have them delete their sandbox keys, and rotate any keys you issued. Rotate the staging `JWT_SECRET` if they held an admin-role token.
4. Get the signed return/deletion certificate and the final IP-assignment confirmation.
5. Settle the final invoice only after steps 1–4.
6. Close the access-register entry, and review the org audit log for their last activity.

## 11. The practical strategy in one paragraph

Keep Zen OS's brain (the order engine, pricing, inventory, schema, admin app and architecture docs) in an owner-only repository that no contractor ever clones. Turn the boundaries between Zen OS and each new feature into written contracts plus a staging API with fake data. Give each contractor an empty, owned-by-you repository for their component, review and merge their work there, and pull only reviewed, tagged releases into Zen OS yourself. Back every engagement with a lawyer-drafted written IP assignment and confidentiality agreement, because technical controls only limit what a developer sees, while the contract is what makes what they build yours. And before anyone is invited, rotate the credentials already sitting in git history.

---

**Report index:** [PROJECT_SECURITY_AUDIT](PROJECT_SECURITY_AUDIT.md) · [IP_PROTECTION_REPORT](IP_PROTECTION_REPORT.md) · [DEVELOPER_ACCESS_MATRIX](DEVELOPER_ACCESS_MATRIX.md) · [REPOSITORY_ISOLATION_STRATEGY](REPOSITORY_ISOLATION_STRATEGY.md) · [DEVELOPMENT_ENVIRONMENT_STRATEGY](DEVELOPMENT_ENVIRONMENT_STRATEGY.md) · [TASK_DISTRIBUTION_PLAN](TASK_DISTRIBUTION_PLAN.md) · [CONTRACTOR_ONBOARDING_CHECKLIST](CONTRACTOR_ONBOARDING_CHECKLIST.md) · [RISK_REGISTER](RISK_REGISTER.md)

*Legal points are a technical summary to brief your lawyer, not legal advice.*
