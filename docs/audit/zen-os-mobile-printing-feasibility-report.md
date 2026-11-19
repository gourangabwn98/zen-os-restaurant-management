# Zen OS mobile-printing feasibility audit

**Audit date:** 2026-10-28  
**Repository:** `D:\Adds_cafe\Restaurant-Management-System`  
**Branch observed:** `feature/inventory-v3`  
**Scope:** read-only architecture audit and PC-free Android feasibility research. No application implementation was performed.

## 1. Evidence classification

- **Verified fact:** directly observed in repository source, configuration templates, tests, or committed documentation.
- **Code-based inference:** behavior inferred from the observed call graph but not exercised against production data or a physical printer.
- **Assumption:** a future design input that still requires confirmation.
- **Recommendation:** an architectural proposal, not an existing capability.

## 2. Executive summary

The current production print architecture is cloud/backend plus an on-premises Windows print service. The browser applications do not send raw printer data directly. Staff actions create durable KOT or bill print jobs in MongoDB; the backend emits room-scoped Socket.IO events; `SohojPrintService.exe` running at the restaurant authenticates with a printer-device key, reconciles the server queue, renders ESC/POS output, and sends it to a configured LAN or USB printer.

Therefore, the current setup requires a PC for physical printing. The PC is not required for order creation, billing, or KDS display; it is required because the current local bridge is a Windows executable and the backend is cloud-hosted. A cloud server cannot normally open a restaurant printer's private `192.168.x.x`/`10.x.x.x` socket, and a normal mobile browser cannot provide reliable silent background USB/LAN printing.

The most practical PC-free product path is a separate optional Android print-agent application that preserves the existing backend job model and printer safety rules. The recommended order is:

1. Build a transport-neutral print-job contract and keep the current Windows service as a compatible transport.
2. Add an Android agent for LAN ESC/POS printers first. It avoids USB OTG permission and device-driver variation and is better suited to multiple stations.
3. Add USB OTG direct printing as a second transport after testing exact printer VID/PID, interface, endpoint, ESC/POS behavior, Bengali rendering, and power requirements.
4. Keep Windows as a fallback for existing restaurants and difficult printers.

This is a recommendation only. No physical printer, exact `SP POS893 USD` unit, Android device, or live production database was tested during this audit.

## 3. Repository and safety findings

Read-only checks performed:

| Check | Result |
|---|---|
| Current branch | `feature/inventory-v3` |
| Initial worktree | Clean; tracking `origin/feature/inventory-v3` |
| Recent history | Includes inventory, category availability, call-waiter, location, AC amount, and print-service work; no branch switch was made |
| Existing audit directory | `docs/audit` did not exist; existing `docs` files were preserved |
| Application edits | None |
| Print-service edits | None |
| Database/printer activity | None |
| Physical print tests | Not run |

The repository contains `Admin_provider/SohojPrintService.exe`, an installed/package output folder with a local `.env`, queue/cache data, and node modules. The secret-bearing `.env` and cache contents were not opened or reproduced in this report.

## 4. Existing application architecture

### Frontends observed

- `customer/`: QR/customer ordering application; uses REST menu/order APIs and Socket.IO for menu and order updates.
- `admin/`: Admin/manager/staff operations, menu, tables, orders, billing, printer status/device management, and kitchen display.
- `waiter/`: waiter ordering, order editing, payment/billing, combined bills, and print-bill actions.
- `kitchen/`: chef/KDS application; consumes kitchen-scoped order/KOT events and does not receive customer PII in the kitchen-safe KOT payload.

### Backend observed

- `restaurant-server/server.js`: Express API mounting, compression, MongoDB startup, Socket.IO initialization, and background ticks.
- `restaurant-server/config/getModels.js`: tenant model definitions, including `KOTJob`, `KOTChangeJob`, `BillPrintJob`, and `PrinterDevice`.
- `restaurant-server/sockets/socket.js`: JWT/printer-key socket authentication, tenant rooms, print queue acknowledgements, status reporting, and print event emitters.
- `restaurant-server/services/orderService.js`: order state transitions and the transaction that creates the KOT job when preparation begins.
- `restaurant-server/services/kotService.js`: the single KOT-job creation path and KOT change-slip creation.
- `restaurant-server/controllers/adminController.js`: staff print-bill endpoint and bill payload creation.
- `restaurant-server/services/printerDeviceService.js`: printer-device credential management and stale-job handling.

Authentication is separated by purpose. Staff sockets use JWTs; the local print service uses a printer-device key verified against a hash and receives only printer-room events. Customers cannot trigger physical printing through these socket paths.

## 5. Actual order-to-print flow

### KOT flow

1. Customer or staff creates/updates an order through the relevant REST route.
2. The backend validates the order and stores it in MongoDB.
3. `confirmOrderTx`/`sendToKitchenTx` in `restaurant-server/services/orderService.js` moves the order to `PREPARING` and, in the same workflow, calls `createKotJobForOrder` in `restaurant-server/services/kotService.js`.
4. `KOTJob` is persisted with a unique order relationship; duplicate creation is handled as an idempotent existing-job result.
5. `emitKotCreated` in `restaurant-server/sockets/socket.js` sends:
   - a staff-room KOT event;
   - a PII-stripped kitchen-room event;
   - a printer-room `kot:created` payload;
   - a legacy staff `kot-print` event.
6. The local `print-service/src/socketClient.js` ingests the job into `PrintQueue`.
7. `PrintQueue` persists a local JSON queue and deduplicates by backend job ID.
8. `Processor` chooses a configured KOT/BOTH driver, renders the ticket, optionally rasterizes non-Latin lines, writes to the printer, and reports `PRINTING`, `PRINTED`, or `FAILED` over the authenticated socket.

### Bill flow

1. Staff uses `POST /api/admin/orders/:id/print-bill` from Admin or Waiter. The route is staff-gated.
2. `restaurant-server/controllers/adminController.js::printBill` reloads the order and profile, builds the authoritative bill payload, and creates a `BillPrintJob` document.
3. The controller emits `bill:print` to staff and printer rooms.
4. The print service queues the job, renders the bill, prints two copies according to `BILL_COPIES = 2`, and reports the result.
5. The backend retains the job status and staff printer views can show pending, printing, printed, or failed states.

### Sequence diagram

```mermaid
sequenceDiagram
    participant C as Customer/Staff browser
    participant API as Express API
    participant DB as MongoDB
    participant IO as Socket.IO server
    participant PS as SohojPrintService.exe
    participant P as Thermal printer

    C->>API: Create/update order
    API->>DB: Validate and persist Order
    API->>DB: Create KOTJob when order enters PREPARING
    API->>IO: Emit kot:created to staff/kitchen/printer rooms
    IO-->>PS: kot:created (printer-key socket)
    PS->>PS: Queue upsert by jobId; persist queue.json
    PS->>PS: Render KOT; rasterize Bengali/non-Latin when needed
    PS->>P: ESC/POS over LAN, Windows share, or direct USB
    PS-->>IO: report-job-status PRINTING/PRINTED/FAILED
    IO->>DB: Persist job/printer status
    IO-->>C: Staff status events where authorized

    C->>API: Staff requests print bill
    API->>DB: Reload order/profile and create BillPrintJob
    API->>IO: Emit bill:print
    IO-->>PS: bill:print (printer-key socket)
    PS->>PS: Reconcile server queue and local durable queue
    PS->>P: Render and print two bill copies
    PS-->>IO: report-job-status
    IO->>DB: Persist bill job status
```

## 6. Printing-related evidence inventory

### Backend routes and services

| File | Observed responsibility | Future compatibility note |
|---|---|---|
| `restaurant-server/routes/printerRoutes.js` | Staff printer status/queue; Admin-only device registration, listing, revoke, stale-job actions | A future Android agent should receive a narrow printer-device credential, not a staff JWT |
| `restaurant-server/controllers/printerController.js` | Queue projection, status dashboard, device management, manual KOT override | Existing response shapes should remain stable |
| `restaurant-server/services/printerDeviceService.js` | Hashes/verifies printer keys; printer presence and stale-job helpers | Natural location for transport/device metadata if a future abstraction is needed |
| `restaurant-server/sockets/socket.js` | Printer-key handshake, `get-queue`, `report-job-status`, `kot:created`, `bill:print` | Existing room isolation and status boundary are valuable; do not expose staff/customer data to a new agent unnecessarily |
| `restaurant-server/services/kotService.js` | KOT document creation and change slips | Keep one job ID per logical ticket |
| `restaurant-server/controllers/adminController.js` | Bill payload and durable `BillPrintJob` creation | Keep pricing/bill authority in backend |
| `restaurant-server/services/orderService.js` | State transition that triggers KOT creation and inventory side effects | Do not tie physical transport to order transaction success |
| `restaurant-server/controllers/combinedBillController.js` / `services/combinedBillService.js` | Combined bill job generation | Must use same job/duplicate semantics in future transports |

### Local print service

| File | Observed responsibility |
|---|---|
| `print-service/src/index.js` | Starts lock, queue, manager, processor, socket client, retry/health/poll timers, graceful shutdown |
| `print-service/src/config.js` | Loads `.env` and `printers.config.json`; normalizes backend URL; configures queue/retry/logo/QR/font settings |
| `print-service/src/socketClient.js` | Printer-key Socket.IO connection, reconnect, server queue reconciliation, live job ingestion, status reports |
| `print-service/src/queue.js` | Atomic disk-persisted queue, terminal-job dedupe, retry states, stuck-job recovery, missing-job reconciliation |
| `print-service/src/processor.js` | One-job-at-a-time guard, age/attempt limits, rendering, two bill copies, print status reporting |
| `print-service/src/printerManager.js` | Builds LAN, Windows-share USB, direct USB, or mock drivers and routes KOT/BILL/BOTH roles |
| `print-service/src/drivers/lanDriver.js` | TCP network printing through `node-thermal-printer` with Epson printer type and default port 9100 |
| `print-service/src/drivers/usbDriver.js` | Windows printer share path using binary `.prn` copy to `\\localhost\\share` |
| `print-service/src/drivers/usbDirectDriver.js` | Direct USB device discovery, printer-class/interface selection, endpoint writes in chunks, serialized transfers, hot-plug checks |
| `print-service/src/renderers/kotRenderer.js` | No-price kitchen ticket, table/order/customer details, items, add-ons, notes, cut |
| `print-service/src/renderers/billRenderer.js` | Tax invoice, order details, item/add-on rows, taxes, discount, service charge, AC charge, payment, QR/footer |
| `print-service/src/renderers/layout.js` | 32/48 character width layout, wrapping, columns, money, order/payment labels |
| `print-service/src/textImage.js` | Windows PowerShell/System.Drawing rasterization for Bengali and other non-Latin lines; disk/memory cache |
| `print-service/src/logo.js` | Downloads/caches and converts restaurant logo to monochrome bitmap |
| `print-service/src/payQr.js` | Reads uploaded QR or generates fallback UPI QR for unpaid bills |
| `print-service/src/drivers/renderLines.js` | Converts rendered lines/images to thermal-printer operations |
| `print-service/printers.config.json` | Current committed sample maps one `BOTH` `USB_DIRECT` printer with VID `0483` and PID `5720`; this is configuration evidence, not proof of a product model or compatibility |

### Admin visibility and controls

`admin/src/pages/admin/shared/PrintServiceCard.jsx` calls `/admin/printer/status` and `/admin/printer/devices`, creates/revokes device keys, displays pending/failed/printed counts, and tells an operator to start the service on the restaurant PC. This is direct evidence that the current supported deployment model uses a counter PC.

## 7. Current service behavior and reliability

Verified from code and tests (not physical hardware):

- Printer-device keys are separate from staff logins and are revocable.
- Jobs are durable in MongoDB and also persisted locally in `data/queue.json`.
- Live push is supplemented by queue reconciliation on connect/reconnect and a periodic queue poll.
- A local job already marked `PRINTED` is not sent to a printer again by the local queue.
- A job left `PRINTING` on process restart is retried because the final physical outcome is unknown. This favors avoiding lost tickets over eliminating every possible duplicate after a crash.
- Printer offline states remain pending and are retried when health checks detect recovery.
- Failed jobs use bounded attempts/backoff and remain visible for intervention.
- Jobs older than the configured age can be skipped to prevent a printer returning after a long outage from producing a backlog unexpectedly.
- `instanceLock.js` prevents two local service copies using the same key from printing the same jobs twice on one PC.
- `BILL_COPIES = 2` means one logical bill job intentionally produces two physical copies.
- The current committed sample config uses a single `BOTH` printer, so multi-station routing is supported by the service design but not demonstrated by the checked-in sample.

Unverified: actual paper-out status semantics for each printer, physical acknowledgement quality, whether a given printer reports completion after buffering data, and behavior of the installed executable on a real restaurant machine.

## 8. KOT, bill, Bengali, logo, QR, and paper compatibility

### KOT and bill content

The backend is authoritative for final order values. KOT payloads include order ID/type, table context, items, quantities, notes, add-ons, and paper-only customer name/phone. Bill payloads include item prices, add-ons, subtotal, discount, tax, service charge, AC charge, total, payment method/status, customer details, and combined-bill information.

The service lays out for `charsPerLine` values of 48 for a nominal 80 mm roll or 32 for a nominal 58 mm roll. These are formatting assumptions from the repository, not a guarantee that a particular printer has that exact dot width.

### Bengali/non-Latin text

The source explicitly states that ordinary ESC/POS code pages do not reliably provide Bengali. On Windows, `TextImageRenderer` uses PowerShell/System.Drawing and a configured font, defaulting to `Nirmala UI`, then sends the line as a raster image while preserving column cells. If rasterization fails, the code leaves text in place and the printer may render question marks. This is a strong existing Windows-specific compatibility feature.

An Android agent cannot assume `Nirmala UI`, PowerShell, or Windows GDI+. It would need one of:

- server-side or Android-side shaping and rasterization using a verified Bengali font;
- a printer-native Bengali/code-page path, only if the exact model supports it;
- a transport payload containing already-rendered bitmap lines from a trusted renderer.

The safest future design is to separate **content/payload authority** from **rendering/transport**, then test the same Bengali fixtures on Windows and Android against the actual printer.

### Logo and payment QR

The service downloads/caches the Admin profile logo, converts it to monochrome receipt art, and can print a payment QR from the uploaded image or generated UPI data. These are rendered images, not plain printer text. An Android implementation must match bitmap width, threshold/dithering, QR crispness, and paper feed/cut behavior.

No logo or Bengali physical output was tested in this audit.

## 9. Existing Android printer project audit

No Android project was found in the repository/workspace scan. There were no `settings.gradle*`, `build.gradle*`, `AndroidManifest.xml`, Kotlin source, or Java source files associated with a printer app.

`Admin_provider/` is not an Android project. It contains:

- `SohojPrintService.exe`;
- Windows print-service configuration and README;
- local `.env`, queue, logo, payment-QR, and text-image cache files;
- Windows/Node USB runtime modules.

Those local files were not used as production secrets or customer data in this report. There is no evidence of Android USB discovery, Android USB permission handling, Kotlin/Java ESC/POS communication, LAN printing, Android queue durability, or mobile job acknowledgement in the checked repository.

## 10. PC-free options comparison

Effort estimates are rough future-development estimates, not commitments; they exclude hardware procurement, physical testing delays, Play Store work, and support operations.

| Option | PC required | Architecture/data flow | Strengths | Main limitations/risks | Estimate |
|---|---:|---|---|---|---:|
| A. Android USB OTG app | No | Android app receives job, requests USB permission, discovers exact device/interface/OUT endpoint, writes ESC/POS or raster bytes | Works with a USB-only printer; no LAN printer required | OTG cable/power; temporary permission; model/chipset/interface variation; phone must stay connected; background process and Android restrictions; physical test essential | 20–35 person-days for one robust transport plus queue/tests |
| B. Android LAN app | No | Phone on restaurant Wi-Fi receives authenticated job and opens TCP connection to printer IP/port, normally 9100 | Better for several stations; no OTG; easier multi-printer routing and placement | Printer needs compatible LAN/Wi-Fi interface and stable local network; phone cannot reach printer if isolated by AP; local credentials/security | 15–25 person-days for first production transport |
| C. Mobile web/browser printing | No, in narrow cases | Web page could render UI and possibly ask for WebUSB in supported secure browser/device combinations | No APK distribution; fastest experiment for a manually initiated test | Not reliable silent/background printing; user gesture and permission required; limited browser/device support; no durable always-on queue; ordinary browser cannot open arbitrary LAN sockets; WebUSB compatibility is not a product guarantee | 5–10 person-days for a constrained proof of concept, not a production automatic printer |
| D. Phone-hosted local agent | No | Dedicated Android background/foreground service receives jobs, persists queue, prints, acknowledges | Best match for automatic printing and retry; can support USB and LAN behind one agent | Must manage Android lifecycle, notification/foreground-service rules, battery optimization, restart, security, queue recovery, and device ownership | 30–50 person-days for USB+LAN production baseline |
| E. Backend directly to LAN printer | No local app, but requires network bridge | Cloud backend tries TCP to restaurant private printer | Minimal client software in theory | Usually impossible across NAT/private IP/firewalls; exposing printer is unsafe; no reliable route discovery; cloud egress cannot enter local subnet without VPN/tunnel/agent | Not recommended as direct design |
| F. Managed edge gateway/router/VPN | No PC, but extra network appliance/service | Small gateway at restaurant provides authenticated tunnel to backend and local printer transport | More stable than a phone for 24/7 multi-station printing | Hardware/support cost, provisioning, updates, network/security operations; still an edge device | 25–45 person-days plus hardware/operations |

### Option-specific notes

**USB OTG:** Android officially supports USB host mode and requires device discovery, user permission, interface/endpoint selection, and off-UI-thread transfers. Permission is tied to the device connection and must be re-established after disconnect. Exact thermal-printer USB class behavior varies.

**LAN:** A TCP printer on port 9100 is not automatically safe or compatible. The printer must support the chosen ESC/POS dialect, be reachable from the phone's WLAN, and be isolated from guest/customer networks. Multiple stations require explicit routing and device identity.

**Browser:** WebUSB is HTTPS-only and user-gesture/permission based. It is not a reliable substitute for a durable background print agent, especially for a restaurant that expects automatic KOT printing while the screen is locked or the browser is backgrounded.

**Android background execution:** A long-lived agent must comply with Android service/background limits. A foreground service requires a visible notification and has launch/type restrictions on modern Android. The agent must be designed for process death and restart rather than assuming a socket stays alive forever.

**Backend direct:** The cloud server cannot normally address a printer on a restaurant's private RFC1918 network. Port forwarding would expose a printer and is not an acceptable default. A secure outbound connection from the restaurant edge is the correct direction.

## 11. Hardware verification and the `SP POS893 USD` question

The user-mentioned label `3-inch Thermal Receipt Printer – SP POS893 USD` was not found verbatim in the repository. The checked-in sample configuration instead contains USB VID `0483` and PID `5720`, with comments describing it as a possible generic WinUSB/POS-58/80-style device. A VID/PID and a display label do not establish manufacturer, chipset, ESC/POS compatibility, Bengali support, or Android compatibility.

Before promising PC-free printing, capture and verify:

1. Manufacturer and exact model from the physical label/invoice.
2. USB VID/PID, USB class, configurations, interfaces, alternate settings, and bulk OUT endpoint.
3. Whether the printer accepts Epson ESC/POS or a proprietary dialect.
4. Whether it can be powered by the specific phone + OTG adapter without brownouts.
5. Android device USB-host support and permission behavior.
6. LAN/Wi-Fi interface, DHCP/static-IP support, TCP port, and whether raw TCP 9100 is supported.
7. Actual paper width and print-head dot width.
8. Cut, feed, raster-image, QR, and status-command behavior.
9. Bengali output using both native text and bitmap rendering.
10. Recovery after cable removal, paper-out, power loss, phone screen lock, app kill, and Wi-Fi change.

The Epson ESC/POS documentation is useful as a command reference, but it does not certify a non-Epson printer. Model-specific documentation and a physical test are required.

## 12. Security, reliability, and duplicate-print risks

### Existing strengths

- Printer keys are narrower than staff credentials and revocable.
- Printer sockets are separated into tenant printer rooms.
- Customer sockets do not receive a printer role.
- Print jobs are persisted before live delivery.
- Queue reconciliation handles missed live pushes.
- Local dedupe is keyed by server job ID.
- Staff-gated controllers create KOT/bill jobs; customers cannot directly trigger physical printing.

### Risks to preserve in a future agent

- A phone agent must never accept arbitrary unauthenticated local HTTP print commands.
- The agent must use a per-device credential or short-lived enrollment token and TLS for backend communication.
- Do not store a long-lived credential in a web localStorage or QR URL.
- A print acknowledgement means “bytes accepted/transport completed” unless the printer provides a reliable physical status protocol; it cannot always prove paper output.
- A crash after bytes leave the device and before acknowledgement creates an unavoidable duplicate-vs-loss decision. Preserve the current conservative behavior and surface uncertain jobs for human review.
- Multiple agents must not share one credential if device-level revocation and ownership matter.
- Offline queue files require encryption/permissions appropriate to the Android device and should avoid unnecessary customer PII.
- A phone is easier to lose, sleep, kill, or disconnect than a fixed edge device; automatic KOT reliability must be tested under those conditions.
- LAN printers should be on a protected restaurant network, not a customer Wi-Fi VLAN.

## 13. Recommended product architecture

### Short-term / existing clients

Keep the Windows service unchanged. It is already the only observed production transport and has the most complete Bengali, logo, queue, restart, and hardware handling in this repository.

### Phase 1: transport-neutral backend contract

Do not change order/payment/KOT business logic. Introduce a future print-transport boundary around the existing persisted `KOTJob`, `KOTChangeJob`, and `BillPrintJob` concepts. Keep the current Socket.IO event names and queue projection compatible while adding device capabilities/transport metadata only where necessary.

The backend should continue to decide:

- whether a job exists;
- which content and totals are authoritative;
- role/station routing;
- job idempotency and status;
- staff authorization for bill/KOT actions.

The local agent should decide:

- local queue persistence;
- hardware connectivity;
- renderer/transport capability;
- retry and local health reporting.

### Phase 2: Android LAN agent

This is the recommended first PC-free pilot because it avoids USB permission and OTG power variation. A phone or Android box on the restaurant LAN receives authenticated jobs and sends them to configured network printers. A fixed Android device is preferable to a waiter’s personal phone for always-on printing.

### Phase 3: Android USB OTG

Add after the exact printer is physically characterized. Reuse the same queue/job/status contract, but isolate Android USB implementation behind a driver interface. Support one known device family first; do not advertise generic USB thermal support without test evidence.

### Phase 4: multi-station and offline hardening

Add explicit station routing (kitchen/counter/drinks), provisioning, device revoke, health dashboard, queue inspection, test-print mode, and controlled pilot rollout. Keep the Windows service as a fallback during migration.

## 14. File-by-file future impact map

No files in this list were changed in this audit.

| Future area | Likely files/modules | Why it may change | Compatibility risk |
|---|---|---|---|
| Job/device model | `restaurant-server/config/getModels.js`, `services/printerDeviceService.js` | Add transport/capability/station metadata or Android enrollment | Credential leakage, old device records, migration complexity |
| Printer API | `routes/printerRoutes.js`, `controllers/printerController.js` | Provision Android devices, health, queue acknowledgement | Must keep existing Admin UI/API shapes and revoke behavior |
| Socket protocol | `restaurant-server/sockets/socket.js` | Authenticate Android agent and deliver current job contract | Duplicate jobs, cross-tenant leakage, unauthorized status reports |
| KOT/bill payloads | `services/kotService.js`, `controllers/adminController.js`, `combinedBill*` | Only if renderer needs a versioned normalized payload | Never recalculate prices or alter historical jobs |
| Rendering | New shared renderer or separate Android renderer; existing `print-service/src/renderers/*` remains stable | Android lacks Windows GDI+ path | Bengali/layout divergence and bill/KOT regressions |
| Windows service | `print-service/src/*` | Add transport abstraction only if deliberately preserving legacy behavior | Existing clients and physical printer behavior are sensitive |
| Android app | New separate Android project | USB/LAN drivers, foreground service, queue, provisioning | OS lifecycle, device support, Play policy, update/rollback |
| Admin UI | `admin/src/pages/admin/shared/PrintServiceCard.jsx` and service layer | Show Android device status and capabilities | Avoid exposing printer keys or changing existing PC setup |
| Tests | `restaurant-server/test/*`, `print-service/test/*`, new Android tests | Contract, dedupe, status, renderer, transport tests | Logic tests do not replace physical printer tests |
| Deployment/provisioning | Separate APK/distribution and restaurant setup docs | Install/configure fixed Android edge device | Support burden and credential provisioning |

Interfaces that should remain stable: order creation, payment/billing, KOT creation semantics, bill payload authority, historical print-job identity, staff authorization, and the Windows service’s current configuration path.

## 15. Staged future testing and rollout

| Stage | Prerequisites | Evidence/success criteria | Rollback |
|---|---|---|---|
| 1. Source/contract tests | No hardware | Existing backend tests plus contract tests prove one job ID, stable payload, auth, status transitions, and no change to order/payment logic | Disable Android device type; Windows remains |
| 2. Android discovery | Test Android devices and USB analyzer/known printer | USB host feature, permission, interface/endpoint, reconnect behavior recorded | Do not enroll unsupported hardware |
| 3. Controlled USB print | Approved test printer and non-production tenant | KOT/bill fixtures, Bengali, logo, QR, cuts, 58/80 mm output physically match acceptance samples | Revoke agent; use Windows service |
| 4. LAN print | Isolated restaurant test Wi-Fi and printer | Stable reachability, station routing, printer restart, queue recovery | Remove LAN device config |
| 5. Failure/dedupe | Power/network/cable interruption tests | No silent loss; duplicate behavior documented; jobs recover after app/device restart | Disable automatic route and inspect queue manually |
| 6. Multi-station | Kitchen/counter/drinks printers | Correct role routing and no cross-station leakage | Route all roles to existing Windows service |
| 7. Offline/reconnect | Internet and LAN interruption | Local queue policy, TTL, stale-job policy, reconciliation, and staff visibility verified | Keep jobs pending or use manual fallback |
| 8. Regression | Existing Windows client plus backend test suite | Existing KOT/bill tests and physical Windows path remain unchanged | Roll back Android adapter only |
| 9. One-restaurant pilot | Device provisioning, support owner, backup printer | Several rush-hour shifts with operator sign-off | Remove Android agent and restore PC route |
| 10. Broader rollout | Hardware compatibility matrix and update plan | Per-model support list, monitoring, support process | Maintain Windows fallback per client |

Do not run physical printing or production-order tests as part of this audit.

## 16. Open questions and evidence gaps

1. What is the exact manufacturer/model behind the displayed `SP POS893 USD` label?
2. Does that device really identify as VID/PID `0483:5720`, and what are its interface/endpoint descriptors?
3. Does it accept ESC/POS raster commands reliably, including cut and QR image data?
4. Is it USB-only, or does it have an actual LAN/Wi-Fi interface?
5. What Android phone/box model, Android version, OTG adapter, and power supply will restaurants use?
6. Should automatic printing run on a fixed Android box rather than a waiter’s phone?
7. Is the restaurant Wi-Fi segmented in a way that lets the agent reach printers?
8. What operational policy should apply when the printer accepts bytes but physical output is uncertain?
9. Are two bill copies always required for every future client, or is this existing business behavior fixed?
10. Which exact font and rendering library should be approved for Bengali on Android?
11. Are there regulatory, privacy, or app-store requirements for storing customer names/phones in an offline queue?
12. Has the current Windows executable been installed and physically verified at each client, or is its production status inferred from repository packaging?

## 17. Research references

Accessed 2026-10-28.

- [Android USB host overview](https://developer.android.com/develop/connectivity/usb/host) — USB host discovery, permission, interfaces, endpoints, and off-UI-thread communication.
- [Android `UsbManager` reference](https://developer.android.com/reference/android/hardware/usb/UsbManager) — temporary USB permission and device access behavior.
- [Android processes and app lifecycle](https://developer.android.com/guide/components/activities/process-lifecycle) — process lifetime and restart assumptions.
- [Android services overview](https://developer.android.com/develop/background-work/services) — service/background execution constraints and restart design.
- [Android foreground services overview](https://developer.android.com/develop/background-work/services/fgs) — visible notification and foreground-service suitability.
- [Android foreground-service launch restrictions](https://developer.android.com/develop/background-work/services/fgs/launch) — Android 12+ background start restrictions.
- [Chrome WebUSB capabilities](https://developer.chrome.com/docs/capabilities/usb) — HTTPS, user gesture, permissions policy, and browser hardware access model.
- [Chrome WebUSB device-building guidance](https://developer.chrome.com/docs/capabilities/build-for-webusb) — Android WebUSB permission/device caveats.
- [MDN WebUSB API](https://developer.mozilla.org/en-US/docs/Web/API/WebUSB_API) — limited-availability warning and browser compatibility caveat.
- [Epson ESC/POS Command Reference introduction](https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/index.html) — official command reference scope and model-specific warning.
- [Epson TM-T88V Technical Reference Guide](https://download4.epson.biz/sec_pubs/bs/pdf/TM-T88V_trg_en_revG.pdf) — example official hardware documentation stating ESC/POS and SDK options; not evidence about the project’s unknown printer model.

## 18. Bottom line

The current system is not PC-free: the printing edge is a Windows executable. The codebase is already well positioned for a separate Android edge agent because it has durable job IDs, authenticated sockets, queue reconciliation, status reporting, role routing, and rendering logic. The safest commercial promise is **“PC-free printing supported for validated Android/printer combinations”**, beginning with LAN printers and retaining the current Windows path until each target printer is physically verified.

