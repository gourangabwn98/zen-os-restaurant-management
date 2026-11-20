# 09 — Installation and Deployment Guide (design)

Status: **PROPOSAL** — describes the installer to be built in phase O9. Nothing here exists yet.

## 1. Target experience
1. Run `ZenOS-Local-Setup-x.y.z.exe` on the restaurant PC (fully offline installer).
2. Setup wizard: restaurant name, site code, LAN IP check, admin phone + PIN.
3. Services start automatically; a desktop shortcut opens the health page.
4. Connect phones to the restaurant Wi-Fi, pair staff devices by QR, print table QRs.
5. Operate without internet.
6. When internet is available: "Activate cloud sync" (one-time, online) → sync runs automatically from then on.

## 2. Package contents (no downloads after install)
`node.exe` (pinned LTS) · `restaurant-server` (prod `node_modules` pre-installed) · built `admin/waiter/kitchen/customer` dist · MongoDB 7.0 server + database tools · WinSW · `eng.traineddata` · print-service exe (existing) · local CA tool (Node `crypto`, no extra binary) · docs.

## 3. Requirements
Windows 10/11 64-bit, 4 cores, 8 GB RAM, 20 GB free SSD, wired Ethernet to the router recommended, UPS strongly recommended. Router able to reserve a DHCP address.

## 4. Network setup checklist
* Reserve a fixed IP for the PC (e.g. `192.168.1.10`).
* Staff Wi-Fi (WPA2/3) and guest Wi-Fi; guest network must be able to reach the PC's customer port (disable client isolation for that host or put customers on the same SSID).
* Windows network profile = **Private**.
* Firewall rules (installer creates, Private profile only): TCP 443/8443, 8444, 8445, 8080. MongoDB 27017 **not** opened. Port 5000 localhost only.
* Power settings: never sleep; restart after power loss (BIOS) if possible.

## 5. Services
| Service | Start | Recovery |
|---|---|---|
| `ZenOS-MongoDB` | Auto | restart ×3 then alert |
| `ZenOS-Server` (API + apps + sync) | Auto (delayed, depends on Mongo) | restart on exit |
| `ZenOS-PrintService` | Auto | existing behaviour |
| `ZenOS-Backup` | Scheduled task every 4 h + day end | logs to health |

## 6. Cutover of an existing cloud restaurant to LOCAL_PRIMARY
1. Schedule at closing time. Freeze writes in the cloud for that restaurant (maintenance flag).
2. `mongodump` the restaurant DB from Atlas → restore into the local DB (counters continue, no renumbering).
3. Run the media mirror job (Cloudinary → local).
4. Set cloud tenant to LOCAL_PRIMARY (mirror read-only, jobs off for that site).
5. Reprint table QRs with the LAN URL; repoint print-service `BACKEND_URL` to localhost (**approval needed**).
6. Pair devices, set PINs, smoke test T1–T5, open.
Rollback: switch the cloud tenant back to CLOUD_PRIMARY and restore the local DB's newer data up first (sync drains), then revert QRs/print-service.

## 7. Backup and restore
* Automatic encrypted dumps in `D:\ZenOS\backups` (14 daily + 8 weekly), optional USB copy, cloud mirror as off-site copy.
* Restore wizard: pick a dump → services stop → restore to fresh DB → start → sync reconciliation.
* Restore is tested monthly by the health job on a scratch DB (verifies the dump opens).

## 8. Health monitoring
`https://<ip>/local/health` and a tray/desktop page: DB, replica set, disk free, last backup, clock sync, cert expiry, print-service heartbeat, cloud reachability, sync backlog, conflicts.

## 9. Updates
* Signed update packages (`.zenpkg`) — downloaded when online or copied by USB.
* Updater: backup → stop server → swap app folder (keeps `.env`, data, media) → run additive migrations → start → health check → auto-rollback to the previous folder on failure.
* MongoDB major upgrades only via a supported path, never automatic.

## 10. Cloud sync configuration
Admin → Sync → "Activate": shows a code to enter in the Zen cloud console (online), which registers the site's public key. Afterwards the agent connects whenever internet exists. Pausing sync never affects local operation.
