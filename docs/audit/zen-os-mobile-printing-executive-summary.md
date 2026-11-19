# Zen OS mobile printing — founder/client summary

**Date:** 2026-10-28  
**Audit mode:** read-only; no code, printer, database, or production changes.

## The business problem

Zen OS currently needs a small computer at the restaurant for automatic KOT and bill printing. The web apps can run on phones, but the physical printer connection is handled by `SohojPrintService.exe`, a Windows-local service. The cloud backend creates and tracks print jobs; the Windows service receives them and sends ESC/POS data to the printer.

This computer is not needed for taking orders or using the kitchen screen. It is needed as the local bridge to USB/private-LAN printer hardware.

## What already works in the current design

- KOT and bill jobs are stored before delivery to the printer.
- A dedicated printer-device key is used instead of a staff password.
- Socket.IO pushes jobs, while reconnect and queue polling recover missed jobs.
- The local queue survives service restarts and prevents ordinary duplicate delivery by job ID.
- LAN, Windows-shared USB, and direct USB printer drivers exist in the Windows service.
- Bills and KOTs have separate layouts; logos, payment QR codes, and Bengali/non-Latin text have explicit rendering paths.
- Failed/offline jobs remain visible and retry according to configured policy.

These facts are verified from repository code. Physical printer output was not tested in this audit.

## PC-free approaches

### Best first option: Android LAN print agent

A dedicated Android app or fixed Android box would connect to the restaurant Wi-Fi, receive authenticated jobs from the backend, keep a durable local queue, and send ESC/POS data to supported network printers. This avoids a PC and is the most practical first product path for multiple stations.

### Second option: Android USB OTG

An Android app can communicate with a compatible USB printer through OTG, but it needs USB host support, user permission, correct interface/endpoint handling, sufficient power, and a model-specific printer test. It is viable for selected hardware, not a generic promise for every cheap thermal printer.

### Browser-only printing

A normal mobile browser is not a dependable automatic printer agent. WebUSB is permission- and user-gesture-based and has compatibility limits; browser background execution and arbitrary LAN sockets are not a safe foundation for automatic KOT printing.

### Cloud backend directly to the printer

Not recommended. A cloud server normally cannot reach a printer on the restaurant’s private network without a tunnel or exposed port. Exposing a printer to the internet would create security and reliability problems.

## Recommendation

1. Keep the existing Windows print service for current restaurants.
2. Build an optional Android print agent as a separate product component.
3. Start with validated LAN thermal printers and a fixed Android device.
4. Add USB OTG only after testing the exact printer models clients will buy.
5. Preserve the existing backend job IDs, staff authorization, queue, retry, and status model.
6. Roll out at one test restaurant before promising broad PC-free compatibility.

## Main costs and risks

- Android agent development, secure enrollment, queue recovery, monitoring, and updates.
- Physical testing for every supported printer model and paper width.
- Bengali, logo, QR, and cut/raster compatibility.
- Wi-Fi quality and printer network isolation.
- Android battery optimization, process death, foreground-service rules, and device restarts.
- Duplicate-versus-lost output decisions when a printer accepts bytes but the app crashes before acknowledgement.
- Support and replacement logistics for a fixed Android edge device.

The audit estimate for a production baseline is approximately 30–50 person-days for an Android agent supporting both USB and LAN, before hardware certification and rollout operations. LAN-first can be smaller; these are estimates, not quotes.

## What must be verified before selling “PC-free printing”

- Exact manufacturer/model of the proposed `SP POS893 USD` printer.
- USB VID/PID and USB interface/endpoint details.
- ESC/POS compatibility and actual TCP/LAN protocol.
- Android phone/box model, OTG adapter, and power supply.
- Actual Bengali, logo, QR, KOT, bill, paper-width, and cut output.
- Recovery after internet loss, Wi-Fi loss, paper-out, printer power loss, app kill, and Android restart.
- Multi-printer routing for kitchen, counter, and drinks.
- Secure device enrollment and revocation.
- One-restaurant pilot acceptance during real operating hours.

Until those checks are complete, the safe promise is **PC-free printing for explicitly validated Android/printer combinations**, not universal Android printing.

## Report

See the full evidence and file-by-file impact map in [zen-os-mobile-printing-feasibility-report.md](zen-os-mobile-printing-feasibility-report.md).

