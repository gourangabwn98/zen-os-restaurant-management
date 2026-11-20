# Infrastructure Architecture Brief — Zen OS

## Production (CLOUD_PRIMARY) — hosting inferred from repo config
| Element | Platform | Evidence | Status |
|---|---|---|---|
| Backend (single instance, in-process ticks) | Render | `RENDER_GIT_COMMIT` read in `server.js` | Inferred |
| admin, customer, waiter | Vercel | `vercel.json` SPA rewrites | Inferred |
| kitchen | — | no hosting config | UNKNOWN |
| Database | MongoDB Atlas | `mongodb+srv` handling | Inferred |
| Print bridge | Windows PC at the restaurant | `.exe` builds | Verified |
| Rider app | Android phones | Gradle project; distribution UNKNOWN | — |
| CI/CD, Docker, IaC, monitoring, alerting | none | — | ABSENT |
| Backups | Atlas config not in repo | — | UNKNOWN |

## Offline Edition (LOCAL_PRIMARY) — O1/O2 implemented, uncommitted
Restaurant PC (Windows): Node 22 running the same backend with `DEPLOYMENT_MODE=LOCAL`; MongoDB 7 single-node replica set bound to 127.0.0.1; four web apps served on ports 8080 (customer), 8081 (admin), 8082 (waiter), 8083 (kitchen); print bridge pointing at localhost; `/local/health` (LAN only). Startup refuses remote/`+srv`/non-replica-set URIs, the sandbox JWT secret, OTP echo, and a missing/short PIN pepper. Setup is manual today; installer, Windows services, scheduled backups and recovery tools are PLANNED (O9). Plain HTTP on the LAN until O5 (PLANNED).

## Configuration (names only)
Backend: `MONGO_URI, JWT_SECRET, FIREBASE_*, CLOUDINARY_*, TWILIO_*, MSG91_*, PHONEPE_ENV, PHONEPE_MERCHANT_ID, PHONEPE_SALT_KEY, PHONEPE_SALT_INDEX, PUBLIC_API_URL, CLIENT_URL, CUSTOMER_FRONTEND_URL, TZ, INVENTORY_V3_ENABLED, GOOGLE_ROUTES_API_KEY, DISABLE_BACKGROUND_JOBS, MONGO_DNS_SERVERS, OTP_DEV_ECHO`. LOCAL: `DEPLOYMENT_MODE, LOCAL_PIN_PEPPER, LOCAL_SITE_ID, LOCAL_SESSION_HOURS, LOCAL_PORT_*, LOCAL_APPS_DIR`. Frontends: `VITE_API_URL, VITE_FIREBASE_*, VITE_GOOGLE_MAPS_KEY` + runtime `public/config.js`. Print bridge: `BACKEND_URL, PRINTER_KEY, MAX_ATTEMPTS, MAX_JOB_AGE_MINUTES, …`. Restaurant settings (GST, UPI, edit window, delivery policy) live in the database, not env.

## Network
All clients connect outbound to the backend; the print bridge dials out (no inbound port at the restaurant). PhonePe calls the backend's public callback URL. CORS currently allows any origin.

## Single points of failure
Cloud backend; restaurant internet (cloud mode); the print PC; the restaurant PC in LOCAL mode; Firebase/SMS for logins in cloud mode.

## PROPOSED target
CI gate (tests, builds, lint, dependency audit) → main-only production deploys → deployed SHA recorded; build artifacts (print bridge, local bundle) distributed outside git; uptime probe and structured logs with alerts; verified Atlas backups with a restore drill; scheduled local backups; stay single-instance (adequate for ~200 orders/day) unless scaling requires a Redis Socket.IO adapter.
