# Client Requirements — Hotel KHOAI (PhonePe Online Payments)

**Situation:** the client currently has only a **PhonePe Merchant Soundbox / Payment Box** for receiving offline UPI payments at the counter.
**Goal:** customers scan the table QR, order in the Zen OS customer app, pay online with PhonePe, and the order is verified and updated automatically.

> Legend: **[Docs]** = stated in PhonePe's official developer documentation (developer.phonepe.com). **[Confirm]** = not stated in the developer docs; the client must confirm it with PhonePe. We don't guess at these.

---

## 1. Is the Soundbox account enough?

**No. Don't assume it is.**

- A Soundbox runs on PhonePe's **offline merchant (UPI QR) product**. It announces payments made to a static UPI QR. It does **not** provide the API credentials that software needs to create payments and receive verified results.
- Software integration needs the **PhonePe Payment Gateway (PG)**. Its credentials (Client ID, Client Secret, Client Version) are issued by PhonePe PG and shown under **PhonePe Business Dashboard → Developer Settings**. **[Docs]**
- PhonePe PG has its own registration entry point: `https://business.phonepe.com/pg/register` (linked from the developer docs' "Get Started"). **[Docs]**

## 2. Is separate Payment Gateway activation required?

**Yes.** PG is a separate product that has to be activated before any API credentials exist. PhonePe then gives **UAT (sandbox) credentials** first. **Production credentials are issued only after UAT sign-off** by PhonePe's integration team. **[Docs]**

## 3. Can the existing merchant account be upgraded?

**[Confirm].** The developer docs don't say whether an offline/Soundbox merchant can add PG on the same merchant ID or needs a new one. Ask PhonePe:

> "We have a PhonePe Business account with a Soundbox. Can PhonePe Payment Gateway (Standard Checkout V2) be activated on this same account / merchant ID, or do we need a new PG merchant registration?"

## 4. Is a separate merchant registration needed?

Possibly. It depends on PhonePe's answer to §3. Either way the client goes through the **PG onboarding / KYC flow**, which is separate from the Soundbox onboarding. **[Confirm]**

## 5. Documents and business details PhonePe may request

PhonePe's developer docs don't list onboarding documents **[Confirm]**. Indian payment gateways commonly ask for the items below, so the client should prepare them in advance and confirm the exact list with PhonePe:

- Business PAN, and the owner's PAN + Aadhaar (KYC)
- GSTIN certificate (if registered)
- Business registration proof: Shop & Establishment / Udyam / FSSAI licence (relevant for a restaurant)
- Bank account for settlements (cancelled cheque or bank statement), in the business name
- Business address proof
- **A live website / web app URL** where customers pay. For us this is the Zen OS customer ordering site.
- Website policy pages that gateways usually check: **Terms & Conditions, Privacy Policy, Refund & Cancellation Policy, Contact Us** (with address/phone), and visible pricing. *(The customer app doesn't have these yet; see the checklist.)*
- The **redirect / callback domain(s)** to whitelist. PhonePe's FAQ says the callback URL must be shared during onboarding, or redirects can hit a security block. **[Docs]**

## 6. API credentials required

For PhonePe PG **Standard Checkout V2** **[Docs]**:

| Credential | Purpose |
|---|---|
| **Client ID** | OAuth token request |
| **Client Secret** | OAuth token request (secret, backend only) |
| **Client Version** | OAuth token request |
| **Merchant ID** | Identifies the merchant (used in SDK/test app, some headers) |
| **Webhook Username + Password** (we choose these in the dashboard) | Authenticates PhonePe's webhook calls to our backend |

If PhonePe instead issues **Salt Key + Salt Index** (V1), the current code works with them as-is. PhonePe's FAQ calls these "older keys" and recommends asking for V2. **[Docs]**

Details: `PHONEPE_API_CREDENTIALS.md`.

## 7. Is sandbox access available before production?

**Yes. [Docs]**
- In the PhonePe Business Dashboard, turning on **Test Mode** shows **UAT/Sandbox** credentials; turning it off shows Production.
- PhonePe provides a **Test App (simulator)** (Android `com.phonepe.simulator`; iOS by request) and test cards to simulate Success / Failure / Pending.
- The UAT webhook URL is shared with the PhonePe integration team for configuration.
- Production credentials come after PhonePe's **UAT sign-off**.

## 8. Charges and approvals to confirm with PhonePe

None of these are in the developer docs. **[Confirm]** each one in writing:

1. **MDR / transaction fee** per mode (UPI, debit card, credit card, net banking) and GST on the fee.
2. Setup / annual / maintenance fees, if any.
3. **Settlement cycle** (T+1 etc.) and the settlement bank account.
4. **Refund** charges and timelines (do fees come back on refund?).
5. Whether the PG account is linked to, or separate from, the Soundbox account and its settlements.
6. Business category approval for a **restaurant / food ordering** site.
7. Website / policy-page review requirements before activation.
8. Whether **Standard Checkout V2** credentials are issued (ask explicitly for V2).

## 9. What the client can use today without PhonePe PG

Zen OS already has a **UPI deep-link fallback**: Admin → Profile → Payment → UPI ID. The customer pays to the restaurant's UPI ID (the same VPA the Soundbox uses works). This is **not** auto-verified: a waiter or admin must mark the order Paid after checking the Soundbox/bank. It is the right interim option until PG is active.
