# 14 — Deployment Architecture

Verified from repo artifacts; hosting dashboards not accessed. Hostnames redacted.

## 1. Current production (inferred from repo — Medium confidence)

```mermaid
flowchart LR
  subgraph Vercel[Vercel - inferred]
    VA[admin]
    VC[customer]
    VW[waiter]
  end
  VK[kitchen - hosting UNKNOWN]
  subgraph Render[Render - inferred]
    API[restaurant-server<br/>single instance, ticks in-process]
  end
  ATL[(MongoDB Atlas<br/>tier/backup UNKNOWN)]
  EXT[Firebase, PhonePe, Twilio/MSG91, Cloudinary, Google]
  subgraph Rest[Restaurant]
    PC[Windows PC<br/>SohojPrintService.exe]
    PR[Printers]
    DEV[Devices]
  end
  DEV --> VA & VC & VW & VK
  DEV -->|HTTPS/WSS| API
  API --> ATL
  API --> EXT
  EXT -->|PhonePe callback| API
  PC -->|outbound WSS| API
  PC --> PR
```

| Element | Evidence | Status |
|---|---|---|
| Render backend | `RENDER_GIT_COMMIT` in `server.js:118` | Inferred |
| Vercel apps | `admin|customer|waiter/vercel.json` | Inferred |
| Kitchen hosting | no config | UNKNOWN |
| Atlas | `mongodb+srv` handling | Inferred |
| Print bridge | `.exe` builds, `Admin_provider/` | Verified |
| CI/CD, Docker, IaC, monitoring | none | ABSENT |

## 2. Offline Edition (LOCAL_PRIMARY) — O1/O2 implemented, installer PLANNED

```mermaid
flowchart TB
  subgraph PC[Restaurant PC - Windows]
    N[Node 22: restaurant-server<br/>DEPLOYMENT_MODE=LOCAL]
    M[(mongod 7 replica set rs0<br/>127.0.0.1 only)]
    S[Static apps<br/>8080 customer, 8081 admin, 8082 waiter, 8083 kitchen]
    P[print-service → localhost]
    N --> M
    N --- S
    P --> N
  end
  LAN[Restaurant Wi-Fi devices] -->|HTTP now, HTTPS O5| S
  LAN --> N
  BK[(USB backup - manual mongodump)] -.-> M
  N -.PLANNED O6/O7.-> CLOUD[Cloud mirror]
```

Setup today: manual (doc 11): install MongoDB as replica set (`scripts/localReplicaSet.js`), `.env` from `local-edition.env.example` (`DEPLOYMENT_MODE, LOCAL_PIN_PEPPER, LOCAL_SITE_ID, …`), build apps, open firewall, first-admin bootstrap code on the PC console. PLANNED O9: WinSW services, bundled Node + Mongo, firewall rules, scheduled backup, updater, recovery kit.

## 3. Environments

| Environment | Exists? | Evidence |
|---|---|---|
| Production cloud | yes (inferred) | |
| Staging | UNKNOWN / not in repo | |
| Local dev | `npm run dev` per app | `CLAUDE.md` Commands |
| Isolated sandbox backend | yes | `scripts/localSandbox.js` (in-memory replica set, console OTP) |
| Second copy on live DB | `DISABLE_BACKGROUND_JOBS=true` | `server.js:207` |

## 4. Configuration (names only)

See `../17-deployment-infrastructure.md` §3 for the full list. Secrets live in `.env` only; restaurant settings live in `RestaurantProfile`; frontends read `public/config.js` at runtime.

## 5. Proposed target deployment (PROPOSED)

```mermaid
flowchart LR
  GH[Git host] --> CI[CI: tests, builds, lint, npm audit, print-service tests]
  CI -->|main only, tagged| R[Render backend]
  CI --> V[Vercel apps incl. kitchen]
  CI --> ART[Artifact store: print-service exe, local edition bundle<br/>NOT in git]
  R --> UP[Uptime probe on /api/health + commit]
  R --> LOG[Structured logs + alerts: print skips, pay-first anomalies, tick failures]
  ATL[(Atlas: verified backups, IP access list)] --- R
```

| Item | Proposal |
|---|---|
| Branch → environment | `main` → production only; feature branches → preview/staging |
| Release record | deployed SHA from `/api/health` captured per release |
| Print-service / local edition distribution | signed artifacts outside git; key provisioning separate from the bundle |
| Backups | Atlas continuous backup verified by a restore drill; local scheduled `mongodump` + off-PC copy (O9) |
| Scaling | stay single instance (sufficient at ~200 orders/day); Redis adapter only if scaling out |
