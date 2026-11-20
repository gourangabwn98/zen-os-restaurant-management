# 18 — Phase O2 Report: Staff PIN login and device registration

Date: 2026-11-20 · Branch: `features/offline-edition` · **Nothing committed, pushed or deployed.**
Scope: decision 3 ("staff PIN — approved with conditions"). Every change is off in the cloud
(`DEPLOYMENT_MODE` unset): the routes aren't mounted, the login gates call `next()`, and the
frontends render the unchanged OTP login unless `/config.js` comes from the restaurant PC.

## 1. How it works

```
new phone/tablet ──register──▶ PENDING (6-letter pairing code shown on the device)
admin/manager types that code in Admin → Devices & PINs, picks roles ──▶ APPROVED
staff: phone + PIN on an APPROVED device ──▶ session (server-side, re-checked on EVERY request + socket)
revoke device / reset PIN / logout ──▶ session ends; live sockets are disconnected at once
```

First admin on an empty PC: the server prints a **one-time setup code on its own console**
(12 chars, 2 h, single use, 10 tries). `/setup` in the admin app accepts it **only from the PC
itself** (loopback peer address) and only with the right `LOCAL_SITE_ID`. One transaction creates the
restaurant profile, the admin, their PIN, the first trusted device and the session; a second attempt or
a race gets 409.

## 2. Your decision-3 conditions → what was built

| Condition | Implementation |
|---|---|
| Registered devices only | `StaffDevice` (random 128-bit id + 256-bit secret, only its SHA-256 stored). Login needs id + secret of an APPROVED device whose `allowedRoles` include the person's role. Approval needs the pairing code shown on the device. Unapproved registrations expire after 24 h. Max 25 waiting, 5 registrations per IP per 10 min |
| Hashed PINs | scrypt (N=2^15) over HMAC-SHA256(`LOCAL_PIN_PEPPER`, PIN), random salt per PIN. The pepper lives only in the PC's `.env`, so a copied database or backup can't be brute-forced. PINs are 6–8 digits; repeated digits, straight runs and phone-number fragments are refused. A PIN set by admin/manager is temporary: until the person picks their own, the session can only change PIN / sign out |
| Rate limit / lockout | Per account: 5 wrong PINs → locked 5 min, then 15, then 60 (escalating until a success). Per device: 10 wrong logins in 15 min → device throttled. Per IP: 30 attempts in 5 min. Unknown phone / no PIN still spends one scrypt, and all credential failures return the same message, so phone numbers can't be probed |
| Immediate device revocation | Sessions are checked against the database on every REST request (`protect`, `optionalProtect`) and every socket handshake. Revoke ends all sessions of that device and disconnects its live sockets in the same request. You can't revoke the device you're using. Taking a role off a device also blocks it on the next request |
| Auth audit log | `LocalAuthEvent`, append-only (every update/delete path is blocked at the model, like `DutyHistory`): setup, register/approve/reject/revoke, sign-in ok/failed/blocked, lockout, logout, PIN set/changed. Never contains a PIN or secret. Admin → Devices & PINs → Sign-in log (admin only) |

Other rules:
* **Manager**: may approve, revoke and set PINs only for **waiter/chef** devices and people. Admin,
  manager and inventory devices and PINs are admin-only (same idea as `managerScope.js`).
* **SMS-OTP / Firebase staff login is refused in LOCAL mode** for PIN roles (`local/staffLoginGate.js`,
  `USE_PIN_LOGIN`). Even a token minted another way is refused (`DEVICE_LOGIN_REQUIRED`).
  Customers and riders keep their current login (riders are O8).
* **A local token is rejected by the cloud** (`LOCAL_TOKEN_IN_CLOUD`): both sides could share a
  `JWT_SECRET` by mistake, and this keeps that from being dangerous.
* Sessions last `LOCAL_SESSION_HOURS` (default 12, 1–24). One session per person per device.
  Changing your PIN signs out your other devices. Resetting someone's PIN signs them out everywhere
  and also clears a lockout.

## 3. Files

New (backend): `config/localAuthModels.js`, `services/localAuthService.js`, `utils/localPin.js`,
`controllers/localAuthController.js`, `routes/localAuthRoutes.js`, `local/staffLoginGate.js`,
`test/localAuth.test.js`.
Changed (backend): `server.js` (mount `/api/local` + setup-code announcer, LOCAL only),
`middleware/authMiddleware.js` (per-request session check), `sockets/socket.js` (handshake check,
expiry timer, `disconnectLocalSessions`), `routes/authRoutes.js` (gates), `local/lanOnly.js`
(`requireLoopback`), `config/localModeCheck.js` (new required settings),
`local-edition.env.example`, `test/deploymentMode.test.js`, `test/localBoot.test.js`.
New (frontends): `admin|waiter|kitchen/src/local/localAuth.js` + `PinLogin.jsx` (same file in each),
`admin/src/local/localAdminService.js`, `admin/src/pages/SetupPage.jsx`,
`admin/src/pages/admin/DevicesPage.jsx`.
Changed (frontends): the three `LoginPage.jsx` (LOCAL → PIN screen, else the OTP page unchanged),
logout hooks (best-effort server sign-out), `admin/src/App.jsx` (`/setup`, LOCAL only),
`AdminLayout.jsx` + `utils/access.js` ("Devices & PINs", LOCAL only; managers included),
`kitchen/src/services/api.js` (return to login on `SESSION_EXPIRED`, LOCAL only — kitchen had no
such handler).
New required `.env` on the PC: `LOCAL_PIN_PEPPER` (≥32 chars, ≠ `JWT_SECRET`), `LOCAL_SITE_ID`.
The server refuses to start in LOCAL mode without them.

### 2.1 Test-environment note (in-memory mongod)
The O1 report mentioned one `fassert` crash of the test mongod. It was memory: by default the
WiredTiger cache asks for ~half the RAM, and on this PC that failed under low commit memory. The test
mongods are now capped at 0.25 GB (`--wiredTigerCacheSizeGB`). There have been no crashes since.

## 4. Verification
* `test/localAuth.test.js` **35/35** (in-memory replica set): PIN rules and hashing, the full
  device lifecycle, manager limits, generic errors, lockout 5→15→60 and reset, device throttle,
  expiry, replacement, revoke, role removal, temp PIN → forced change, change-pin lockout, the
  audit log is append-only and has no PINs, bootstrap (wrong code/site/PIN, success, repeat 409,
  3 concurrent → exactly 1 admin, code expiry), and cloud-mode token handling.
* `test/localBoot.test.js` **23/23**: real `server.js` over HTTP. Setup code from the console, then
  bootstrap, PIN session on `/api/auth/profile`, an OTP-style token refused over REST **and**
  Socket.IO, OTP routes → `USE_PIN_LOGIN`, register → approve → login → revoke cuts REST + socket at
  once. Cloud mode: `/api/local/*` is an unknown route and OTP routes are not gated.
* `test/deploymentMode.test.js` **21/21**.
* Full backend suite: **71 of 73 files pass**. The same 2 pre-existing failures
  (`editAfterKitchen`, `menuStructure`) also fail on a clean HEAD (see doc 10).
* `npm run build` passes for admin, waiter and kitchen. ESLint is clean on every changed admin file.
  Waiter and kitchen have no ESLint config, so the build is their check.
* **Browser walkthrough** (Chrome, throwaway LOCAL server, in-memory DB, real builds): first-time
  setup → admin panel. Waiter app: register, then pairing code. Admin approves with the code and
  the waiter screen moves on by itself. PIN sign-in reaches the tables. Revoking in admin sends the
  waiter back to login with "This device was removed by the admin". The sign-in log shows every
  step. No console errors.

## 5. Known limits / for you to decide
1. **Waiter and kitchen have no "change my PIN" screen** outside the forced first change. Admin
   has it (Devices & PINs → My PIN). If you want one there, it's a small addition.
2. **Lost `LOCAL_PIN_PEPPER` = every PIN must be reset.** The admin can't sign in either. Recovery
   then needs a console reset tool (planned for O9 with backups; not built). **Keep a copy of the
   `.env` with the backups.**
3. **Forgotten admin PIN with no second admin**: same recovery path as (2). Advice: create a second
   admin-level account early.
4. Plain HTTP (until O5): PINs cross the restaurant Wi-Fi unencrypted, like the current app's
   tokens. Doc 12 (HTTPS) is still awaiting your approval.
5. The audit log has no retention limit yet (append-only by design). It is small; revisit in O9.
6. Importing the existing restaurant's data (menu, staff) onto a PC is still a cutover task that
   reads production, so it still needs your approval (doc 10, finding 5). O2 only solves "first admin
   on an empty PC".

## 6. Not done (by design)
O3–O11. No commits, no deploy, no production `.env`, printer or print-service changes, no new
dependencies.
