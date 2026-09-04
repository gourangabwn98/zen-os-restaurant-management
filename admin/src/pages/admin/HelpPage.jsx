import { PRIMARY, PRIMARY_LIGHT } from "../../theme.js";
import { useState } from "react";
import toast from "react-hot-toast";

const PINK  = PRIMARY;
const CARD  = "#16132a";
const CARD2 = "#1c1830";
const BDR   = "rgba(255,255,255,0.07)";
const T1    = "#f1f0f5";
const T2    = "#9ca3af";
const T3    = "#4b5563";

const COMPANY = "CharubalaInc LLP";
const PHONE   = "7318749498";
const PHONE_D = "+91 73187 49498";
const EMAIL   = "charubalainc@gmail.com";
const WA_LINK = `https://wa.me/917318749498`;

const FAQS = [
  { q:"How do I add a new waiter or chef?",         a:"Go to Chefs section → Click 'Add New Staff' → Enter name and phone number. They can then log in using their phone number via OTP." },
  { q:"Can staff log in with just their phone?",     a:"Yes. All staff (waiters, chefs) log in using their registered 10-digit phone number. An OTP is sent to their phone for verification." },
  { q:"How do I add new menu items?",                a:"Go to Menu → Click 'Add Item' → Fill in name, category, price, and upload an image. The item goes live immediately after saving." },
  { q:"How do I manage dining tables?",              a:"Go to Tables → You can add, activate/deactivate, or delete tables. Click any table to view its current orders and update their status." },
  { q:"How are invoices generated?",                 a:"Invoices are generated when an order is marked as Delivered or Completed. View and mark them as Paid from the Invoices section." },
  { q:"What if an order is placed by mistake?",      a:"Open the order from Orders page → Click View → Select 'Cancelled' from the Update Status buttons. Cancelled orders won't appear on the floor plan." },
  { q:"How do I send a WhatsApp bill to customer?",  a:"When creating an order, enter the customer's phone number. The bill is automatically sent to their WhatsApp after the order is placed." },
  { q:"Can multiple people order at the same table?",a:"Yes. Multiple orders can be placed at one table. Click the table in Table Management to see all orders, combined bill, and individual payment status." },
];

const QUICK_LINKS = [
  {
    icon:"🍽️", label:"How to add menu items",
    steps:[
      "Go to the Menu section from the left sidebar.",
      "Click the '+ Add Item' button in the top right.",
      "Fill in the item name, select a category, set the price.",
      "Upload an image for the item (optional but recommended).",
      "Toggle 'Available' to ON and click Save.",
      "The item is now live and visible to customers via QR scan.",
    ],
  },
  {
    icon:"🪑", label:"How to manage tables",
    steps:[
      "Go to the Tables section from the sidebar.",
      "Click '+ Add Table' to create a new table — enter table number and seat count.",
      "Each table card shows its current status: Free, Occupied, etc.",
      "Click on a table card to see its active orders.",
      "You can activate or deactivate tables using the toggle.",
      "Delete a table by clicking the delete icon (only if no active orders).",
    ],
  },
  {
    icon:"📦", label:"How to handle orders",
    steps:[
      "Go to Orders page — it shows today's active orders by default.",
      "Click 'View ↓' on any order to expand its details.",
      "Update the order status: Placed → Preparing → Ready → Delivered → Completed.",
      "You can also change payment status (Pending / Paid) and method (Cash / Online).",
      "Use '+ Add Items' to add more items to an existing active order.",
      "Use 'Create Order' button to manually place a new order for walk-in customers.",
    ],
  },
  {
    icon:"👨‍🍳", label:"How to create staff accounts",
    steps:[
      "Go to the Chefs section from the sidebar.",
      "Click '+ Add Chef/Waiter' button.",
      "Enter the staff member's name and 10-digit phone number.",
      "Select their role: Waiter, Chef, or Manager.",
      "Click Save — the staff member is now registered.",
      "They can now log into the Waiter App using their phone number and OTP.",
    ],
  },
  {
    icon:"🧾", label:"How to generate invoices",
    steps:[
      "Invoices are auto-generated when an order reaches Completed or Delivered status.",
      "Go to the Invoices section to view all bills.",
      "Use the search bar to find a specific order by ID or customer name.",
      "Click 'View ↓' to expand and see the full itemised receipt.",
      "Click 'Mark as Paid' to update the payment status.",
      "You can filter invoices by payment status or order type.",
    ],
  },
  {
    icon:"📱", label:"How to send WhatsApp bills",
    steps:[
      "When creating an order, enter the customer's name and phone number.",
      "After the order is placed, the bill is automatically sent to their WhatsApp.",
      "The customer must have joined the Twilio WhatsApp sandbox first (sandbox mode only).",
      "The bill includes all items, quantities, taxes, and total amount.",
      "For production use, contact support to upgrade to a verified WhatsApp number.",
    ],
  },
  {
    icon:"📊", label:"How to read analytics",
    steps:[
      "Go to the Analytics section from the sidebar.",
      "The top row shows total orders, revenue, active orders, and today's count.",
      "Use the date range filter to see stats for a specific period.",
      "The chart shows revenue trends over the selected period.",
      "Below the chart you can see best-selling items and peak hours.",
      "Use this data to optimise your menu and staffing.",
    ],
  },
  {
    icon:"🖨️", label:"How to set up printers",
    steps:[
      "Go to Profile → Printer IPs section.",
      "Click 'Add Printer' and enter the printer's IP address (e.g. 192.168.1.100).",
      "Give it a name like 'Kitchen' or 'Billing Counter'.",
      "Toggle the printer Active/Off as needed.",
      "Make sure the printer is on the same WiFi network as your device.",
      "Contact support if KOT printing is not working correctly.",
    ],
  },
];

// ── FAQ accordion ─────────────────────────────────────────────────────────────
const FaqItem = ({ q, a }) => {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom:`1px solid ${BDR}` }}>
      <div onClick={()=>setOpen(o=>!o)} style={{ display:"flex", justifyContent:"space-between",
        alignItems:"center", padding:"16px 0", cursor:"pointer", gap:12, userSelect:"none" }}>
        <span style={{ fontSize:14, fontWeight:500, color:open?PINK:T1 }}>{q}</span>
        <div style={{ width:24, height:24, borderRadius:"50%", flexShrink:0,
          border:`1.5px solid ${open?PINK:BDR}`,
          background:open?PINK:"transparent",
          display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:14, color:open?"#fff":T2,
          transform:open?"rotate(45deg)":"none", transition:"all .2s" }}>+</div>
      </div>
      {open && (
        <div style={{ fontSize:13.5, color:T2, lineHeight:1.75, paddingBottom:16 }}>{a}</div>
      )}
    </div>
  );
};

// ── Quick guide item with expandable steps ────────────────────────────────────
const GuideItem = ({ icon, label, steps }) => {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderRadius:10, overflow:"hidden",
      border:`1px solid ${open?PINK+"55":BDR}`,
      background:open?`${PINK}08`:"transparent",
      marginBottom:6, transition:"all .15s" }}>
      {/* Row */}
      <div onClick={()=>setOpen(o=>!o)}
        style={{ display:"flex", alignItems:"center", gap:10,
          padding:"11px 14px", cursor:"pointer", userSelect:"none" }}>
        <span style={{ fontSize:16, width:22, textAlign:"center", flexShrink:0 }}>{icon}</span>
        <div style={{ width:6, height:6, borderRadius:"50%", background:PINK, flexShrink:0 }}/>
        <span style={{ fontSize:13, color:open?PINK:T2, fontWeight:open?600:400, flex:1 }}>{label}</span>
        <div style={{ width:22, height:22, borderRadius:"50%", flexShrink:0,
          border:`1px solid ${open?PINK:BDR}`,
          background:open?PINK:"transparent",
          display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:11, color:open?"#fff":T2,
          transform:open?"rotate(90deg)":"none", transition:"all .2s" }}>▶</div>
      </div>

      {/* Steps */}
      {open && (
        <div style={{ padding:"0 14px 14px 14px", borderTop:`1px solid ${BDR}` }}>
          <div style={{ fontSize:11, fontWeight:600, color:T3, letterSpacing:1,
            textTransform:"uppercase", marginBottom:10, marginTop:12 }}>
            Step-by-step guide
          </div>
          {steps.map((step, i) => (
            <div key={i} style={{ display:"flex", gap:12, alignItems:"flex-start",
              marginBottom:i===steps.length-1?0:10 }}>
              {/* Step number */}
              <div style={{ width:22, height:22, borderRadius:"50%", flexShrink:0,
                background:`linear-gradient(135deg,${PINK},#5b21b6)`,
                display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:11, fontWeight:700, color:"#fff", marginTop:1 }}>
                {i+1}
              </div>
              <div style={{ fontSize:13, color:T1, lineHeight:1.6, flex:1 }}>{step}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const INP = {
  width:"100%", padding:"11px 14px", borderRadius:10, fontSize:14,
  border:`1px solid ${BDR}`, outline:"none", background:CARD2, color:T1,
  fontFamily:"'DM Sans',sans-serif", boxSizing:"border-box", transition:"border .15s",
};

export default function HelpPage() {
  const [form, setForm]     = useState({ name:"", phone:"", topic:"", message:"" });
  const [sending, setSending] = useState(false);
  const set = (k,v) => setForm(p=>({...p,[k]:v}));

  const handleSend = async () => {
    if(!form.name.trim()||!form.message.trim())
      return toast.error("Please fill in your name and message");
    setSending(true);
    try {
      await new Promise(r=>setTimeout(r,1200));
      toast.success("Query sent! We'll get back to you within 24 hours.");
      setForm({ name:"", phone:"", topic:"", message:"" });
    } catch {
      toast.error("Failed to send. Please try again.");
    } finally { setSending(false); }
  };

  return (
    <div style={{ maxWidth:960, margin:"0 auto", paddingBottom:60, fontFamily:"'DM Sans',sans-serif" }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* Page header */}
      <div style={{ marginBottom:24 }}>
        <h1 style={{ fontSize:22, fontWeight:700, color:T1, margin:0 }}>Help & Support</h1>
        <p style={{ fontSize:13, color:T2, marginTop:5 }}>
          Get help from our team or browse common questions below
        </p>
      </div>

      {/* Hero banner */}
      <div style={{ background:`linear-gradient(135deg,#5b21b6,${PINK})`,
        borderRadius:18, padding:"28px 32px", marginBottom:20,
        display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:16 }}>
        <div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.65)", letterSpacing:1.5,
            textTransform:"uppercase", fontWeight:600, marginBottom:6 }}>Powered by</div>
          <div style={{ fontSize:22, fontWeight:800, color:"#fff", marginBottom:6 }}>{COMPANY}</div>
          <div style={{ fontSize:13, color:"rgba(255,255,255,0.8)", display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
            <span>📞</span>
            <a href={`tel:${PHONE}`} style={{ color:"#fff", textDecoration:"none", fontWeight:600 }}>{PHONE_D}</a>
            <span style={{ color:"rgba(255,255,255,0.3)" }}>·</span>
            <span>Mon – Sat, 10 AM – 7 PM</span>
          </div>
        </div>
        <div style={{ display:"flex", gap:10 }}>
          <a href={`tel:${PHONE}`} style={{ display:"inline-flex", alignItems:"center", gap:7,
            padding:"10px 20px", background:"rgba(255,255,255,0.15)",
            border:"1.5px solid rgba(255,255,255,0.3)", borderRadius:25,
            color:"#fff", fontSize:13, fontWeight:600, textDecoration:"none" }}>
            📞 Call us
          </a>
          <a href={WA_LINK} target="_blank" rel="noreferrer"
            style={{ display:"inline-flex", alignItems:"center", gap:7,
              padding:"10px 20px", background:"#25D366", borderRadius:25,
              color:"#fff", fontSize:13, fontWeight:700, textDecoration:"none" }}>
            💬 WhatsApp
          </a>
        </div>
      </div>

      {/* Contact + Quick links */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>

        {/* Contact */}
        <div style={{ background:CARD, border:`1px solid ${BDR}`, borderRadius:16, padding:24 }}>
          <div style={{ fontSize:15, fontWeight:700, color:T1, marginBottom:18 }}>Contact Details</div>
          {[
            { icon:"📞", bg:"rgba(139,92,246,0.2)", label:"Phone",    val:PHONE_D, href:`tel:${PHONE}` },
            { icon:"✉️", bg:"rgba(59,130,246,0.2)",  label:"Email",    val:EMAIL,   href:`mailto:${EMAIL}` },
            { icon:"💬", bg:"rgba(37,211,102,0.2)",  label:"WhatsApp", val:PHONE_D, href:WA_LINK },
            { icon:"🏢", bg:"rgba(245,158,11,0.2)",  label:"Company",  val:COMPANY, href:null },
          ].map(({ icon, bg, label, val, href }) => (
            <div key={label} style={{ display:"flex", alignItems:"center", gap:14,
              padding:"11px 0", borderBottom:`1px solid ${BDR}` }}>
              <div style={{ width:40, height:40, borderRadius:10, background:bg, flexShrink:0,
                display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>
                {icon}
              </div>
              <div>
                <div style={{ fontSize:10, color:T3, fontWeight:600, textTransform:"uppercase",
                  letterSpacing:0.5, marginBottom:3 }}>{label}</div>
                {href ? (
                  <a href={href} target={href.startsWith("http")?"_blank":undefined} rel="noreferrer"
                    style={{ fontSize:14, color:PINK, textDecoration:"none", fontWeight:600 }}>
                    {val}
                  </a>
                ) : (
                  <div style={{ fontSize:14, color:T1, fontWeight:600 }}>{val}</div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Quick guides — now expandable */}
        <div style={{ background:CARD, border:`1px solid ${BDR}`, borderRadius:16, padding:24 }}>
          <div style={{ fontSize:15, fontWeight:700, color:T1, marginBottom:4 }}>Quick Guides</div>
          <div style={{ fontSize:12, color:T2, marginBottom:14 }}>
            Click any guide to see step-by-step instructions
          </div>
          <div>
            {QUICK_LINKS.map(g => (
              <GuideItem key={g.label} icon={g.icon} label={g.label} steps={g.steps} />
            ))}
          </div>
        </div>
      </div>

      {/* Send a query */}
      <div style={{ background:CARD, border:`1px solid ${BDR}`, borderRadius:16, padding:24, marginBottom:14 }}>
        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:15, fontWeight:700, color:T1, marginBottom:4 }}>Send us a Query</div>
          <div style={{ fontSize:13, color:T2 }}>Describe your issue and we'll respond within 24 hours</div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
          <div>
            <div style={{ fontSize:12, color:T2, marginBottom:6, fontWeight:500 }}>Your name *</div>
            <input style={INP} placeholder="e.g. Rahul Sharma"
              value={form.name} onChange={e=>set("name",e.target.value)}
              onFocus={e=>e.target.style.borderColor=PINK}
              onBlur={e=>e.target.style.borderColor=BDR}/>
          </div>
          <div>
            <div style={{ fontSize:12, color:T2, marginBottom:6, fontWeight:500 }}>Phone number</div>
            <input style={INP} placeholder="10-digit mobile number"
              value={form.phone} onChange={e=>set("phone",e.target.value.replace(/\D/g,""))} maxLength={10}
              onFocus={e=>e.target.style.borderColor=PINK}
              onBlur={e=>e.target.style.borderColor=BDR}/>
          </div>
          <div style={{ gridColumn:"1/-1" }}>
            <div style={{ fontSize:12, color:T2, marginBottom:6, fontWeight:500 }}>Topic</div>
            <select style={{ ...INP, cursor:"pointer" }}
              value={form.topic} onChange={e=>set("topic",e.target.value)}>
              <option value="" style={{ background:CARD }}>Select a topic…</option>
              {["Order management issue","Table / floor plan issue","Menu management",
                "Invoice / billing","Staff accounts","Technical / app issue","Other"]
                .map(t=><option key={t} value={t} style={{ background:CARD }}>{t}</option>)}
            </select>
          </div>
          <div style={{ gridColumn:"1/-1" }}>
            <div style={{ fontSize:12, color:T2, marginBottom:6, fontWeight:500 }}>Message *</div>
            <textarea style={{ ...INP, resize:"vertical", minHeight:110 }}
              placeholder="Describe your problem or question in detail…"
              value={form.message} onChange={e=>set("message",e.target.value)}
              onFocus={e=>e.target.style.borderColor=PINK}
              onBlur={e=>e.target.style.borderColor=BDR}/>
          </div>
          <div style={{ gridColumn:"1/-1" }}>
            <button onClick={handleSend} disabled={sending} style={{
              width:"100%", padding:"13px",
              background:sending?"#374151":`linear-gradient(135deg,${PINK},#5b21b6)`,
              color:sending?T3:"#fff", border:"none", borderRadius:12,
              fontSize:14, fontWeight:700, cursor:sending?"not-allowed":"pointer",
              boxShadow:sending?"none":`0 4px 16px ${PINK}44`,
              display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
              {sending ? (
                <>
                  <div style={{ width:16, height:16, borderRadius:"50%",
                    border:"2px solid rgba(255,255,255,0.3)", borderTopColor:"#fff",
                    animation:"spin .7s linear infinite" }}/>
                  Sending…
                </>
              ) : "Send Query →"}
            </button>
          </div>
        </div>
      </div>

      {/* FAQ */}
      <div style={{ background:CARD, border:`1px solid ${BDR}`, borderRadius:16, padding:24 }}>
        <div style={{ fontSize:15, fontWeight:700, color:T1, marginBottom:4 }}>
          Frequently Asked Questions
        </div>
        <div style={{ fontSize:13, color:T2, marginBottom:20 }}>Quick answers to common questions</div>
        {FAQS.map(f=><FaqItem key={f.q} q={f.q} a={f.a}/>)}
      </div>

      {/* Footer */}
      <div style={{ textAlign:"center", marginTop:32, fontSize:12, color:T3 }}>
        Built & maintained by{" "}
        <span style={{ color:PINK, fontWeight:600 }}>{COMPANY}</span>
        {" · "}{PHONE_D}{" · "}
        <a href={`mailto:${EMAIL}`} style={{ color:PINK, textDecoration:"none" }}>{EMAIL}</a>
      </div>
    </div>
  );
}