# Zen OS Android Print Agent — implementation roadmap

**Status:** design-only roadmap
**Date:** 2026-10-28
**Scope:** future PC-free Android printing; no implementation in this task.

## 1. Labels and guardrails

- **Verified existing behavior:** observed in repository source/configuration/tests.
- **Source-based inference:** inferred from source but not physically tested.
- **Proposed design:** future implementation work.
- **Unverified hardware assumption:** requires controlled hardware evidence.
- **Open question:** unresolved prerequisite.

The existing Windows print service remains the compatibility baseline. No phase should change payment, order status, inventory, KOT creation semantics, billing authority, or printer formatting for existing clients without a separate approved change.

## 2. Recommended sequence in simple language

Build the Android agent as a local restaurant edge application. First make it print to a validated LAN ESC/POS printer. Let the backend remain responsible for creating jobs, totals, authorization, and job identity. Let the Android app maintain a local queue and handle the local printer. Keep the Windows service available until the Android path survives real outage and rush-hour tests. Only then investigate USB OTG for specific certified printer models.

## 3. Phase 0 — design, evidence, and hardware verification

**Status:** proposed future phase.

### Prerequisites

- Select one exact LAN-capable thermal printer and one fixed Android device.
- Obtain manufacturer/model documentation, printer protocol, paper width, and network setup details.
- Confirm whether `SP POS893 USD` is the actual printer model. The repository contains no authoritative model documentation for that label.
- Decide whether a fixed Android box or a phone is the operational edge device.
- Approve the duplicate-versus-uncertain-output policy.

### Work

- Freeze the current KOT/bill fixture set.
- Document existing wire payloads from `restaurant-server/sockets/socket.js` and queue behavior from `print-service/src/socketClient.js`/`queue.js`.
- Decide whether the first prototype is isolated single-agent compatibility mode or starts directly with assigned routing.
- Define Android supported SDK range, device-management model, update channel, and secure enrollment process.

### Required evidence

- Exact printer model and protocol.
- LAN reachability from the proposed Android device.
- Successful manual raw TCP/ESC/POS test in a non-production environment.
- Bengali/logo/QR fixture acceptance samples.

### Acceptance criteria

- No source changes are needed to answer the hardware questions.
- A written support matrix says exactly which device/printer combination is supported.
- The Windows path remains the documented fallback.

### Rollback

No runtime change; abandon the Android prototype and retain current production behavior.

## 4. Phase 1 — LAN proof of concept in a non-production environment

**Status:** proposed future phase.

### Scope

One Android agent, one validated LAN printer, one test restaurant/tenant, KOT and bill jobs only. No USB, multi-station, or production customer deployment.

### Backend changes

- Prefer reusing current `printerKey` Socket.IO handshake.
- Allow an Admin to create a device record identifiable as an Android agent only if an additive metadata change is approved.
- Initially keep the current `get-queue`, `kot:created`, `bill:print`, and `report-job-status` wire shapes.
- Isolate the test tenant so Windows and Android are not both active for the same printer role unless a routing safeguard exists.

### Android changes

- New Android project; no such project currently exists in this repository.
- Setup/enrollment screen with protected credential storage.
- Socket.IO client with TLS, bounded reconnect, and server-derived restaurant identity.
- Local durable queue keyed by `jobId`.
- LAN transport with configurable verified IP/port and serialized writes.
- Structured payload parser and initial ESC/POS renderer or controlled payload adapter.
- Connection/queue/printer diagnostic screen.

### Tests

- Fake Socket.IO server using the existing integration contract.
- Valid/invalid/revoked key.
- Initial queue pull, live job, duplicate live/pull delivery, reconnect.
- LAN socket mock and printer-offline retry.
- Payload size/field validation.

### Acceptance criteria

- One KOT and one bill produce one local job record each.
- Reconnect does not create a second local print attempt for a terminal job.
- Offline network retains jobs and later reconciles them.
- Admin sees device last-seen/error without credentials.
- No production order or printer is used.

### Rollback

Stop/uninstall the test agent and revoke its device key. Existing Windows service and production clients are untouched.

## 5. Phase 2 — production-quality LAN agent

**Status:** proposed future phase.

### Backend work

- Add validated device kind, protocol version, capabilities, station assignment, and routing mode to the printer-device boundary, preserving existing fields/defaults.
- Add server-side station filtering or assignment so the same job is not delivered to both legacy Windows and Android transports accidentally.
- If multiple agents are required, add atomic claim/lease operations as specified in the integration contract.
- Add Admin visibility for Android connection, queue depth, station, protocol version, and last error.
- Keep old Windows handshake/events working.

### Android work

- Production local queue with transactional state transitions and bounded disk usage.
- Job coordinator with retry/backoff, expiry reconciliation, and uncertain-output handling.
- Foreground-service operation for fixed always-on deployments, with visible notification and current Android restrictions respected.
- Printer profile validation, station routing, test-print mode in non-production/explicitly authorized context, and safe diagnostics.
- Protected storage/key rotation/revocation handling.
- Crash/restart recovery and battery-optimization onboarding.

### Tests and evidence

- Contract tests against a fake backend and real local Socket.IO server.
- Multi-agent claim race tests if leases are enabled.
- Device revoke during connection and during job processing.
- App kill, device restart, network loss, Wi-Fi change, printer restart, paper-out simulation.
- Bounded queue/oversized payload/storage exhaustion tests.
- Security review for tenant/station isolation and log redaction.

### Acceptance criteria

- At most one assigned agent can own a job at a time.
- A lost acknowledgement is never reported as physically guaranteed success.
- Existing Windows clients continue to print their legacy jobs in a regression environment.
- Operators can identify and recover failed/uncertain jobs without editing database records manually.

### Rollback

Switch the restaurant’s routing mode back to Windows; revoke Android credentials; leave historical job records unchanged.

## 6. Phase 3 — physical KOT/bill compatibility

**Status:** proposed future phase.

### Required fixtures

- Normal KOT.
- Long item names and add-ons.
- Bengali item/category/customer text.
- DINE_IN with table/area, TAKEAWAY, and ONLINE order type labels.
- Bill with discount, tax, service charge, AC charge, split/payment status, and combined bill.
- Restaurant logo.
- Uploaded payment QR and generated UPI QR.
- 58 mm and 80 mm paper profiles.
- Two-copy bill behavior.

### Comparison approach

- Compare structured intermediate output first.
- Compare rendered bitmap dimensions and pixel-safe QR output.
- Print physically to an approved test printer and compare line wrapping, alignment, cut, paper feed, Bengali glyphs, logo, and QR scanability.
- Record printer firmware, paper, Android version, app version, network conditions, and exact configuration.

### Acceptance criteria

- No required KOT/bill information is lost.
- Bengali is readable or the printer/model is explicitly marked unsupported.
- QR scans reliably and amount/order identity are correct.
- No regression to the existing Windows fixture behavior.

### Rollback

Mark the model unsupported for Android and use Windows service or a validated LAN printer.

## 7. Phase 4 — one approved restaurant pilot

**Status:** proposed future phase.

### Prerequisites

- Phase 3 evidence signed off.
- Fixed Android device physically secured and continuously powered.
- Restaurant LAN documented and separated from guest Wi-Fi where practical.
- Operator training for device health, paper, queue, and fallback procedures.
- Windows/other manual fallback available.

### Pilot scope

- One restaurant.
- One station first, then optional second station.
- Limited period with daily operator sign-off.
- No automatic migration of all existing clients.

### Metrics/evidence

- Job delivery latency distribution.
- Pending/failed/uncertain counts.
- Printer-offline recovery time.
- Reconnect recovery.
- Duplicate/uncertain incidents.
- Bengali/logo/QR acceptance.
- Android battery/process restart incidents.
- Operator support time.

Do not present these as target values until the pilot defines baseline measurements. The current audit contains no real-world performance measurements.

### Rollback

Disable Android routing, revoke the device, restore Windows route, and preserve job history for incident review.

## 8. Phase 5 — selected-client rollout with Windows fallback

**Status:** proposed future phase.

Roll out only to printer/device combinations present in the validated support matrix. Keep `SohojPrintService.exe` available for clients with USB-only, unsupported, unstable, or multi-station hardware. Do not remove the PC workflow until Android support, monitoring, update distribution, and support ownership are proven.

## 9. Phase 6 — USB OTG compatibility program

**Status:** proposed future phase; not part of LAN MVP.

### Prerequisites

- Exact printer manufacturer/model and descriptor dump.
- USB VID/PID, interface/endpoint, command language, and power requirements.
- Android host-capable device, powered OTG arrangement, and reconnect permission behavior.
- Approved physical test printer and non-production test tenant.

### Work

- Kotlin USB host discovery and permission flow.
- Interface/endpoint selection for the certified model family.
- Serialized bulk OUT writes and device-close/reconnect cleanup.
- USB transport health and error classification.
- Reuse the same queue/job/ack contract as LAN.

### Acceptance criteria

- Certified model list, not generic “all USB thermal printers.”
- Stable output after disconnect/reconnect and Android restart.
- No hidden driver/interface conflict.
- Bengali, bitmap, QR, and cut behavior physically verified.

### Rollback

Mark the model unsupported for Android and use Windows service or a validated LAN printer.

## 10. File-by-file future implementation plan

No files in this table were changed during this design task.

| File/module | Classification | Current responsibility | Proposed future change | Risk | Tests required |
|---|---|---|---|---|---|
| `restaurant-server/sockets/socket.js` | Existing potentially requiring modification | Printer-key auth, rooms, `get-queue`, live KOT/bill events, status reports | Add Android protocol metadata and, later, station/lease events or filtering | Cross-tenant leakage, duplicate delivery, unauthorized status | Auth, room isolation, legacy Windows, claim race, revoke |
| `restaurant-server/services/printerDeviceService.js` | Existing potentially requiring modification | Key generation/hash verification, active/revoked device, last seen, stale/expiry helpers | Add device kind/capabilities/stations and atomic claim helpers if approved | Credential and assignment errors | Key lifecycle, revoke, concurrent claim, expiry |
| `restaurant-server/config/getModels.js` | Existing potentially requiring modification | Mongoose schemas/models for printer and print jobs | Add only backward-compatible metadata/lease fields if necessary | Migration/default/index risk | Schema defaults, old documents, indexes, rollback |
| `restaurant-server/routes/printerRoutes.js` | Existing potentially requiring modification | Staff/admin status/queue/device routes | Add narrowly scoped Admin Android enrollment/health/assignment route only if needed | Role bypass and API compatibility | RBAC and malformed input |
| `restaurant-server/controllers/printerController.js` | Existing potentially requiring modification | Queue projection/status/device CRUD | Return additive device health/routing fields; keep old response shape | Secrets/PII exposure | Response contract and redaction |
| `restaurant-server/services/kotService.js` | Existing reuse; avoid change initially | Creates original and change KOT jobs | Keep job authority; only adapt to a versioned envelope at delivery boundary | KOT duplicates or altered historical items | Existing KOT idempotency and payload fixtures |
| `restaurant-server/controllers/adminController.js` | Existing reuse; avoid change initially | Creates authoritative bill payload and `BillPrintJob` | Keep billing/payload logic; adapter may add version metadata without recalculation | Bill totals/payment regressions | Bill field/combined bill/AC/payment tests |
| `restaurant-server/controllers/combinedBillController.js` | Existing reuse; avoid change initially | Combined bill workflow | No business change; route output through same print assignment | Duplicate combined bills | Existing request-key and print job tests |
| `restaurant-server/services/printerDeviceService.js::expireOldPrintJobs` | Existing reuse | 30-minute waiting-job expiry | Android reconciliation must honor it; do not diverge silently | Old jobs unexpectedly reprinted | Expiry/reconnect tests |
| `print-service/src/socketClient.js` | Existing reuse; avoid change initially | Windows socket and queue reconciliation | Keep wire compatibility; only modify if shared assigned protocol is deliberately added | Existing clients stop printing | Full print-service integration suite |
| `print-service/src/queue.js` | Existing reuse | Durable JSON queue/dedupe/retry/recovery | Use as behavioral reference for Android queue, not copied code | Duplicate/lost jobs | Queue persistence/restart/failure tests |
| `print-service/src/processor.js` | Existing reuse/reference | Render and print KOT/bill, two bill copies, report status | Use fixtures/semantics; do not assume Windows renderer runs on Android | Layout and copy-count mismatch | Renderer and physical fixture tests |
| `print-service/src/renderers/kotRenderer.js` | Existing reuse/reference | KOT intermediate line/image representation | Treat as reference or extract a separately tested shared representation later | Bengali/add-on/table differences | Golden KOT fixtures |
| `print-service/src/renderers/billRenderer.js` | Existing reuse/reference | Bill intermediate line/image representation | Treat as reference; preserve backend totals | Bill/payment/QR regressions | Golden bill fixtures |
| `print-service/src/renderers/layout.js` | Existing reuse/reference | Width, wrapping, money, labels | Define compatibility fixtures; do not port blindly | 58/80 mm drift | Width/wrap/money tests |
| `print-service/src/textImage.js` | Existing Windows-only reference | PowerShell/System.Drawing Bengali rasterization | Android requires a separate renderer/font path | Unsupported glyphs and layout drift | Bengali bitmap tests on real device |
| `print-service/src/logo.js` | Existing reference | Logo fetch/cache/monochrome bitmap | Reproduce bitmap acceptance behavior on Android | Network/cache/image size | Logo offline/cache tests |
| `print-service/src/payQr.js` | Existing reference | Payment QR decode/generation | Preserve QR fixture semantics | Unscannable QR or wrong amount | QR decode/scan tests |
| `print-service/src/drivers/lanDriver.js` | Existing reference | TCP/9100-style LAN ESC/POS through Node | Android equivalent transport only after printer test | Protocol/model mismatch | Mock socket + physical tests |
| `print-service/src/drivers/usbDirectDriver.js` | Existing reference only | Node USB device discovery and bulk OUT writes | Do not port directly; implement Kotlin USB driver for certified devices | OTG/power/endpoint conflicts | Descriptor and physical USB tests |
| `admin/src/pages/admin/shared/PrintServiceCard.jsx` | Existing potentially requiring modification | PC service/device key/status dashboard | Add Android device kind/station/health UI without exposing key | Admin confusion, accidental routing | UI/RBAC/legacy PC tests |
| `admin/src/services/adminService.js` | Existing potentially requiring modification | Admin print/bill/device service calls | Add typed Android enrollment/status calls only if backend adds them | API mismatch | Service mock tests |
| `print-service/test/integration.test.js` | Documentation/testing only; existing reuse | Real local Socket.IO contract tests | Add backward-compatibility tests for new routing/claims | False confidence if only mocks | Legacy + new contract tests |
| `print-service/test/queue.test.js` | Documentation/testing only; existing reuse | Queue persistence/dedupe tests | Mirror invariants in Android queue tests | Divergent semantics | Restart/duplicate/expiry tests |
| New Android project (path currently unknown) | New Android module; inaccessible/not present | None exists in repository | Setup UI, agent service, queue, socket client, renderer, LAN/USB transports, diagnostics | OS lifecycle, security, hardware support | Kotlin unit/instrumentation/device/physical tests |
| `docs/audit/zen-os-android-print-agent-*` | Documentation/testing only | Design artifacts created by this task | Maintain contract/support matrix/rollout docs | Out-of-date design | Review against source before coding |

## 11. Contract test matrix

| Area | Test | Expected evidence |
|---|---|---|
| Authentication | Valid, invalid, revoked, wrong-tenant credentials | Connection acceptance/rejection and no cross-tenant jobs |
| Queue | Initial pull, live push, duplicate push/pull, reconnect | One local terminal job per server job ID |
| Assignment | KOT/BILL/station matching; two-agent claim race | Exactly one lease winner; unauthorized station denied |
| Status | Printing, success, retryable failure, final failure, uncertain | Correct server mapping and operator-visible reason |
| Recovery | App kill, device reboot, Wi-Fi loss, backend restart | Queue survives and reconciliation does not blindly reprint |
| Rendering | Bengali, add-ons, AC charge, logo, QR, 58/80 mm | Golden intermediate output and approved physical print |
| Security | Payload size, arbitrary bytes, PII log scan, revoked device | Requests rejected safely and logs redacted |
| Compatibility | Existing Windows integration suite | No regression to current service |

## 12. Cost and effort estimates

These are rough person-day ranges, excluding printer purchases, field travel, app-store fees, hardware certification delays, and ongoing support.

| Work package | Estimate | Assumptions |
|---|---:|---|
| LAN-only proof of concept | 10–15 days | One Android device, one validated LAN printer, current socket contract, mock/fake backend tests |
| Production LAN agent | 25–40 days | Durable queue, secure enrollment, diagnostics, restart/retry, monitoring, one printer family, staged backend assignment |
| USB OTG certified transport | 15–30 additional days | One known model family, descriptor access, powered OTG hardware, physical tests |
| Multi-printer/station routing | 10–20 additional days | Backend assignment/lease, Admin configuration, kitchen/counter/drinks testing |
| Rendering/Bengali/logo/QR parity | 10–20 additional days | Android raster pipeline and physical acceptance fixtures |
| Monitoring/support/onboarding | 10–20 additional days | Device health, credential revocation, support playbooks, update/rollback path |

**Source-based inference:** the earlier audit estimate of 30–50 person-days for a production USB+LAN baseline is compatible with these decomposed ranges, but actual effort depends heavily on the Android project starting point and target printer family.

## 13. Operational requirements

### Hardware

- Fixed, continuously powered Android device is preferred over a waiter’s phone.
- Device must support the selected Android version, Wi-Fi, and any required USB host mode.
- Printer must have validated LAN/Wi-Fi or USB OTG compatibility.
- For multiple stations, each printer needs a stable identity and routing assignment.

### Network

- Restaurant LAN must allow agent-to-printer traffic.
- Customer Wi-Fi isolation must not block the agent.
- Printer IPs should be reserved or otherwise managed.
- No public exposure of raw printer ports.

### Maintenance

- Android OS/app updates can affect USB permission, background execution, and network behavior.
- Printer firmware, paper, and model changes require compatibility review.
- Device keys need revocation/rotation procedures.
- Staff need a visible fallback procedure when Android or printer is offline.

## 14. Open questions before implementation

1. Is there an isolated Android project outside this repository? It was not present or accessible during this audit.
2. What exact Android device and Android version will be supported?
3. Is the business willing to operate a fixed Android box rather than a personal phone?
4. What exact printer model and interface will be certified first?
5. Does the target printer accept raw TCP 9100 and Epson-compatible ESC/POS?
6. Should Windows and Android ever be active for the same station concurrently?
7. Does the restaurant require independent kitchen/counter/drinks routing at launch?
8. What is the approved policy for uncertain output after lost acknowledgement?
9. Is server-side claim/lease required at launch, or can the pilot guarantee one active agent per role?
10. Which Android font/raster library is acceptable for Bengali, and what license/support constraints apply?
11. Which app distribution/update channel is acceptable for restaurant devices?

## 15. Final recommendation

Proceed with a non-production LAN-only Android proof of concept using the existing printer-key Socket.IO contract, a new durable Android queue, and one validated printer. Do not change the Windows service or order/billing logic in the first prototype. Before production or multi-agent coexistence, add assigned routing/lease semantics, secure Android enrollment, and physical acceptance tests. Treat USB OTG and the reported `SP POS893 USD` printer as separate compatibility work, not a promise.

## 16. External references

Accessed 2026-10-28:

- [Android USB host overview](https://developer.android.com/develop/connectivity/usb/host)
- [Android `UsbManager` reference](https://developer.android.com/reference/android/hardware/usb/UsbManager)
- [Android process lifecycle](https://developer.android.com/guide/components/activities/process-lifecycle)
- [Android services overview](https://developer.android.com/develop/background-work/services)
- [Android foreground services](https://developer.android.com/develop/background-work/services/fgs)
- [Android foreground-service launch restrictions](https://developer.android.com/develop/background-work/services/fgs/launch)
- [Chrome WebUSB capabilities](https://developer.chrome.com/docs/capabilities/usb)
- [Epson ESC/POS Command Reference](https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/index.html)
