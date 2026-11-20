# Customer Policy Pages — what was built and what the owner must confirm

**Pages (customer app):** `/terms`, `/privacy`, `/refund-policy`, `/contact`
**Source:** `customer/src/pages/PolicyPage.jsx`
**Linked from:** Help page footer, and checkout (under the Place order / Pay button)

## How business details are filled in

Nothing about Hotel KHOAI is typed into the code. Each page reads the public restaurant profile that the admin maintains under **Admin → Profile**:

| Shown as | Profile field |
|---|---|
| Business | `restaurantName` |
| Contact person | `contactPerson` |
| Address | `address`, `city` |
| Phone | `phone` |
| Email | `email` |
| Website | `website` |
| GSTIN | `gstNumber` |
| FSSAI licence | `fssaiNumber` |

A blank field is left out; it is never shown as a placeholder. **Before applying to PhonePe, the owner should fill in at least the business name, full address, phone and email** (and GSTIN/FSSAI if they have them) in Admin → Profile. PhonePe usually checks that Contact Us shows a reachable address and phone.

## What the text says (and why it's safe)

The wording only describes how the system actually behaves:

| Statement | Where it's enforced |
|---|---|
| Prices/totals calculated by the restaurant's system | `utils/pricing.js`, server-side pricing |
| Online pay-first orders go to the restaurant only after verified payment; unpaid ones cancel after 15 min | `utils/paymentMode.js` (`PAY_FIRST_WINDOW_MS`), `payFirstService.js` |
| The app never sees card / UPI PIN / bank login | PhonePe hosted checkout |
| Customer can self-cancel only while awaiting payment or awaiting confirmation | `utils/orderStateMachine.js` `TRANSITION_ROLES` |
| Dine-in location used only for the area check, not stored | `utils/diningRadius.js`; `orderService` doesn't save `body.location` |
| Kitchen screens don't show the customer's phone | kitchen socket room, PII-stripped |
| Data stored on the phone: session, theme, last delivery address | `services/api.js`, `deliveryService.js`, appearance setting |

## Deliberately NOT stated: the owner must decide or confirm

These are legal and business decisions, so nothing was invented:

1. **Legal entity name** (proprietorship / company name, if different from the trading name).
2. **Refund eligibility**: when food-quality or wrong-item complaints get a refund, partial or full.
3. **Refund time-frame**: the page says it "depends on PhonePe and your bank". Add a number only if the owner commits to one.
4. **Whether a CONFIRMED order can still be cancelled**, and any cancellation charge. Today the page says staff decide.
5. **Governing law / jurisdiction / dispute resolution** clause.
6. **Data retention period** and a named grievance officer (often expected under Indian IT rules; confirm with a lawyer).
7. **Delivery-specific terms** (delivery area, charges, failed delivery) if delivery will be offered online.

## Turning off the "being finalised" notice

Until the owner signs off, the Terms, Privacy and Refund pages show *"This policy is being finalised by the restaurant."* After review:

1. In `PolicyPage.jsx`, set `POLICY_REVIEWED = true` and `POLICY_UPDATED = "<date>"`.
2. Rebuild the customer app.

> These drafts are a starting point that matches the software's behaviour. They are not legal advice; a lawyer should review them before PhonePe submission.
