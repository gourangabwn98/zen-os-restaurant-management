// src/pages/admin/HelpPage.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Zen OS "Help and support" — migrated to the shared design system
// (design-reference/zen-os-design-reference.html → "Help" screen) to match
// Profile / Insights: a "Guides" card on the left, "Contact support" +
// "Raise a ticket" on the right — no separate FAQ block or hero banner,
// matching the reference's simpler layout (the FAQ list duplicated the
// guides almost topic-for-topic, so it's folded in rather than kept as a
// second, easily-stale copy of the same answers).
//
// Two real fixes made while migrating:
//   • "Raise a ticket" used to fake success with a setTimeout — it never
//     reached the backend. There already IS a working endpoint for this
//     (POST /api/support → SupportTicket, restaurant-server/controllers/
//     supportController.js, which also best-effort notifies the restaurant
//     over WhatsApp) that the form just wasn't calling. Wired up now.
//   • A couple of guides pointed at section names that no longer exist
//     ("Chefs section" for staff, "Analytics" for insights) — the real nav
//     is Admin → Employees and Admin → Insights (src/pages/admin/
//     AdminLayout.jsx), and the WhatsApp-bill guide claimed bills are sent
//     automatically on order placement, which restaurant-server/server.js
//     shows is only wired to a manual test endpoint, not the order flow —
//     corrected to say so rather than promise something that isn't true yet.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import toast from "react-hot-toast";
import { createSupportTicket } from "../../services/adminService.js";
import PageHeader from "./shared/PageHeader.jsx";
import { t, N_, fmtNum } from "../../i18n/core.js";

const COMPANY = "CharubalaInc LLP";
const PHONE = "7318749498";
const PHONE_D = "+91 73187 49498";
const EMAIL = "charubalainc@gmail.com";
const WA_LINK = "https://wa.me/917318749498";

const GUIDES = [
  {
    icon: "🍽️", label: N_("Adding menu items"), desc: N_("Photos, half and full pricing, veg marks"),
    steps: [
      N_("Go to Menu Items from the sidebar."),
      N_("Click the “＋ New item” button in the top right."),
      N_("Fill in the item name, category, and price(s)."),
      N_("Upload an image for the item (optional but recommended)."),
      N_("Save — the item is live on the customer site immediately."),
    ],
  },
  {
    icon: "🪑", label: N_("Managing tables"), desc: N_("Seats, QR codes, freeing a table"),
    steps: [
      N_("Go to Table Map from the sidebar."),
      N_("Click “+ New Table” to create one — enter its number and seat count."),
      N_("Each tile shows its live status: free, occupied, or payment due."),
      N_("Click a table to see its active order and confirmed items."),
      N_("A table clears automatically once its bill is settled."),
    ],
  },
  {
    icon: "📦", label: N_("Handling orders"), desc: N_("Place, prepare, deliver, complete"),
    steps: [
      N_("Go to Billing — it shows the floor and active orders."),
      N_("Click “＋ New order” to place one for a walk-in or phone-in customer."),
      N_("Orders move through the same states the Kitchen app tracks: confirmed → preparing → ready → delivered → completed."),
      N_("You can add items to an already-placed order before it's ready."),
      N_("Payment status and method are set from the order panel once the guest pays."),
    ],
  },
  {
    icon: "👨‍🍳", label: N_("Creating staff accounts"), desc: N_("Waiters and chefs sign in by phone"),
    steps: [
      N_("Go to Employees from the sidebar."),
      N_("Click “+ Add Employee”."),
      N_("Enter their name, phone number, and role — Waiter or Chef."),
      N_("Save — they can now sign in to their app with that phone number and an OTP."),
      N_("There's no public staff signup anywhere; every account is created here."),
    ],
  },
  {
    icon: "🧾", label: N_("Generating invoices"), desc: N_("Single and combined bills"),
    steps: [
      N_("Invoices appear once an order is marked Completed, or its payment is confirmed Paid."),
      N_("Go to Invoices to see all of them."),
      N_("Search by order ID, customer name, or phone."),
      N_("Click a row to see the itemised receipt."),
      N_("Use “Mark paid” once you've confirmed the payment against the bank/UPI receipt — opening the customer's UPI app is never treated as proof by itself."),
    ],
  },
  {
    icon: "📱", label: N_("Sending bills on WhatsApp"), desc: N_("What the customer receives"),
    steps: [
      N_("The backend has a WhatsApp-bill sender ready (restaurant-server/utils/sendWhatsAppBill.js)."),
      N_("It isn't connected to the order flow yet, so bills aren't sent automatically when an order is placed."),
      N_("Contact support if you'd like this turned on for your number."),
    ],
  },
  {
    icon: "📊", label: N_("Reading insights"), desc: N_("What each figure is measuring"),
    steps: [
      N_("Go to Insights from the sidebar."),
      N_("The top row shows real revenue, order volume, average order value, and your busiest hour — for the date range you pick."),
      N_("Switch Today / Week / Month / Year to re-aggregate every panel below."),
      N_("Order type, payment method, top items, and revenue by category are all grouped straight from real orders."),
      N_("Export downloads the orders behind the current range as CSV."),
    ],
  },
  {
    icon: "🖨️", label: N_("Setting up printers"), desc: N_("Connecting the local print service"),
    steps: [
      N_("Go to Profile → Printers."),
      N_("Enter the printer's IP address (e.g. 192.168.1.100) and a name like “Kitchen”."),
      N_("Click “Add printer”, then toggle it Active."),
      N_("The print service runs on the restaurant's own network, not in the cloud — it needs to be on the same LAN as (or attached to) the printer."),
      N_("Contact support if KOT or bill printing isn't reaching a printer that shows Active."),
    ],
  },
];

// ── page-scoped styles (tokens only — light / dark safe) ─────────────────────
if (typeof document !== "undefined" && !document.getElementById("help-styles")) {
  const s = document.createElement("style");
  s.id = "help-styles";
  s.textContent = `
    .help-grid { display: grid; grid-template-columns: 1.3fr 1fr; gap: 16px; align-items: start; }
    @media (max-width: 900px) { .help-grid { grid-template-columns: 1fr; } }
    .help-tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 11px; padding: 16px 18px; }
    @media (max-width: 560px) { .help-tiles { grid-template-columns: 1fr; } }
    .help-tile {
      padding: 14px; border-radius: 13px; border: 1px solid var(--edge); background: var(--card-2);
      cursor: pointer; text-align: left; font: inherit; color: inherit; width: 100%; transition: border-color .12s ease;
    }
    .help-tile:hover { border-color: var(--edge-hi); }
    .help-tile.on { border-color: var(--violet-mid); background: var(--violet-faint); }
    .help-ic {
      width: 32px; height: 32px; border-radius: 10px; display: grid; place-items: center; margin-bottom: 10px;
      color: var(--accent-ink); background: var(--violet-weak); border: 1px solid var(--violet-mid);
    }
    .help-steps { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--edge); display: grid; gap: 10px; }
    .help-step { display: flex; gap: 10px; align-items: flex-start; font-size: 12.5px; color: var(--text-1); line-height: 1.55; }
    .help-step .n {
      width: 20px; height: 20px; border-radius: 50%; flex: none; display: grid; place-items: center;
      font-size: 10.5px; font-weight: 700; color: #fff; background: var(--grad-btn); margin-top: 1px;
    }
    .help-contact-row { display: flex; align-items: center; gap: 12px; padding: 11px 13px; border-radius: var(--r-ctl); border: 1px solid var(--edge); background: var(--card-2); margin-bottom: 9px; }
    .help-contact-row:last-child { margin-bottom: 0; }
  `;
  document.head.appendChild(s);
}

// ── Guide tile — expands in place to the reference's "step-by-step" list ─────
function GuideTile({ icon, label, desc, steps, open, onToggle }) {
  return (
    <button type="button" className={`help-tile${open ? " on" : ""}`} onClick={onToggle} aria-expanded={open}>
      <div className="help-ic">{icon}</div>
      <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 3, color: "var(--text-1)" }}>{t(label)}</div>
      <div style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.4 }}>{t(desc)}</div>
      {open && (
        <div className="help-steps">
          {steps.map((step, i) => (
            <div key={i} className="help-step"><span className="n">{fmtNum(i + 1)}</span><span>{t(step)}</span></div>
          ))}
        </div>
      )}
    </button>
  );
}

export default function HelpPage() {
  const [openGuide, setOpenGuide] = useState(null);
  const [form, setForm] = useState({ name: "", phone: "", topic: "", message: "" });
  const [sending, setSending] = useState(false);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const handleSend = async () => {
    if (!form.name.trim() || !form.message.trim()) {
      return toast.error(t("Please fill in your name and message"));
    }
    setSending(true);
    try {
      await createSupportTicket({
        name: form.name.trim(),
        phone: form.phone.trim(),
        subject: form.topic || "General",
        message: form.message.trim(),
      });
      toast.success(t("Query sent! We'll get back to you within 24 hours."));
      setForm({ name: "", phone: "", topic: "", message: "" });
    } catch (e) {
      toast.error(e?.response?.data?.message || t("Failed to send. Please try again."));
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <PageHeader title={t("Help and support")} sub={`${COMPANY} · ${t("support details come from the build config")}`} />

      <div className="help-grid">
        {/* Guides */}
        <div className="zc-card">
          <div className="zc-card-h"><span className="t">{t("Guides")}</span><span className="s">{t("the eight things people ask about")}</span></div>
          <div className="help-tiles">
            {GUIDES.map((g) => (
              <GuideTile key={g.label} {...g} open={openGuide === g.label} onToggle={() => setOpenGuide((o) => (o === g.label ? null : g.label))} />
            ))}
          </div>
        </div>

        <div>
          {/* Contact support */}
          <div className="zc-card" style={{ marginBottom: 16 }}>
            <div className="zc-card-h"><span className="t">{t("Contact support")}</span></div>
            <div style={{ padding: 18 }}>
              {[
                { icon: "📞", label: N_("Phone"), val: PHONE_D, href: `tel:${PHONE}` },
                { icon: "✉️", label: N_("Email"), val: EMAIL, href: `mailto:${EMAIL}` },
                { icon: "💬", label: N_("WhatsApp"), val: PHONE_D, href: WA_LINK },
                { icon: "🏢", label: N_("Company"), val: COMPANY, href: null },
              ].map(({ icon, label, val, href }) => (
                <div key={label} className="help-contact-row">
                  <div className="help-ic" style={{ marginBottom: 0 }}>{icon}</div>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--text-3)", marginBottom: 2 }}>{t(label)}</div>
                    {href ? (
                      <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer"
                        style={{ fontSize: 12.5, color: "var(--accent-ink)", fontWeight: 600, textDecoration: "none" }}>
                        {val}
                      </a>
                    ) : (
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-1)" }}>{val}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Raise a ticket */}
          <div className="zc-card">
            <div className="zc-card-h"><span className="t">{t("Raise a ticket")}</span><span className="s">{t("we reply within a day")}</span></div>
            <div style={{ padding: 18, display: "grid", gap: 12 }}>
              <div>
                <label style={{ fontSize: 11.5, color: "var(--text-2)", fontWeight: 500, display: "block", marginBottom: 6 }}>{t("Your name")} *</label>
                <input className="zc-input" placeholder={t("e.g. Rahul Sharma")} value={form.name} onChange={(e) => set("name", e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: 11.5, color: "var(--text-2)", fontWeight: 500, display: "block", marginBottom: 6 }}>{t("Phone number")}</label>
                <input className="zc-input" placeholder={t("10-digit mobile number")} value={form.phone}
                  onChange={(e) => set("phone", e.target.value.replace(/\D/g, ""))} maxLength={10} />
              </div>
              <div>
                <label style={{ fontSize: 11.5, color: "var(--text-2)", fontWeight: 500, display: "block", marginBottom: 6 }}>{t("What is happening")}</label>
                <select className="zc-select" value={form.topic} onChange={(e) => set("topic", e.target.value)}>
                  <option value="">{t("Select a topic…")}</option>
                  {/* value stays English (it is the ticket subject support reads) */}
                  {[N_("Order management issue"), N_("Table / floor plan issue"), N_("Menu management"), N_("Invoice / billing"), N_("Staff accounts"), N_("Technical / app issue"), N_("Other")]
                    .map((topic) => <option key={topic} value={topic}>{t(topic)}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11.5, color: "var(--text-2)", fontWeight: 500, display: "block", marginBottom: 6 }}>{t("Message")} *</label>
                <textarea className="zc-textarea" rows={4} placeholder={t("Describe the problem, and what you were doing when it happened.")}
                  value={form.message} onChange={(e) => set("message", e.target.value)} />
              </div>
              <button type="button" className="zc-btn pri block" disabled={sending} onClick={handleSend}>
                {sending ? t("Sending…") : t("Send to support")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
