# System Architecture Brief — Zen OS

## Style
Server-authoritative modular monolith + thin clients + on-premises print bridge. Real-time by Socket.IO role-scoped rooms; clients refetch on events.

## Containers and interactions (IMPLEMENTED)
| From | To | Protocol | Auth |
|---|---|---|---|
| admin, waiter, kitchen, customer, delivery-app | restaurant-server REST `/api/*` | HTTPS JSON | Bearer JWT (customers may be guests for some reads; guest order token header) |
| same | restaurant-server Socket.IO | WSS | JWT in handshake, or anonymous guest |
| print-service | restaurant-server Socket.IO | WSS outbound from restaurant | printer key (hash stored server-side) |
| restaurant-server | MongoDB | wire protocol | URI credentials; transactions need a replica set |
| restaurant-server | PhonePe V1 | HTTPS `/pg/v1/pay`, `/pg/v1/status` | X-VERIFY (salt key) |
| PhonePe | restaurant-server `/api/payments/phonepe/callback` | HTTPS | X-VERIFY checked in constant time |
| restaurant-server | Firebase (verify ID tokens, FCM), Twilio/MSG91 (OTP, WhatsApp), Cloudinary (images), Google Routes (ETA) | HTTPS | API keys in backend env |
| print-service | printers | TCP 9100 / Windows share / WinUSB | none |

## Backend layers
routes (25 files, 276 handlers) → middleware (auth, RBAC, manager scope, waiter duty gate, id validation) → thin controllers → services (business rules, transactions) → Mongoose models (55 collections) → MongoDB. `sockets/socket.js` owns handshake, rooms and all emits. Five in-process ticks: offers 30 s, auto-send to kitchen 15 s, pay-first 60 s, delivery 5 s, category reset 60 s.

## Socket rooms
`tenant` (everyone, incl. anonymous), `staff` (admin, manager, waiter), `kitchen` (chef only; PII-stripped), `printers` (print bridges), `order:{id}`, `user:{id}`, `delivery-admin`, `track:{jobId}`.

## Deployment shapes
* CLOUD_PRIMARY (production): backend on Render (inferred), admin/customer/waiter on Vercel (inferred), kitchen hosting UNKNOWN, MongoDB Atlas (inferred), print-service on a restaurant Windows PC.
* LOCAL_PRIMARY (Offline Edition, O1/O2 uncommitted): backend + MongoDB replica set + the four web apps (ports 8080–8083) on a restaurant PC; staff log in with phone + PIN on admin-approved devices.

## Known defects to show honestly
Legacy socket events send full orders to the anonymous `tenant` room; deactivated staff can still open sockets in cloud mode; printer keys committed in git archives; unauthenticated WhatsApp test route; no CI; single backend instance.

## PLANNED / PROPOSED (draw dashed, label)
Sync agent + cloud mirror/relay (PLANNED, not approved); local HTTPS, installer, backups (PLANNED); LAN customer ordering (PLANNED); restricted-offline capability gate (PROPOSED); Android print agent (PROPOSED); PhonePe V2 + refunds (PLANNED); print job lease + station routing (PROPOSED).
