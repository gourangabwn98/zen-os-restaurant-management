# 18 — External Integration Register

Diagram: [`diagrams/17-external-integrations.mmd`](diagrams/17-external-integrations.mmd).

| # | Integration | Purpose | Protocol / API | Auth | Code | Status | Failure behaviour |
|---|---|---|---|---|---|---|---|
| 1 | MongoDB (Atlas cloud / local replica set) | All persistence, transactions | MongoDB driver via Mongoose 9 | URI credentials | `config/db.js` | IMPLEMENTED | request → 503/500; ticks log and retry; LOCAL retries per request |
| 2 | Firebase Authentication | Customer & admin phone login (client SDK), server ID-token verify | Firebase JS SDK / Admin SDK | service account (`FIREBASE_*`) | `utils/firebaseAdmin.js`, `authController` | IMPLEMENTED | login fails; **server crashes at boot without env** |
| 3 | Firebase Cloud Messaging | Offer broadcasts (topic), rider push | Admin SDK `messaging().send`, topics | service account | `notificationService.js`, `deliveryRealtime.js` | IMPLEMENTED (rider push needs `google-services.json`) | offer → FAILED with error; rider still gets socket |
| 4 | PhonePe PG V1 | Online payment (pay page, status, callback) | HTTPS REST `/pg/v1/pay`, `/pg/v1/status`; callback | salt key `X-VERIFY` | `paymentService.js` | IMPLEMENTED | initiate error → customer can pay cash; FAILED attempt keeps order unpaid; unpaid pay-first cancelled at 15 min after last live check |
| 5 | PhonePe Standard Checkout V2, refunds | — | OAuth + `/checkout/v2/*`, `/payments/v2/refund` | client credentials | — | PLANNED | — |
| 6 | UPI deep link / static QR | Pay via UPI app | `upi://pay?…` built client-side; QR printed on bill | none | customer app, `print-service/src/payQr.js` | IMPLEMENTED | never proof; staff verify |
| 7 | Twilio | Staff SMS OTP; WhatsApp text (support ticket notify); WhatsApp bill util | Twilio SDK | account SID/token | `utils/sendOTP.js`, `sendWhatsAppText.js`, `sendWhatsAppBill.js` | IMPLEMENTED (WhatsApp bill only wired to test route) | OTP send error → 500; WhatsApp errors swallowed |
| 8 | MSG91 | SMS OTP fallback | HTTPS REST | auth key | `utils/sendOTP.js` | IMPLEMENTED | same |
| 9 | Cloudinary | Menu/category/logo/payment-QR/employee photo/bill-photo uploads | SDK upload stream | API key/secret | `config/cloudinary.js`, `uploadMiddleware.js` | IMPLEMENTED | upload fails; LOCAL offline → fails (O4 local media planned) |
| 10 | Tesseract.js | OCR purchase bills / menu import | in-process WASM; downloads language data | none | `utils/purchaseImportExtract.js` | IMPLEMENTED | first-run download needs internet |
| 11 | Google Maps JS / Directions (browser key) | Admin live map, customer tracking ETA | JS API | referrer-restricted key (UNKNOWN restriction) | admin/customer `utils/googleMaps.js` | IMPLEMENTED (optional) | falls back to schematic, no ETA |
| 12 | Google Routes API (server key) | Rider multi-drop route/ETA | HTTPS REST | `GOOGLE_ROUTES_API_KEY` | `services/routeService.js` | IMPLEMENTED (optional) | `available:false`, never invents ETA |
| 13 | Device GPS (browser / Android) | Dine-in radius; delivery pin; rider tracking | Geolocation API; Android foreground service | permission | `utils/diningRadius.js`, `delivery-app` Kotlin | IMPLEMENTED | dine-in order refused without location (blocked on plain HTTP) |
| 14 | Thermal printers | KOT/bill | TCP 9100, Windows share, WinUSB | none | `print-service/src/drivers/*` | IMPLEMENTED | job waits/retries; skipped after 30 min |
| 15 | Windows OS services (PowerShell GDI+, `copy /b`, `tasklist`) | Bengali raster, USB share print, instance lock | child_process | — | `print-service/src/*` | IMPLEMENTED | text prints as `?`; USB print fails |
| 16 | Windows print service exe | Packaging | Node SEA (esbuild + postject) | — | `scripts/build-exe.mjs` | IMPLEMENTED | — |
| 17 | Android print service | PC-free printing | — | — | — | PROPOSED | — |
| 18 | Render | Backend hosting | git deploy (inferred) | — | `RENDER_GIT_COMMIT` | Inferred | — |
| 19 | Vercel | Frontend hosting | git deploy (inferred) | — | `vercel.json` | Inferred | — |
| 20 | Public DNS 1.1.1.1 / 8.8.8.8 | SRV resolution for Atlas | DNS | — | `server.js:11` | IMPLEMENTED | — |

Dependency chain observations: a restaurant's ability to **log in** depends on Firebase (customers/admins) or Twilio/MSG91 (staff) in cloud mode; **printing** depends on Render + the PC's internet; **payments** online depend on PhonePe + Render reachable by PhonePe.
