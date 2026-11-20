# Diagram Generation Prompts — Zen OS

Use with any diagramming AI (Mermaid, PlantUML, draw.io, Excalidraw, image tools). Paste **[project-context.md](project-context.md)** first, then one prompt. Ready-made Mermaid sources for every diagram already exist in [`../diagrams/`](../diagrams/README.md); these prompts are for regenerating or restyling them.

## Global rules (prepend to every prompt)

> You are drawing an architecture diagram for Zen OS, a single-restaurant POS system. Use ONLY the elements and relationships listed in this prompt and the project context. Do not add services, databases, queues, caches, load balancers, cloud products, or integrations that are not listed. Mark anything labelled PLANNED or PROPOSED with a dashed border/line and the label text. Mark inferred hosting with "(inferred)". Do not include hostnames, IPs, phone numbers, keys or credentials. Keep one level of abstraction per diagram; at most ~15 boxes.

---

### P1 — System context
Draw a C4 system-context diagram. Center: "Zen OS". People: Admin/Owner, Manager, Inventory manager, Waiter, Chef, Customer, Delivery partner. External systems: MongoDB, Firebase (Auth + FCM), PhonePe PG V1 (two-way: calls and callback), Twilio/MSG91, Cloudinary, Google Maps/Routes, Thermal printers. Each person uses Zen OS through their own app (name the app on the arrow).

### P2 — Container diagram (production)
Containers: Admin app (React 19 PWA), Waiter app (React 18 PWA), Kitchen app (React 18 PWA), Customer app (React 18 SPA), Delivery app (React Native + Kotlin), restaurant-server (Node 22, Express 5, Socket.IO 4, ticks), MongoDB (Atlas, inferred), print-service (Windows exe with disk queue, at the restaurant), Printers. Arrows: apps → server "HTTPS REST + WSS (JWT)"; server → MongoDB; print-service → server "outbound WSS, printer key"; print-service → printers "ESC/POS". Hosting group labels: Vercel (inferred) for admin/customer/waiter; kitchen hosting UNKNOWN; Render (inferred) for the server.

### P3 — Container diagram (Offline Edition)
One box "Restaurant PC" containing: restaurant-server (DEPLOYMENT_MODE=LOCAL), MongoDB replica set (127.0.0.1), static web apps on ports 8080–8083, print-service → localhost. Outside: staff devices (PIN login on approved devices) and customer phones on Wi-Fi (customer ordering PLANNED O3, dashed). A dashed arrow to "Cloud mirror + relay — PLANNED, not approved". Label the PC "O1/O2 implemented, uncommitted".

### P4 — Backend components
Inside restaurant-server: HTTP routes/controllers (25 files, 276 handlers); Auth & RBAC middleware; Order service; KOT service; Billing service; Payment service (PhonePe V1, pay-first); Inventory service; Menu services; Staff services; Delivery service; Printer device service; Socket hub; Background ticks (15 s auto-send, 60 s pay-first, 5 s delivery, 30 s offers, 60 s category reset); Offline Edition auth (LOCAL only); Data models → MongoDB. Show: Order service → KOT service and Inventory service "in one transaction"; ticks → Order/Payment/Delivery services; services → Socket hub "emit".

### P5 — Print-service components
Socket client (printer key; get-queue on connect and every 5 s; status reports) → Local queue (data/queue.json, PRINTED terminal) → Processor (retry with backoff; waits while printer offline) → Renderers (KOT, bill, logo, pay QR, Bengali via Windows GDI+) → Printer manager (role KOT/BILL/BOTH) → drivers LAN 9100, USB via Windows share, USB_DIRECT → printers.

### P6 — Order lifecycle state diagram
States and transitions exactly as in [workflow-architecture-brief.md](workflow-architecture-brief.md) table. Annotate CONFIRMED→PREPARING with "stock + KOT in one transaction". Annotate COMPLETED transitions with "PAID required".

### P7 — Customer QR order sequence
Lifelines: Customer, Customer app, Backend, MongoDB, Waiter, Auto-send tick, print-service. Steps as in workflow brief flow 1. Show the edit window as a note.

### P8 — KOT and change-slip flow
Flowchart: sendToKitchenTx → KOTJob (unique per order); edit after KOT → KOTChangeJob (unique per revision, only differences) and "status back to PREPARING if items added"; follow-up order → its own KOT; all → printers room and get-queue.

### P9 — Print job status lifecycle
States PENDING, PRINTING, PRINTED, FAILED, SKIPPED. PRINTING→PENDING when printer offline (no attempt used); FAILED→PRINTING retry below MAX_ATTEMPTS; PENDING/FAILED→SKIPPED when older than 30 min or admin skip.

### P10 — Payment lifecycle
Two state machines side by side: order paymentStatus (PENDING_VERIFICATION→PAID by staff / verified PhonePe / COD verify; PAID→PENDING_VERIFICATION admin undo) and PhonePe attempt (CREATED→PENDING→SUCCESS / AMOUNT_MISMATCH (final) / FAILED→PENDING retry).

### P11 — PhonePe pay-first sequence
Lifelines: Customer, Customer app, Backend, PhonePe, Pay-first tick. Steps: order AWAITING_PAYMENT → initiate (server amount) → redirect → pay → callback with X-VERIFY → constant-time verify → atomic apply with amount check → PENDING_CONFIRMATION → status poll on return → tick cancels unpaid after 15 min.

### P12 — Socket.IO rooms and events
Rooms as boxes: tenant (all incl. anonymous), staff, kitchen (chef only, PII-stripped), printers, order:{id}, user:{id}, delivery-admin, track:{jobId}. Event groups into each room per [system-architecture-brief.md](system-architecture-brief.md). Show in red "LEGACY full-order events → tenant room (defect, to remove)".

### P13 — Database ERD
Entities and cardinalities from [database-architecture-brief.md](database-architecture-brief.md) "Key relationships". Split into three diagrams if needed: orders/floor/printing; inventory; people/delivery.

### P14 — Restricted vs Full offline comparison
Three panels: F (full local-primary — approved design), R1 (local-primary + server capability gate — PROPOSED), R2 (cloud-primary with local failover — PROPOSED, not recommended, "two writers"). All dashed except the local server + replica set + PIN login (implemented).

### P15 — Synchronization sequence (PLANNED)
Lifelines: Site MongoDB, Sync agent, Outbox, Cloud ingest, Mirror. Change stream → outbox row with syncSeq → batch push → upsert if newer → per-row ack → advance watermark; inbox items re-executed on site. Title must say "PLANNED — not approved".

### P16 — Authentication and authorization flow
Flowchart: Bearer JWT → verify → load user → inactive? 403 → LOCAL mode? check device-bound session → role check → manager scope → waiter duty gate → service-level role/ownership checks. Side panel: login methods (Firebase phone, backend SMS OTP, LOCAL phone+PIN on approved device, printer key).

### P17 — Deployment
Production (inferred hosting) and Offline Edition side by side, as in [infrastructure-architecture-brief.md](infrastructure-architecture-brief.md). Mark CI/CD and monitoring as "ABSENT".

### P18 — Threat model
Trust boundaries B1 internet clients, B2 PhonePe callback, B3 staff JWT, B4 printer key, B5 git repository artifacts, B6 restaurant LAN; annotate top threats: committed printer key (critical), anonymous socket PII, unauthenticated test route, inactive staff sockets.

### P19 — Android print agent (PROPOSED)
Entire diagram dashed and titled "PROPOSED — no code". Backend printers room → Android foreground service → durable queue → renderer (ESC/POS + bitmap Bengali) → LAN printer; USB OTG later; Windows print-service kept in parallel.

### P20 — Implementation roadmap
Flow of phases 0–10 from `17-implementation-roadmap.md`; title "PROPOSED — requires owner approval per phase".
