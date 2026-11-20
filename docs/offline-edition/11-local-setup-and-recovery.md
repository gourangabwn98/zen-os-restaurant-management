# 11 — Local Server Setup and Recovery (Phase O1)

Status: **Phase O1 implemented on `features/offline-edition` — not committed, not deployed.**
Applies to: the restaurant PC running the Offline Edition (`DEPLOYMENT_MODE=LOCAL`).
The cloud deployment is unaffected: with `DEPLOYMENT_MODE` unset nothing in this document runs.

> O1 is a **developer/pilot-bench** setup. The one-click installer, Windows services and
> automatic backup come later (O9). **Since O2, staff sign in with phone + PIN on approved
> devices — no internet needed** (§8, doc 18).

---

## 1. What runs on the restaurant PC

| Component | Port (default) | Reachable from |
|---|---|---|
| MongoDB 7, single-node replica set `rs0` | 27017 | **this PC only** (`bindIp 127.0.0.1`) |
| restaurant-server API + Socket.IO | 5000 (`PORT`) | restaurant Wi-Fi |
| Customer app | 8080 (`LOCAL_PORT_CUSTOMER`) | restaurant Wi-Fi |
| Admin app | 8081 (`LOCAL_PORT_ADMIN`) | restaurant Wi-Fi |
| Waiter app | 8082 (`LOCAL_PORT_WAITER`) | restaurant Wi-Fi |
| Kitchen app | 8083 (`LOCAL_PORT_KITCHEN`) | restaurant Wi-Fi |
| Health page `GET /local/health` | 5000 | **private (LAN) addresses only** |
| print-service | — | unchanged; still points at its configured `BACKEND_URL` (not changed in O1) |

Each app gets its own port because every build uses root paths (`/assets`, `/config.js`, `/sw.js`).
The server generates each app's `/config.js` on the fly. It points the app at port 5000 **on whatever
address the phone used to open the page**, so no IP address is baked into any build.

## 2. Prerequisites

* Windows 10/11 PC that stays on during service hours, on the restaurant's router by **cable** if possible.
* A **fixed LAN IP** for the PC: set a DHCP reservation in the router (preferred), or a static IP.
  Printed table QR codes contain this address (`CUSTOMER_FRONTEND_URL`).
* Node.js 22 LTS (O1 was tested on v22.22.1).
* MongoDB Community Server **7.0** (O1 was tested against mongod 7.0.14).
* This repository with `npm install` done in `restaurant-server/` and in each of
  `admin/ customer/ waiter/ kitchen/`. No new dependency was added in O1.

## 3. One-time setup

### 3.1 MongoDB as a replica set
1. Install MongoDB Community 7.0 with the MSI, "Install as a Service" ticked.
2. Edit `C:\Program Files\MongoDB\Server\7.0\bin\mongod.cfg` (as Administrator):
   ```yaml
   net:
     port: 27017
     bindIp: 127.0.0.1        # never expose the database to the Wi-Fi
   replication:
     replSetName: rs0
   ```
3. Restart the service (Administrator PowerShell): `Restart-Service MongoDB`
4. Initialise the replica set (safe to repeat):
   ```
   cd restaurant-server
   node scripts/localReplicaSet.js            # → "Replica set "rs0" initialised … PRIMARY"
   node scripts/localReplicaSet.js --check    # report only
   ```
   The set is created with the member address `127.0.0.1:27017`, so renaming the PC or changing
   its LAN IP never breaks the replica set.

### 3.2 Server settings
1. Copy `restaurant-server/local-edition.env.example` to `restaurant-server/.env` **on the PC**.
2. Fill in:
   * `JWT_SECRET`: a **new** random value for this restaurant. Never reuse the cloud's.
     `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
   * `FIREBASE_*`: **required**. The server reads the service account at startup and exits without
     one. Reading it needs no internet.
   * `CUSTOMER_FRONTEND_URL` / `CLIENT_URL`: `http://<PC-fixed-IP>:8080`.
3. Leave `DEPLOYMENT_MODE=LOCAL` and the `MONGO_URI` printed by `localReplicaSet.js`.

The server **refuses to start** (exit code 1, message in the log) if:
* `MONGO_URI` is `mongodb+srv://` (Atlas), points at another machine, or has no `replicaSet=`;
* `JWT_SECRET` is missing, or is the public sandbox secret;
* `OTP_DEV_ECHO=true` (it would hand login codes to any phone on the Wi-Fi);
* `DEPLOYMENT_MODE` has an unknown value (a typo is never guessed as cloud or local).

### 3.3 Build the web apps
```
cd admin    && npm run build
cd customer && npm run build
cd waiter   && npm run build
cd kitchen  && npm run build
```
By default the server serves `<repo>/<app>/dist`. For an installed copy, set
`LOCAL_APPS_DIR=C:\ZenOS\apps` with `admin\ customer\ waiter\ kitchen\` inside.
An app with no build is skipped and reported as `not built`. The rest still work.

### 3.4 Windows Firewall
Allow the app and API ports on the **Private** network profile only, and make sure the
restaurant Wi-Fi is marked *Private* in Windows network settings:
```powershell
New-NetFirewallRule -DisplayName "Zen OS Local" -Direction Inbound -Protocol TCP `
  -LocalPort 5000,8080-8083 -Action Allow -Profile Private
```
*(Not exercised in O1 testing. The tests ran on one PC. To be verified at the pilot site.)*

## 4. Start and verify
```
cd restaurant-server
npm start
```
Expected log lines:
```
🏠 Offline Edition: DEPLOYMENT_MODE=LOCAL_PRIMARY
🌐 customer app → http://<this-PC>:8080   (and admin 8081, waiter 8082, kitchen 8083)
🗄  Local MongoDB replica set "rs0" (primary)
```
Check from any phone or PC on the Wi-Fi:
```
http://<PC-IP>:5000/local/health
```

| `status` | HTTP | Meaning |
|---|---|---|
| `ok` | 200 | Database is the replica-set primary, all four apps served, background jobs on |
| `degraded` | 200 | Orders work, but an app isn't served (not built / port busy) or background jobs are off |
| `error` | 503 | Orders **cannot** be saved: DB unreachable, not a replica set, or not primary |

The response never contains the database address, credentials, or any order/customer data.
From a non-private IP it returns 403. In the cloud the route does not exist.

Then open `http://<PC-IP>:8081` (admin), `:8082` (waiter), `:8083` (kitchen), `:8080` (customer).

## 5. Recovery runbook

| Symptom | Cause | Fix |
|---|---|---|
| Health `error`, "Database is not reachable" | MongoDB service stopped / still starting after a reboot | `Get-Service MongoDB`; `Start-Service MongoDB`. **No server restart needed.** It reconnects on the next request (tested: server started before MongoDB, then recovered by itself). |
| Health `error`, "not a replica set" | `replSetName` missing from `mongod.cfg`, or set never initialised | §3.1 steps 2–4 |
| Server exits at start with `⛔ DEPLOYMENT CONFIG:` | A refused setting (§3.2) | Fix the named setting in `.env` |
| Server exits with a Firebase "project_id" error | `FIREBASE_*` blank | Fill in `FIREBASE_*` (§3.2) |
| Health `degraded`, app `failed: port 808x already in use` | Another program owns the port | Change that `LOCAL_PORT_*` in `.env`, restart the server |
| Health `degraded`, app `not built` | No `dist/` for that app | §3.3 |
| Phones can't open any page | Firewall / Wi-Fi marked Public / phone on guest Wi-Fi isolated from LAN | §3.4. Use the main Wi-Fi, not a client-isolated guest network |
| Pages open, but table QR codes open nothing | PC's IP changed; QR codes still carry the old one | Restore the DHCP reservation. If the IP really changed, update `CUSTOMER_FRONTEND_URL` and reprint the QRs (Admin → Tables marks stale QRs) |
| Kitchen/waiter screens stop updating live | Socket.IO blocked | Port 5000 must be open (§3.4). Check `http://<PC-IP>:5000/socket.io/?EIO=4&transport=polling` returns text starting `0{"sid"` |
| PC lost power | — | MongoDB's journal recovers on restart. Start MongoDB, then the server (any order works). Check health. Don't kill `mongod.exe` by hand. |

### 5.1 Backup and restore (manual until O9)
Requires *MongoDB Database Tools* (separate free download from MongoDB).
```
mongodump    --uri="mongodb://127.0.0.1:27017/zen_local?replicaSet=rs0" --gzip --archive=D:\ZenBackup\zen-YYYYMMDD.gz
mongorestore --uri="mongodb://127.0.0.1:27017/?replicaSet=rs0" --gzip --archive=D:\ZenBackup\zen-YYYYMMDD.gz --drop
```
Keep at least one copy **off the PC** (USB drive). Restoring rewinds everything to the backup time.
In particular the order-number counter rewinds, and numbers issued after the backup (already on
printed bills) would be issued again. After any restore, raise the `counters` document `orderId`
above the highest order number on any printed bill before taking orders. See doc 13.

### 5.2 Never run cloud and local as the writer for the same restaurant at once
Until sync (O6/O7, not approved for production) exists, orders written on the PC **stay on the PC**.
Pointing waiters at the cloud and the kitchen at the PC (or switching back and forth) splits the
restaurant's data in two. That is the exact failure CLAUDE.md rule 1 exists to prevent.
A pilot site uses one or the other for a whole service.

## 6. Running the O1 tests
```
cd restaurant-server
node test/deploymentMode.test.js    # 20 pure-logic tests
node test/localBoot.test.js         # 16 end-to-end tests: boots the real server.js on a throwaway
                                    # in-memory replica set (127.0.0.1 only, temp folder, no .env, no secrets)
```

## 7. Known limits of O1 (by design, later phases)
* **A fresh local database has no admin account and no menu.** There is no seed/bootstrap script
  (`npm run seed` points at a `seed.js` that doesn't exist). Creating the first admin, or importing
  the restaurant's existing data, is part of O2 / cutover (doc 09 §6) and needs approval because it
  reads the production database.
* **Customer dine-in ordering over plain HTTP fails**: the browser blocks geolocation outside HTTPS,
  and the server requires a location for customer dine-in. See doc 12 (decision 4).
* PWA install and service workers need HTTPS (doc 12). Over `http://<IP>` the apps work as normal web pages.
* Images still come from Cloudinary (O4). Without internet, menu photos don't load.
* print-service is untouched; its `BACKEND_URL` is not changed in O1.
* No sync to the cloud (O6, mock cloud only, per decision 6).

## 8. Staff sign-in (Phase O2)

Required in `.env` (the server won't start without them): `LOCAL_PIN_PEPPER` (64 random hex chars,
not the JWT secret) and `LOCAL_SITE_ID`. See `local-edition.env.example`.

**First admin (empty database, once).** Start the server. Its window shows `FIRST-TIME SETUP` and a
setup code (valid 2 h, new one on every restart until setup is done). **On the PC itself** open
`http://localhost:8081/setup` and enter the code, the restaurant ID (`LOCAL_SITE_ID`), the restaurant
name, the admin's name, mobile and PIN. That browser becomes the first trusted device.

**A new phone/tablet.** Open the waiter, kitchen or admin app → "Register this device" → it shows a
6-letter code. Admin (or a manager, for waiter/chef devices) → Devices & PINs → type that code,
tick who may use it → Approve. The device moves to the PIN screen by itself.

**A new staff member.** Add them in Employees as usual, then Devices & PINs → Staff PINs → Set PIN
(temporary). Tell them in private. They choose their own PIN at first sign-in.

**Forgotten PIN / locked account.** Staff PINs → Reset PIN. That also unlocks the account and signs
them out everywhere. A lockout otherwise ends by itself (5, then 15, then 60 min).

**Lost or stolen device.** Devices & PINs → Trusted devices → Revoke, with a reason. Everyone on it is
signed out immediately. Its stored credentials are useless from then on.

**Lost PIN pepper.** If `LOCAL_PIN_PEPPER` is lost or changed, no PIN works, including the admin's.
There is no reset tool yet (planned with O9). **Keep a copy of this PC's `.env` with the backups.**

Tests: `node test/localAuth.test.js` (35) and `node test/localBoot.test.js` (23, includes O2 over HTTP).
