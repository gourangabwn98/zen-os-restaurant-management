# 06 — Security and Permissions (Offline Edition)

Status: **PROPOSAL.**

Rule zero: **offline never grants more access than online.** Every request still goes through `protect` → `rbac.js` → `managerScope.js` on the local server. Roles stay `admin | manager | inventory_manager | waiter | chef | delivery | staff | customer`.

## 1. Why the current login can't work offline
Staff log in with SMS OTP (Twilio/MSG91) or Firebase phone auth; customers with Firebase phone auth. All need the internet. The console OTP fallback must **never** be enabled in production local mode (it echoes OTPs).

## 2. Staff login: phone + PIN, verified on the local server
* Admin sets/resets a 6-digit PIN per employee (Admin → Employees), or the employee sets it after one online OTP login. Stored as `User.localPin = bcrypt(pin, cost 12)` — **local DB only, excluded from sync**.
* Admin/manager accounts: minimum 6 digits + device must be registered (§3). Optional: admin uses a longer passphrase.
* Lockout: 5 failures → 15 min lock per account+device, logged in `LocalAuthEvent`; global rate limit per IP (existing `middleware/rateLimit.js`).
* Token: JWT signed with a **site-specific** `JWT_SECRET` generated at install (never the cloud secret). Staff tokens 12 h (one shift); admin 8 h. `protect` already re-reads the user each request, so `status: Inactive` revokes instantly.
* OTP login stays available whenever SMS works — PIN is an additional method only in LOCAL_PRIMARY.

## 3. Device registration
* New `Device { _id, name, kind (admin|waiter|kitchen|rider), secretHash, registeredBy, status, lastSeenAt }`.
* Pairing: admin opens Admin → Devices → "Add device" → shows a one-time QR (5 min). The device scans it, receives a device secret, stores it (IndexedDB / Android Keystore). That step also installs the local CA certificate (doc 03 §3).
* Staff login requires a registered, active device; admin/manager login additionally requires a device of kind `admin`.
* Revocation: admin marks device revoked → its next request is refused; open sockets are disconnected.

## 4. Customer ordering without internet ("table guest")
Requirements: an attacker must not be able to place orders remotely or for a table they're not at, and must not gain any staff ability.
* Valid **table token** from the physical QR (already exists: `?table=N&t=<token>`).
* Request must come from the restaurant LAN subnet(s) configured at install (replaces the geolocation radius gate, which can't run on HTTP).
* Order is created with `source: CUSTOMER`, `user: null`, guest name + optional phone (unverified), and enters `PENDING_CONFIRMATION` — **a waiter must accept it** (existing `confirmOrderTx`). Guest receives the existing guest order token to track/cancel only their own order.
* Rate limit per table token and per IP; max N open pending orders per table.
* Coupons with `audience: REGISTERED` are not available to table guests (existing enforcement).
* Pay-first online is disabled offline (no PhonePe); paymentMode falls back to pay-at-counter.
* This relaxes the rule at `orderService.js:177` **only** when `DEPLOYMENT_MODE=LOCAL_PRIMARY` *and* the restaurant enabled "LAN guest ordering". Online production is unchanged.

## 5. Riders
Same phone + PIN + registered `rider` device. Riders are still not staff — they only join `user:{id}`. COD custody remains "not payment"; only admin/manager hand-in verification marks PAID.

## 6. Site ↔ cloud credentials
* Site identity: `siteId` + an Ed25519 key pair generated at install; public key registered in the cloud during online activation. Every sync/relay request is signed; cloud verifies. Revocable from the cloud.
* The site never holds cloud admin credentials; the cloud never holds the site's JWT secret.

## 7. Secrets on the PC
`.env` (JWT secret, Mongo password, PhonePe salt if used, site key) protected with Windows DPAPI (machine scope) and NTFS ACL to the service account. MongoDB bound to `127.0.0.1` with auth. Backups encrypted (AES-256, key escrowed in the cloud during activation).

## 8. Network exposure
* Windows Firewall: inbound rules only on the **Private** profile for the app ports; MongoDB port never opened.
* No inbound internet port: cloud connectivity is outbound only.
* Socket rooms unchanged: chef sockets never join `staff`; printers authenticate with `PrinterDevice` keys.

## 9. Audit
`LocalAuthEvent`: login ok/fail, lockouts, PIN set/reset (who), device add/revoke, mode changes. Synced to cloud (without hashes).
