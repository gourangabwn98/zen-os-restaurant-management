# 12 — Local HTTPS: Certificate Strategy (Decision 4, revised)

Status: **PROPOSAL for approval. Nothing here is implemented.** O1 serves plain HTTP only.
Implementation is phase O5, after you approve this document.

You asked not to assume HTTP is enough for customers, and to investigate trust, PWA install,
geolocation, QR compatibility and devices. Short version: **plain HTTP is not enough for either group
with today's code.** It breaks real features (§1). The hard part is customers. Their phones can't be
asked to install a certificate, and a publicly trusted certificate depends on DNS, which an offline
restaurant may not have (§3).

---

## 1. What plain `http://<PC-IP>` breaks today (found in the code)

Browsers treat `http://192.168.x.x` as an **insecure context**. Only `https://` and
`http://localhost` count as secure. On an insecure page these APIs are missing or refused:

| Browser API (secure context only) | Used by | Effect over `http://<PC-IP>` |
|---|---|---|
| Geolocation | customer `hooks/useLocationGate.js`; server `utils/diningRadius.js:28` requires a location for **customer dine-in** | **Customer QR dine-in ordering fails** ("A valid device location is required") |
| `crypto.randomUUID()` | admin `services/inventoryV3Service.js:5` (request key on every inventory-v3 write) | **Admin purchases / stock operations throw** (`crypto.randomUUID is not a function`) |
| Clipboard (`navigator.clipboard`) | admin `TablesPage.jsx:183` (unguarded); customer offers/coupon/tracking copy (guarded) | Admin "copy QR link" crashes; customer copy buttons silently do nothing |
| Service workers | waiter/kitchen/admin PWA shell (`pwa/registerPwa.js`, guarded) | No offline app shell, no "install app", no auto-update prompt. Pages still work while the PC is reachable. |
| PWA install (Chrome) | staff apps | "Install app" not offered. Kitchen/waiter can't run as standalone apps. |
| Push (FCM web push) | customer `services/notificationService.js` (guarded) | Not available. It needs internet anyway, so it doesn't matter offline. |

The IndexedDB "last loaded data" cache (commit ff0d526) works on insecure pages too, so it is not affected.

**Conclusion:** staff apps **must** be HTTPS. For customers, geolocation is the one feature that matters
offline, and it is mandatory today.

## 2. Staff devices: per-restaurant private CA (recommended, no internet ever needed)

* At install, the PC creates a **restaurant root CA** (10-year validity) and a **server certificate**
  for the PC's fixed IP (IP SAN) plus a LAN hostname. Server-certificate validity is **≤ 397 days**,
  renewed automatically by the PC with no internet. Apple requires ≤ 825 days, a SAN and
  `serverAuth` EKU even for user-installed roots. 397 days leaves margin.
* **Name Constraints** on the root CA limit it to this restaurant's private IP range and LAN hostname.
  If the PC (and its CA key) is ever stolen, the key cannot be used to impersonate other websites
  to paired staff phones. *Verify on iOS and Android in O5 that both enforce name constraints on
  user-installed roots. If either does not, we fall back to a short CA lifetime + rotation.*
* The CA key never leaves the PC, is stored encrypted with Windows DPAPI, and is never synced to the cloud.
* **Installing the CA on a device happens as part of O2 device registration** (decision 3). The admin
  registers the device, and the device installs the CA from a pairing page. Revoking a device (decision 3)
  revokes its login. It cannot remove the CA from the phone, which is why the name constraints matter.
* Mixed content: an HTTPS page can only call an HTTPS API. Staff apps and the staff API listener move
  to TLS ports (e.g. 8443-8445 apps, 5443 API). The generated `/config.js` (O1) already copies the
  page's own protocol, so no app change is needed for that.

Per platform (to verify on real devices in O5):

| Platform | How the CA is trusted | Notes |
|---|---|---|
| Android 9+ (Chrome) | Settings → Security → Encryption & credentials → Install a certificate → CA certificate | Needs a screen lock. Android shows a persistent "network may be monitored" notice (UX only). Chrome and installed PWAs honour user CAs. |
| iOS / iPadOS 16.4+ (Safari, Home-Screen apps) | Download profile (.mobileconfig) → Settings → Install → **then** Settings → General → About → Certificate Trust Settings → enable full trust | The second step is easy to miss. The pairing page must show it with screenshots. |
| Windows kitchen/admin PC (Chrome/Edge) | Import into "Trusted Root Certification Authorities" (the pairing tool can do it) | Firefox has its own store. Not a supported staff browser. |
| Zen OS Delivery app (Capacitor, native) | Needs `network_security_config` trusting user CAs | Part of O8. A per-site CA can't be bundled into one APK. |

## 3. Customer phones: the real trade-off

A customer's phone will not have our CA installed, and we can't ask for it. For a customer to get a
padlock with zero setup, the server needs a certificate from a **public CA**. A public CA can only
issue for a **domain name** (never for a private IP like 192.168.1.20), and a domain name needs **DNS**.
When the internet is down, phones get no DNS from the ISP. So the only way a hostname still resolves
offline is a **DNS server inside the restaurant**: the PC or the router.

### Option C1: HTTP for customers + "on the restaurant Wi-Fi" replaces GPS
* Customer app stays `http://<PC-IP>:8080`. The QR code encodes the IP, so it opens with no DNS
  and no internet, on any phone.
* In LOCAL mode the server accepts **a request arriving from the restaurant LAN with a valid table QR
  token** as proof of presence, instead of browser GPS. It is decided from the TCP peer address
  (`local/lanOnly.js`), never a header. This is arguably *stronger* than GPS (which can be spoofed) and fits
  decision 2 (guest ordering over Wi-Fi, waiter confirmation mandatory).
* Costs: the browser shows "Not secure". Traffic is protected only by the Wi-Fi password (WPA2/3), so
  guest name and phone could be read by someone on the same Wi-Fi who captures traffic. No PWA install
  (not needed for a table order) and no copy buttons. Payment pages never run here: PhonePe is off
  offline, and cash/UPI is handled by staff.
* Needs: a server rule change in LOCAL mode only (O3), plus the customer app skipping the location
  gate when the server says LAN presence is enough. The cloud rule is unchanged.

### Option C2: Publicly trusted HTTPS for customers
* Each restaurant gets a Zen-owned hostname, e.g. `<site-id>.lan.<zen-domain>`, with a certificate
  from a public CA (ACME / Let's Encrypt **DNS-01**, issued by a Zen cloud service that holds the
  DNS credentials. The PC never holds them).
* Offline resolution: the PC runs a small DNS server that answers that hostname with its own IP, and
  the **router must hand out the PC as DNS** (DHCP setting), or the router must support a local DNS entry.
* Costs and risks:
  * **Cert renewal needs internet.** Public certificates last 90 days today, and the CA/Browser Forum
    has voted to shorten the maximum in steps over the next years. If a restaurant stays offline past
    expiry, every customer gets a full-page certificate error. That is worse than C1's "Not secure".
  * **Router dependency.** Many ISP-supplied routers cannot change the DHCP DNS server or add local
    entries. Making the PC the DHCP server is intrusive and risky. If DNS isn't there, the QR code opens
    **nothing at all** offline.
  * Some routers block public names that resolve to private IPs (DNS-rebinding protection).
  * Needs a domain plus a cloud issuance service. That is cloud-side work, which needs separate approval like decision 6.
* Benefit: padlock, geolocation, clipboard and install all work on every phone with no setup.

### Option C3: C2 when DNS + cert are healthy, C1 as fallback
Two QR codes per table can't be explained to customers, and a single QR can't fall back from a
failed DNS name to an IP. **Not practical**, so it is not recommended.

## 4. Recommended final strategy (for your approval)

| Group | Strategy | Works with no internet | Setup per device |
|---|---|---|---|
| Admin, manager, waiter, chef (and riders on the LAN) | **HTTPS, per-restaurant private CA, name-constrained, auto-renewed locally** (§2) | Yes, indefinitely | One-time CA install during device registration (O2) |
| Customers | **C1: HTTP + LAN-presence instead of GPS** (§3) | Yes | None |
| Customers, later and optional | C2 per site, **only** after a lab spike shows the site's router supports local DNS. Treated as a separate approval with the cloud issuance service | Only while the certificate is valid and the PC is the DNS | None |

Why: C1 is the only customer option whose QR code is **guaranteed** to open with the internet down,
on any phone, with any router. C1's costs (padlock, Wi-Fi-level privacy) are real and are written out
above so you can weigh them. C2 can be added per site later without reprinting anything for staff.

## 5. Other checks done
* **QR compatibility:** a QR containing `http://192.168.1.20:8080/?table=3&t=…` opens directly in the
  Android and iOS camera apps. Only http(s) URLs open in one tap (see `utils/qrLink.js` TBL-01).
  `utils/qrLink.js` already accepts an `http://` LAN base. To verify on devices in O3/O5.
* **Chrome "Local Network Access" restrictions** target *public* websites calling *private* addresses.
  Our apps are themselves served from the LAN and call the LAN, so they shouldn't be affected. **Never**
  load an app from the cloud and point it at the PC. To verify on current Chrome in O5.
* **Phones on mobile data** can't reach the PC under any option. Customers must join the restaurant
  Wi-Fi. A Wi-Fi QR (join code) next to the table QR helps.
* **Guest Wi-Fi with client isolation** blocks phones from reaching the PC. Use a network that can see the PC.

## 6. Tooling note (for O5 approval)
Node's built-in `crypto` can create keys but not X.509 certificates. O5 will need either one small,
pure-JavaScript dependency (e.g. `node-forge`) or a bundled `openssl.exe`. That choice will be put to
you with O5, per "no unnecessary dependencies".

## 7. Supported devices (proposal, to confirm in O11 pilot testing)
* Android 9+ with current Chrome (staff and customers).
* iOS / iPadOS 16.4+ with Safari (staff and customers).
* Windows 10/11 with current Chrome or Edge (admin PC, kitchen screen).
