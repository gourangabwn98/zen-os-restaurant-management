# Zen OS — Contractor Onboarding & Offboarding Checklist

Use one copy per contractor. Tick each item; keep the completed copy with the signed agreement.

Contractor: ________________ · Task: A / B / C · Start: ________ · Planned end: ________

## Phase 0 — Owner readiness (once, before the first contractor)

- [ ] Leaked printer keys revoked/reissued; PROJECT_SECURITY_AUDIT §6 items done
- [ ] GitHub Organization created, owned by the business; 2FA required; base permission *None*; private forking disabled
- [ ] `zen-os-core` access list = owner only; Render/Vercel apps reviewed
- [ ] Staging backend, staging Atlas project, staging Firebase project, synthetic seed ready
- [ ] `zen-os-contracts` v0.1 published
- [ ] Legal templates reviewed by a lawyer (NDA, services agreement with IP assignment, data/confidentiality schedule, offboarding certificate)

## Phase 1 — Before any information is shared

- [ ] Identity verified (government ID, PAN/GST if invoicing, address)
- [ ] References / portfolio checked
- [ ] **NDA signed** before the detailed brief is sent
- [ ] Services agreement signed: scope, milestones, acceptance criteria, payment on acceptance, **written worldwide full-term IP assignment**, pre-existing IP disclosure + licence, open-source rules, no subcontracting, AI-tool clause, security obligations, return/destroy + certificate, governing law
- [ ] If the contractor is a company: every individual who will see material signs an individual confidentiality + assignment undertaking
- [ ] Contractor's GitHub account confirmed, with 2FA enabled
- [ ] Contractor acknowledges in writing: no production access, no real data, report accidental exposure within 24 h

## Phase 2 — Access provisioning (least privilege)

- [ ] Invite as **outside collaborator**: Write on their own repo, Read on `zen-os-contracts`, nothing else
- [ ] Branch rules on their repo verified (PR + owner approval, no force-push, owner-only merge)
- [ ] Staging test logins created **per contractor** (named, so audit fields attribute actions)
- [ ] Task-specific: staging printer-device key (B) / gateway sandbox arrangement (C) / mock server access (A)
- [ ] Any extract repo created from a reviewed, history-less copy; canary marker recorded privately
- [ ] Access register updated: what was shared, when, which version/commit

## Phase 3 — Kickoff

- [ ] Brief walkthrough: contracts, staging, acceptance criteria, how to submit (PR + tag request)
- [ ] Coding standards shared (no secrets in code, `.env` untracked, tests required, no new heavy dependencies without approval)
- [ ] Communication channel agreed (no code or credentials over WhatsApp/email; use the repo)
- [ ] Milestone dates confirmed in writing

## Phase 4 — During the engagement (each milestone)

- [ ] PR reviewed by owner: diff read fully, dependencies checked (`npm audit` / Gradle deps), no secrets, no telemetry/network calls to unknown hosts, licences of new dependencies acceptable
- [ ] Tests run by owner locally/CI; acceptance criteria demonstrated on staging
- [ ] Owner tags the accepted commit; payment released for that milestone
- [ ] GitHub audit log / access log reviewed for unexpected clones or activity
- [ ] Integration into core done by owner on an owner-only branch, from the tagged commit

## Phase 5 — Offboarding (same day the engagement ends or on any breach)

- [ ] Final deliverable tagged; all work-in-progress pushed to the org repo (no "I'll send the rest later")
- [ ] Remove from all repos (outside collaborator removal); confirm GitHub forks gone
- [ ] Revoke staging logins, staging printer-device key, mock-server tokens
- [ ] Contractor deletes/rotates their gateway sandbox keys; owner rotates any keys the owner issued
- [ ] Rotate the staging `JWT_SECRET` if the contractor ever held an admin-role staging token (cheap: staging only)
- [ ] If the contractor ever touched anything production (should never happen): rotate every affected production secret immediately
- [ ] Signed **certificate of return/deletion** of all Confidential Information (repos, extracts, docs, notes, AI-tool histories)
- [ ] Final IP assignment confirmation / further-assurance signature for all delivered work
- [ ] Final invoice settled only after the above
- [ ] Access register closed with date
