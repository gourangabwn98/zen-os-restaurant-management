import { Link, useNavigate } from "react-router-dom";
import { useRestaurantProfile } from "../hooks/useRestaurantProfile.js";

// ─────────────────────────────────────────────────────────────────────────────
// Customer-facing policy pages: Terms, Privacy, Refund & Cancellation, Contact.
// Payment gateways (PhonePe PG) check for these during onboarding.
//
// Rules for this file:
//  • Business identity (name, address, phone, email, GSTIN, FSSAI, website)
//    is read ONLY from the restaurant profile the admin maintains
//    (Admin → Profile) — never typed in here. A blank field is simply not
//    shown; nothing is invented.
//  • The text describes how this app actually behaves (see
//    utils/orderStateMachine.js, utils/paymentMode.js, services/paymentService.js).
//    It does NOT state a legal entity, jurisdiction, refund time-frame or
//    eligibility rule — those are the owner's decisions; see
//    docs/phonepe-integration/POLICY_PAGES.md for what still needs sign-off.
//  • Flip POLICY_REVIEWED to true (and set POLICY_UPDATED) only after the owner
//    has reviewed the wording. Until then a short notice says so.
// ─────────────────────────────────────────────────────────────────────────────

const POLICY_REVIEWED = false;
const POLICY_UPDATED = ""; // e.g. "1 December 2026" — set on owner sign-off

// Mirrors restaurant-server/utils/paymentMode.js PAY_FIRST_WINDOW_MS (15 min).
const PAY_WINDOW_MIN = 15;

const nameOf = (p) => p?.restaurantName || "the restaurant";

const fullAddress = (p) => [p?.address, p?.city].filter(Boolean).join(", ");

function ContactBlock({ profile }) {
  const addr = fullAddress(profile);
  const rows = [
    ["Business", profile?.restaurantName],
    ["Contact person", profile?.contactPerson],
    ["Address", addr],
    ["Phone", profile?.phone && <a href={`tel:${profile.phone}`}>{profile.phone}</a>],
    ["Email", profile?.email && <a href={`mailto:${profile.email}`}>{profile.email}</a>],
    ["Website", profile?.website && <a href={profile.website} target="_blank" rel="noreferrer">{profile.website}</a>],
    ["GSTIN", profile?.gstNumber],
    ["FSSAI licence", profile?.fssaiNumber],
  ].filter(([, v]) => v);

  if (!profile) return <p className="muted">Loading contact details…</p>;
  if (!rows.length) {
    return <p className="muted">Contact details haven't been published yet. Please ask a member of staff.</p>;
  }
  return (
    <div className="card" style={{ padding: "6px 14px" }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "flex", gap: 12, padding: "9px 0", borderBottom: "1px solid var(--line, rgba(0,0,0,.08))" }}>
          <span className="muted small" style={{ minWidth: 110 }}>{k}</span>
          <span style={{ overflowWrap: "anywhere", fontWeight: 600 }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

const Section = ({ title, children }) => (
  <section style={{ marginTop: 18 }}>
    <h3 style={{ fontSize: 17, margin: "0 0 6px", fontWeight: 800 }}>{title}</h3>
    <div style={{ lineHeight: 1.6 }}>{children}</div>
  </section>
);

// ── Page bodies ──────────────────────────────────────────────────────────────

const Terms = ({ p }) => (
  <>
    <Section title="About this service">
      <p>This ordering app is provided by {nameOf(p)} so you can view the menu, place dine-in, takeaway or delivery
        orders, and pay for them. By placing an order you agree to these terms.</p>
    </Section>
    <Section title="Orders">
      <ul>
        <li>Prices, taxes and charges are calculated by the restaurant's system when you place the order. The total
          shown at checkout is the amount you pay.</li>
        <li>An order placed from the app is accepted only when the restaurant confirms it. Items can be unavailable
          or sold out; staff will tell you if something can't be served.</li>
        <li>Dine-in orders need your device location to confirm you are at the restaurant. Your location is used
          only for that check.</li>
        <li>Coupons apply only while they are active and only under their stated conditions.</li>
      </ul>
    </Section>
    <Section title="Payment">
      <ul>
        <li>You can pay by the methods the restaurant offers at checkout (for example cash, or online through
          PhonePe).</li>
        <li>When you pay online first, your order is sent to the restaurant only after the payment is confirmed by
          the payment gateway. An unpaid online order is cancelled automatically after {PAY_WINDOW_MIN} minutes.</li>
        <li>Online payments are processed by PhonePe on its own secure page. This app never sees or stores your
          card, UPI PIN or bank details.</li>
      </ul>
    </Section>
    <Section title="Cancellations and refunds">
      <p>See our <Link to="/refund-policy">Refund &amp; Cancellation Policy</Link>.</p>
    </Section>
    <Section title="Your data">
      <p>See our <Link to="/privacy">Privacy Policy</Link>.</p>
    </Section>
    <Section title="Questions">
      <p>Contact us using the details on our <Link to="/contact">Contact Us</Link> page.</p>
    </Section>
  </>
);

const Privacy = ({ p }) => (
  <>
    <Section title="What we collect">
      <ul>
        <li><b>Account:</b> your phone number (used to log in with a one-time code) and the name you give us.</li>
        <li><b>Orders:</b> what you ordered, table number or order type, notes, amounts, coupon used, payment method
          and payment status, and any rating you leave.</li>
        <li><b>Delivery orders:</b> the delivery address, map pin and contact phone you enter, so the order can be
          delivered.</li>
        <li><b>Dine-in location check:</b> your device location at the moment you place a dine-in order, used only
          to confirm you are inside the restaurant's ordering area.</li>
        <li><b>Online payments:</b> the payment reference and result PhonePe sends us. We do not receive your card
          number, UPI PIN or bank login.</li>
        <li><b>Notifications:</b> if you turn them on, a device token so we can send order updates and offers.</li>
        <li><b>Support messages:</b> what you write to us on the Help page.</li>
      </ul>
    </Section>
    <Section title="On your phone">
      <p>The app stores your login session, light/dark theme, and (if you use delivery) your last address on your own
        device so you don't have to re-enter them.</p>
    </Section>
    <Section title="How we use it">
      <p>To take, prepare, deliver and bill your orders; to show your order history; to answer support requests;
        and, if you allow notifications, to tell you about your order and offers. Restaurant staff see the details
        they need for your order. Kitchen screens do not show your phone number.</p>
    </Section>
    <Section title="Who we share it with">
      <ul>
        <li><b>PhonePe</b> — to process an online payment you choose to make.</li>
        <li><b>Delivery rider</b> — for a delivery order, what is needed to hand it over.</li>
        <li>Service providers that run the app for us (hosting, login codes, notifications), only to provide
          the service.</li>
      </ul>
      <p>We do not sell your data.</p>
    </Section>
    <Section title="Your choices">
      <p>You can turn notifications off at any time, and contact us to ask about,
        correct or delete your details.</p>
    </Section>
    <Section title="Contact">
      <p>Questions about your data: see <Link to="/contact">Contact Us</Link>.</p>
    </Section>
  </>
);

const Refunds = ({ p }) => (
  <>
    <Section title="Cancelling an order">
      <ul>
        <li>You can cancel an order yourself from the order page while it is <b>waiting for payment</b> or{" "}
          <b>waiting for the restaurant to confirm</b> it.</li>
        <li>Once {nameOf(p)} has confirmed your order, it may already be in preparation. Please speak to staff or
          contact us — they decide whether it can still be cancelled.</li>
        <li>An online-pay-first order that isn't paid within {PAY_WINDOW_MIN} minutes is cancelled automatically.
          No payment is taken for it.</li>
      </ul>
    </Section>
    <Section title="Failed or uncertain payments">
      <ul>
        <li>If an online payment fails, your order is not sent to the kitchen. You can try again, or pay another way
          if the restaurant allows it.</li>
        <li>If money left your account but the app doesn't show your order as paid, don't pay again straight away —
          contact us with your PhonePe transaction reference. We check every such case against the payment
          gateway's records.</li>
      </ul>
    </Section>
    <Section title="Refunds">
      <ul>
        <li>Refund requests are reviewed by the restaurant. Contact us with your order number and payment
          reference.</li>
        <li>Approved refunds for online payments are returned to the original payment method through PhonePe.
          The time it takes to reach your account depends on PhonePe and your bank.</li>
        <li>Cash payments are refunded in person at the restaurant.</li>
      </ul>
    </Section>
    <Section title="Contact">
      <p>See <Link to="/contact">Contact Us</Link>.</p>
    </Section>
  </>
);

const Contact = ({ p }) => (
  <>
    <ContactBlock profile={p} />
    <p className="muted small" style={{ marginTop: 14 }}>
      You can also send us a message from the <Link to="/help">Help</Link> page.
    </p>
  </>
);

const PAGES = {
  terms:   { title: "Terms & Conditions",           Body: Terms },
  privacy: { title: "Privacy Policy",               Body: Privacy },
  refund:  { title: "Refund & Cancellation Policy", Body: Refunds },
  contact: { title: "Contact Us",                   Body: Contact, reviewed: true }, // data only, no policy wording
};

export const POLICY_LINKS = [
  ["/terms", "Terms"], ["/privacy", "Privacy"], ["/refund-policy", "Refunds & cancellation"], ["/contact", "Contact"],
];

/** Small footer row of policy links (Help page, checkout). */
export function PolicyLinks({ style }) {
  return (
    <nav aria-label="Policies" className="muted tiny" style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", ...style }}>
      {POLICY_LINKS.map(([to, label]) => <Link key={to} to={to} style={{ color: "inherit" }}>{label}</Link>)}
    </nav>
  );
}

export default function PolicyPage({ kind }) {
  const navigate = useNavigate();
  const profile = useRestaurantProfile();
  const page = PAGES[kind] || PAGES.terms;
  const { Body } = page;

  return (
    <>
      <div className="page-h">
        <button type="button" className="back" onClick={() => navigate(-1)}>← Back</button>
        <h2>{page.title}</h2>
        <p>{nameOf(profile)}</p>
      </div>

      {!POLICY_REVIEWED && !page.reviewed && (
        <p className="muted small" role="note" style={{ margin: "0 0 6px" }}>
          This policy is being finalised by the restaurant. For any question, please contact us.
        </p>
      )}
      {POLICY_REVIEWED && POLICY_UPDATED && !page.reviewed && (
        <p className="muted small" style={{ margin: "0 0 6px" }}>Last updated: {POLICY_UPDATED}</p>
      )}

      <Body p={profile} />

      <PolicyLinks style={{ marginTop: 26, marginBottom: 8 }} />
    </>
  );
}
