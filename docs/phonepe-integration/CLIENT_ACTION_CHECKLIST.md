# Client Action Checklist — PhonePe Online Payments for Hotel KHOAI

## A. What the Hotel KHOAI client must obtain

- [ ] Apply for **PhonePe Payment Gateway** (separate from the Soundbox): `https://business.phonepe.com/pg/register`, or ask the PhonePe relationship manager.
- [ ] Ask PhonePe whether PG can be added to the **existing Soundbox merchant account**, or whether a new PG merchant registration is needed.
- [ ] **Explicitly request Standard Checkout V2 credentials** (Client ID / Client Secret / Client Version).
- [ ] Complete PG KYC. Typical documents (confirm the exact list with PhonePe): business PAN, owner PAN + Aadhaar, GSTIN, Shop & Establishment / Udyam / FSSAI, bank proof (cancelled cheque) in the business name, address proof.
- [ ] Get **written confirmation** of: MDR per payment mode, any setup/annual fee, settlement cycle and bank account, refund charges/timelines, and approval of the restaurant business category.
- [ ] Give us dashboard access (or a developer login) so we can read **Developer Settings** in **Test Mode** (UAT credentials) and later in Production mode. Credentials must be passed to us **privately**, never by email or WhatsApp in plain text if avoidable.
- [ ] Choose a webhook username and password with us. We create them; they go only into the server `.env`.
- [ ] Approve the website policy pages we draft (Terms, Privacy, Refund & Cancellation, Contact) and give us the legal business name, address, support phone and email to show on them.

## B. What the PhonePe team must activate or provide

- [ ] Activate the PhonePe PG product on the merchant account.
- [ ] Issue **UAT (sandbox)** V2 credentials: Client ID, Client Secret, Client Version, Merchant ID.
- [ ] Configure the **UAT webhook URL** we send them (`https://<api-domain>/api/payments/phonepe/webhook`).
- [ ] Whitelist our **redirect/callback domain(s)** (customer app domain), to avoid the "Internal Security Block".
- [ ] Provide Test App (simulator) access (Android `com.phonepe.simulator`; iOS invite if needed).
- [ ] Run **UAT verification and sign-off** on our sandbox build.
- [ ] After sign-off, issue **Production** credentials and confirm the live webhook setup in the dashboard.

## C. What we (developers) must configure and implement

*Pending your approval. Nothing below has been done yet.*

Code (see `INTEGRATION_GAP_ANALYSIS.md`):
- [ ] **G6** Fix the `PHONEPE_ENV` mismatch (`PROD` currently means sandbox).
- [ ] **G7** Mark PAID only when the gateway amount equals the order amount.
- [ ] **G1–G5** Add the V2 path to `paymentService.js`: OAuth token cache, `/checkout/v2/pay`, `/checkout/v2/order/{id}/status`, new `/api/payments/phonepe/webhook` with header verification and a status re-check. V1 stays as a fallback.
- [ ] **G8–G9** Reconcile every PENDING attempt on PhonePe's polling schedule, not only pay-first ones.
- [ ] **G10** Refund API + refund status + admin Refund action; handle "paid after cancelled".
- [ ] **G11** Admin "Re-check payment" button.
- [ ] **G13** Static policy pages in the customer app, linked from the footer and checkout.
- [ ] **G14** Fix the stale `payFirst.test.js` fixture; add V2 tests.
- [ ] **G15** Update `CLAUDE.md` "Payment" and `.env.example` with the V2 variables.

Configuration:
- [ ] Backend deployed on **public HTTPS** (`PUBLIC_API_URL`); customer app on HTTPS (`CLIENT_URL`).
- [ ] `.env` on the server: `PHONEPE_API_VERSION=V2`, `PHONEPE_ENV=SANDBOX`, Client ID/Secret/Version, Merchant ID, webhook username/password.
- [ ] Admin → Profile → Payment mode = **ONLINE** or **BOTH**; for delivery, enable online in delivery settings.

UAT test cases (with the PhonePe Test App):
- [ ] Success → order PAID, promoted to staff, invoice shows the PhonePe transaction id.
- [ ] Failure → order unpaid; retry works.
- [ ] Pending → shows pending; resolves later via webhook/tick.
- [ ] Browser closed after paying → still marked PAID (webhook / tick).
- [ ] Forged/invalid webhook → rejected; order unchanged.
- [ ] Duplicate webhook → no double effect.
- [ ] Unpaid → auto-cancel at the deadline.
- [ ] Refund full / partial → refund state reaches COMPLETED.
- [ ] Token expiry → refreshed automatically.

## D. Required before going live

- [ ] PhonePe **UAT sign-off** received.
- [ ] Production credentials in the server `.env` (never in Git), `PHONEPE_ENV=PRODUCTION`.
- [ ] Hosts switched to production (auth `…/apis/identity-manager`, APIs `…/apis/pg`). This is automatic from `PHONEPE_ENV` once implemented.
- [ ] Production webhook configured in the Business Dashboard (Test Mode OFF) pointing at the live HTTPS backend.
- [ ] Start-up security check shows **no PhonePe warnings**.
- [ ] All backend tests green; all four frontends build (`npm run build`).
- [ ] Policy pages live and linked.
- [ ] One **real ₹1–₹10 live transaction** by the owner, checked end to end (PAID, appears in Admin invoice and in the PhonePe dashboard), then refunded.
- [ ] Staff briefed: gateway orders arrive already Paid; cash/UPI-link orders still need manual "Mark paid".
- [ ] A plan for any payment that comes in after an order was cancelled (refund owner and process).
