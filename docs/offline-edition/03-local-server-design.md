# 03 — Local Server Design

Status: **PROPOSAL.**

## 1. Components on the restaurant PC

| Component | How | Notes |
|---|---|---|
| Node runtime | Portable `node.exe` (pinned LTS) shipped in the installer | Avoids a system install. A single-file SEA build (as print-service does) is possible later; Mongoose/ESM bundling must be proven first. |
| `restaurant-server` | Same code, `DEPLOYMENT_MODE=LOCAL_PRIMARY`, `MONGO_URI=mongodb://127.0.0.1:27017/zen_local?replicaSet=zenrs` | No new backend (CLAUDE.md). |
| MongoDB 7.0 Community | Bundled MSI/zip, Windows service, **single-node replica set** bound to `127.0.0.1` only | Required for transactions and change streams. Verified: existing replica-set test passes on 7.0.14. |
| Static app hosting | `express.static` for 4 built `dist/` folders | See §3 |
| Media store | `D:\ZenOS\media` served at `/media` | Replaces Cloudinary in local mode (§5) |
| Sync agent | In-process worker in restaurant-server (separate module, started only in LOCAL_PRIMARY) | Doc 05 |
| Backup job | Scheduled `mongodump --oplog` (bundled database tools) | Doc 09 |
| Health page | `GET /local/health` (LAN-only): DB, replica set, disk, clock, sync lag, printer heartbeat, cert expiry | |
| print-service | **Existing exe, untouched**; only its `.env` `BACKEND_URL` points at `http://127.0.0.1:5000` | Changing that `.env` is a production setting change → needs your approval per site |
| Service manager | WinSW (single bundled exe, XML config) for node + sync; Mongo uses its own service | Auto-start, restart on crash, logs rotation |

## 2. Ports and origins

Each web app is built with `base: "/"`, so the least-risk layout is **one origin per app** on the same host, all served by the same Node process:

| Port | Serves | Who |
|---|---|---|
| 443 (or 8443) | admin + `/api` + `/socket.io` | admin/manager PC |
| 8444 | waiter | waiter phones |
| 8445 | kitchen | kitchen display |
| 80 / 8080 | customer (HTTP) and `/api` | customer phones (QR) |
| 5000 | API (localhost only) | print-service |

Every app keeps `public/config.js` → `apiUrl: "/api"` (same origin), so **no rebuild per site** and no CORS. Alternative (one port, sub-paths) needs `base` changes in four Vite configs — avoided.

## 3. HTTPS on the LAN (the hardest practical problem)

Browsers only allow service workers, geolocation, camera and PWA install on HTTPS (or `localhost`). Release Android builds block cleartext.

Recommended:
* **Staff devices (admin PC, waiter phones, kitchen, rider phones): HTTPS with a per-restaurant local CA.** The installer creates a CA and a server certificate for the server's fixed IP and host name. The CA certificate is installed once on each staff device during **device provisioning** (doc 06 §3). PWA install, SW, offline shell all work.
* **Customer phones: plain HTTP on the LAN.** Customers cannot be asked to install a CA. The customer app has no app service worker today, so nothing is lost except **geolocation** → in LOCAL_PRIMARY the dine-in radius gate is replaced by *table token + request from the restaurant LAN subnet* (doc 06 §4). Customer sessions carry no staff privileges, so HTTP on a private Wi-Fi is an accepted risk; document it and recommend WPA2/WPA3 guest Wi-Fi with client isolation off for the server only.
* Option to evaluate later: a public domain (e.g. `site123.zenos.app`) resolving to the LAN IP with a publicly trusted certificate renewed while online. Requires router DNS override and 60–90 day renewals → fragile offline; not the default.

## 4. Addressing and discovery

* **Fixed IP** for the server PC (DHCP reservation on the router — installer checklist).
* QR codes encode `http://<fixed-ip>:8080/?table=N&t=<token>` (the existing `utils/qrLink.js` takes `CUSTOMER_FRONTEND_URL`; local mode sets it to the LAN URL). Reprinting QRs is part of cutover.
* mDNS (`zen.local`) is unreliable on Android → optional convenience only.
* `server.js` hard-coded `dns.setServers(1.1.1.1, 8.8.8.8)` must become conditional (keep for CLOUD_PRIMARY, skip for LOCAL_PRIMARY) — otherwise LAN host names fail offline.
* Staff apps: the provisioning screen writes the server URL; delivery-app already takes a configurable base (`configureApi({ base })`).

## 5. Images and media

* Local mode: `uploadMiddleware` writes to the media store, stores `/media/<sha256>.<ext>`.
* Cutover: a one-time mirror job downloads every existing Cloudinary URL referenced by MenuItem/Category/Profile/Purchase, rewrites to `/media/...` **in the local DB only**.
* Sync: media files upload to Cloudinary when online; the cloud mirror stores Cloudinary URLs (mapping table `MediaAsset { hash, localPath, cloudUrl }`).

## 6. Background jobs

All existing ticks (offers, pay-first expiry, auto-send-to-kitchen, delivery tick, category reset) run on the local server, unchanged. In LOCAL_PRIMARY the **cloud must not run them for that restaurant** (it would race the real writer) — the cloud mirror for a LOCAL site runs with jobs off for that tenant (the existing `DISABLE_BACKGROUND_JOBS` idea, scoped per site).

## 7. Clock
Menu schedules, edit window, business day and pay-first deadlines all use the server clock. The health page warns when the PC clock has not been NTP-synced for > 24 h; the installer enables Windows time sync. Offline drift on a PC is usually seconds/day — acceptable, but visible.

## 8. Capacity
One mid-range Windows PC (4 cores, 8 GB, SSD) is ample: a busy restaurant is tens of writes per minute. MongoDB WiredTiger cache capped at 1 GB.
