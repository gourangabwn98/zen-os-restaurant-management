# Sohoj Print Service

A standalone local application that runs on a machine at the restaurant and
bridges the central backend to physical thermal printers over the LAN or USB.

```
CENTRAL BACKEND → SECURE SOCKET → THIS SERVICE → THERMAL PRINTER
```

It is **not** deployed to the cloud — it runs where the printers are.

## What it does

- Connects to the backend over Socket.IO using a printer-specific credential
  (never a staff login).
- On every connect (including reconnects), pulls the backend's current print
  queue and reconciles it against its own local, disk-persisted queue — so a
  job created while this service was offline is never missed, and a job
  already printed is never printed again.
- Prints KOT (kitchen) tickets and bills to whichever configured printer
  matches the job's role.
- Retries failed prints automatically (offline printer, paper jam, etc.)
  without ever losing the job — it stays `PENDING`/`FAILED` in the local
  queue until it succeeds or a human intervenes.
- Reports every status change (`PRINTING` → `PRINTED`/`FAILED`) back to the
  backend so the Admin/Waiter apps' printer-status views stay accurate.

Customers can never trigger a physical print — this service only ever
receives jobs the backend created from staff-gated actions (order
confirmation, "Print Bill").

## Setup

1. **Get a printer key.** In the Admin app (or via `curl`), an admin creates
   a printer device:
   ```
   POST /api/admin/printer/devices
   { "name": "Kitchen Printer", "role": "KOT", "connectionType": "LAN", "lanIp": "192.168.1.50" }
   ```
   The response includes `printerKey` — **copy it immediately**, it is only
   ever shown once.

2. **Configure this service.**
   ```
   cp .env.example .env
   ```
   Fill in `BACKEND_URL` and `PRINTER_KEY`.

3. **Configure your printers** in `printers.config.json`:
   - **LAN printer**: set `type: "LAN"`, `ip`, and `port` (thermal printers
     almost always use port `9100`). No extra setup needed.
   - **USB printer**: set `type: "USB"` and `windowsPrinterName` to the
     *exact* name shown in Windows under Settings → Printers & Scanners.
     **The printer must also be shared:** right-click it there → Printer
     properties → Sharing tab → check "Share this printer" (the share name
     defaults to the printer name — if you changed it, also set
     `windowsShareName` to match). This service talks to it via
     `\\localhost\<ShareName>`, which needs the share to exist; it does
     **not** need any native/compiled Node module, so `npm install` never
     needs a C++ build toolchain.

4. **Install and run:**
   ```
   npm install
   npm start
   ```

5. **Try it without hardware first.** Set `USE_MOCK_PRINTER=true` in `.env`
   to run the full pipeline against an in-memory simulated printer — useful
   to confirm the backend connection and job flow work before plugging in
   real hardware.

## Running as a background service

For production use this should run continuously and restart automatically
(e.g. via `pm2`, a systemd service, or Windows Task Scheduler / NSSM). A
restart is always safe — the local queue is persisted to disk after every
change and reloaded on startup; any job that was mid-print when the process
stopped is treated as unconfirmed and retried, never assumed successful.

## Troubleshooting

**`Fatal startup error: No driver set!`** — this was a bug in an earlier
version of this service: USB printing used to go through
`node-thermal-printer`'s built-in OS-printer interface, which requires the
`printer` npm package — a native addon needing a C++ build toolchain, and
one whose own dependencies currently fail to resolve on a fresh install.
USB printing no longer uses it at all (see `src/drivers/usbDriver.js`) — if
you still see this error, you're running an old build; update to this
version.

**A misconfigured printer no longer takes down the whole service** — each
printer in `printers.config.json` is initialized independently. If one is
missing a required field or has a bad connection type, it's logged and
skipped; every other configured printer still starts normally.

## Testing

```
npm test
```

Runs the full suite (queue persistence, print processing logic including
simulated LAN/USB/offline/retry/duplicate scenarios, renderers, and a real
Socket.IO integration test against a local test server). All of this uses
either the mock printer driver or a real local socket connection — **it does
not and cannot verify a real physical printer or a real Windows print
spooler**. Before going live, test against the real printer directly:

- Confirm the LAN printer's IP/port is reachable from the machine running
  this service (`ping`, and that nothing else is bound to port 9100).
- Confirm the USB printer's exact OS-registered name matches
  `windowsPrinterName` — copy it exactly from the OS printer settings.
- Pull the network cable / turn off the printer mid-run and confirm jobs
  queue up as `FAILED` and resume automatically once it's back.
- Stop and restart this service while a job is in flight and confirm it
  recovers cleanly (see `recoverStuckJobs` in `src/queue.js`).
