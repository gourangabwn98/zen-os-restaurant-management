# Zen OS — Development Environment Strategy

Audit date 2026-11-19. Goal: contractors can build and test against a realistic Zen OS **without any path to production systems, credentials or data.**

## 1. Environment tiers

| Tier | Who | Backend | Database | Auth | Payments | Printing | Data |
|---|---|---|---|---|---|---|---|
| **Production** | Restaurants, owner | Render (prod service) | Atlas **prod project** | Firebase **prod project** | Live gateway keys | Restaurant PC print-service, live `PRINTER_KEY`s | Real |
| **Staging** (shared, owner-operated) | Contractors via API only; owner | Render **separate service** (or a cheap VPS) running `restaurant-server` from an owner-chosen commit | Atlas **separate project**, own cluster (M0/M10 replica set — transactions need a replica set) | Firebase **separate project** `zen-os-staging` with Firebase **test phone numbers** (no real SMS) | PhonePe UAT / gateway sandbox keys only | Staging printer-device keys; `USE_MOCK_PRINTER=true` or bench printers | **Synthetic only** |
| **Contractor local** | Each contractor on own machine | Their own repo; mock server from `zen-os-contracts` or the staging URL | None, or local Mongo for their own component | — | Their own sandbox account | Their own test printers | Synthetic |
| **Owner local** | Owner | `restaurant-server` | Local MongoDB replica set or a personal Atlas dev project | Dev Firebase | Sandbox | Mock / bench | Synthetic |

**Separate Atlas *project*, not just a separate database on the prod cluster** — Atlas users and network access are per project; a DB user scoped to a staging DB on the prod cluster is one misconfiguration from prod.

## 2. Credentials per tier

| Variable (backend) | Production | Staging | Rule |
|---|---|---|---|
| `MONGO_URI` | prod project user | staging project user (readWrite on staging DB only) | Never shared with contractors either way — they use the HTTP API |
| `JWT_SECRET` | prod value | **different** random 64+ chars | Different secret ⇒ staging tokens are useless in prod |
| `FIREBASE_*` | prod service account | staging project service account | Separate GCP project ⇒ no IAM overlap |
| `PHONEPE_*` / new gateway | live | UAT/sandbox | `config/securityCheck.js` already warns if PhonePe is configured but `PHONEPE_ENV` isn't PROD in production — mirror this check for any new gateway |
| `TWILIO_*`, `MSG91_*` | live | **unset** | `utils/sendOTP.js` auto-falls back to the console provider; set `OTP_DEV_ECHO=true` on staging only (it is ignored when `NODE_ENV=production`) |
| `CLOUDINARY_*` | prod | separate account or staging-only folder/upload preset | |
| `DISABLE_BACKGROUND_JOBS` | false | as needed | Lets the owner pause timers during tests |
| `INVENTORY_V3_ENABLED` | per rollout | true/false as testing requires | |

Frontend `VITE_*` for staging: point at staging API + staging Firebase web config. Host on separate Vercel projects (or a static host) **not** linked to the production Vercel team's env vars.

Secrets storage for the owner: a password manager vault per environment (prod vault never opened during contractor sessions), not `.env` files emailed or zipped. Remove the stray copies under `D:\Adds_cafe\*` (old app folders each holding an `.env`) once confirmed obsolete.

## 3. Synthetic data

There is no seed today: `npm run seed` points at `seed.js`, which does not exist (fact sheet §3). The owner (not a contractor — it requires the schema) should create a staging seed script producing:

- 1 restaurant profile with a **fake** name/address/UPI ID (e.g., `test@upi`), GST + service-charge settings matching real config patterns.
- ~40 menu items across all sections/add-ons/schedules; recipes and inventory items with costs.
- 12 tables, dining areas.
- Test users: 1 admin, 1 manager, 2 waiters, 2 chefs, 3 customers — phone numbers from Firebase's **fictional test-number** list, never real numbers.
- Orders in every status (`AWAITING_PAYMENT` … `CANCELLED`), with KOT/bill jobs and a change slip.
- 1 staging `PrinterDevice` per contractor that needs one.

Never copy production dumps to staging. If a production bug requires real-shaped data, export only the needed documents and **irreversibly anonymize** names, phones, addresses, UPI IDs and free-text notes first (owner-only task).

## 4. Network & access

| Control | Setting |
|---|---|
| Staging Atlas network access | Only the staging backend's egress IP (and owner's IP); no `0.0.0.0/0` |
| Staging API | Public HTTPS is fine (contractors need it); add basic rate limiting; staging-only CORS origins |
| Production Atlas | Verify it is restricted to Render's egress and owner IPs; verify no contractor-known DB user exists |
| Staging accounts for contractors | Per-contractor test logins (so actions are attributable in `buildActor` audit fields) |
| Admin staging account | Owner only — contractors get admin-role test logins only if their task needs admin screens, and even then on staging |
| Printer staging keys | One per contractor; revoke at offboarding via Admin → Printer devices |

## 5. Per-developer kit

| Developer | Gets | Does not get |
|---|---|---|
| A — Offline | `zen-os-contracts`, staging URL, waiter/chef/manager test logins, staging Firebase web config, a local network test rig plan (owner may supply a spare router + mini-PC) | DB connection strings, backend source (phase A1) |
| B — Android printing | Contracts + golden fixtures, staging URL, staging printer-device key, test printers (58 mm + 80 mm, LAN + BT + USB — buy, don't lend restaurant hardware), the Android design docs (reviewed) | Restaurant's `PRINTER_KEY`, restaurant PC, print-service source by default |
| C — Payments | Contracts (adapter interface, normalized result, rules), staging URL, customer test logins, gateway sandbox access (their own sandbox account preferred), the 5 extracted provider functions | Live gateway keys, merchant dashboard, `Order` model, `applyPhonePeResult` |

## 6. Production-change discipline

- Contractors never deploy. Owner deploys: staging first, test with synthetic data, then production.
- Production-impacting changes for printing must not disturb the existing Windows print-service: the Android agent is introduced as an *additional* device type behind a per-restaurant setting, with the Windows service as fallback (matches the roadmap in `docs/audit/zen-os-android-print-agent-implementation-roadmap.md` phases 4–5).
- Payment changes: keep the manual UPI/cash path and `PATCH /admin/orders/:id/payment` untouched; ship a new gateway behind a profile flag, sandbox first, then a ₹1 live test by the owner.
