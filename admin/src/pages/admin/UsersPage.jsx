// src/pages/admin/UsersPage.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Zen OS "Users" — customers who have ordered, including guests. Migrated to
// the shared design system (design-reference/zen-os-design-reference.html →
// "Users" screen) to match Invoices / Dashboard, with the SAME columns and
// stat cards as that reference: Registered / Repeat customers / Guest orders
// / Highest spender, and a Customer / Phone / Orders / Lifetime / Average /
// Last order / Type ledger.
//
// The reference mockup's per-customer numbers (orders, lifetime, average,
// last order, registered-vs-guest) aren't fields on the User document itself
// — they only exist once orders are attached to a customer. So this screen
// now aggregates GET /admin/orders (already used by Invoices) per customer,
// grouped by the registered account (order.user) or, for guests, by
// guestPhone — and folds in every registered account from GET /admin/users
// so accounts with zero orders still show up (and can still be deleted).
// Nothing here is invented: every figure is a live aggregate of that data.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback, useMemo } from "react";
import toast from "react-hot-toast";
import { getAllUsers, deleteUser, getAllOrders } from "../../services/adminService.js";
import PageHeader from "./shared/PageHeader.jsx";
import StatCard from "./shared/StatCard.jsx";
import Loader from "./shared/Loader.jsx";
import EmptyState from "./shared/EmptyState.jsx";
import ErrorState from "./shared/ErrorState.jsx";

const PER_PAGE = 12;
const TYPE_SEG = ["All", "Registered", "Guest"];

const AVATAR_GRADS = [
  "linear-gradient(140deg,#8B5CF6,#6D28D9)",
  "linear-gradient(140deg,#22D3EE,#0891B2)",
  "linear-gradient(140deg,#F0A93B,#D97706)",
  "linear-gradient(140deg,#35D08A,#059669)",
  "linear-gradient(140deg,#F2564D,#B91C1C)",
  "linear-gradient(140deg,#6366F1,#4338CA)",
];
const avc = (n) => AVATAR_GRADS[(n?.charCodeAt(0) || 0) % AVATAR_GRADS.length];
const ini = (n) => (!n || n === "Guest" ? "G" : n.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2));
const fmt = (n) => Math.round(n || 0).toLocaleString("en-IN");

// ── page-scoped styles (tokens only — light / dark safe) ─────────────────────
if (typeof document !== "undefined" && !document.getElementById("usr-styles")) {
  const s = document.createElement("style");
  s.id = "usr-styles";
  s.textContent = `
    .usr-idc { color: var(--text-3); font-size: 11px; }
    .usr-who { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .usr-who .av { width: 32px; height: 32px; border-radius: 50%; flex: none; display: grid; place-items: center; font-size: 11.5px; font-weight: 700; color: #fff; }
    .usr-who b { font-weight: 600; display: block; line-height: 1.3; color: var(--text-1); }
    .usr-filters { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; }
    .zc-ledger tbody tr.usr-click { cursor: pointer; }
    .usr-cards { display: none; }
    @media (max-width: 860px) {
      .usr-ledger-wrap { display: none; }
      .usr-cards { display: block; }
    }
    .usr-ocard {
      border: 1px solid var(--edge); border-radius: var(--r-row);
      background: var(--grad-panel); padding: 12px 13px; margin-bottom: 8px; cursor: pointer;
      transition: border-color .12s ease;
    }
    .usr-ocard:hover { border-color: var(--edge-hi); }
  `;
  document.head.appendChild(s);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Customer detail modal — order aggregate, plus account info + delete for
// registered customers whose full User document we have.
// ═══════════════════════════════════════════════════════════════════════════════
function CustomerDetailModal({ customer, busy, onClose, onDelete }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!customer) return null;
  const u = customer.user;
  const orderRows = [
    ["Orders", customer.orderCount],
    ["Lifetime", `₹${fmt(customer.lifetime)}`],
    ["Average order", `₹${fmt(customer.average)}`],
    [
      "Last order",
      customer.lastOrderAt
        ? new Date(customer.lastOrderAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
        : "—",
    ],
  ];
  const accountRows = u
    ? [
        ["User ID", `…${u._id.slice(-8)}`, true],
        ["Verified", u.isVerified ? "Yes" : "No", false, u.isVerified ? "var(--ready-ink)" : "var(--stop-ink)"],
        ["Veg mode", u.vegMode ? "On" : "Off", false, u.vegMode ? "var(--ready-ink)" : "var(--text-2)"],
        ["Language", u.language || "English"],
        [
          "Joined",
          u.createdAt
            ? new Date(u.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })
            : "—",
        ],
      ]
    : [];

  return (
    <div className="zc-scrim" onClick={onClose}>
      <div className="zc-modal" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="mh">
          <span style={{ width: 40, height: 40, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 14, fontWeight: 700, color: "#fff", background: avc(customer.name), flex: "none" }}>
            {ini(customer.name)}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="t">{customer.name}</div>
            <div className="s">{customer.phone ? `+91 ${customer.phone}` : "No phone on file"}</div>
          </div>
          <span className={`zc-tag ${customer.registered ? "live" : "done"} sq`}>{customer.registered ? "Registered" : "Guest"}</span>
          <button type="button" className="zc-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="mb">
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 }}>Order history</div>
          <div className="zc-panel" style={{ padding: "4px 14px", marginBottom: u ? 18 : 0 }}>
            {orderRows.map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid var(--edge)", fontSize: 12.5 }}>
                <span style={{ color: "var(--text-3)" }}>{k}</span>
                <span className="tnum" style={{ fontWeight: 500, color: "var(--text-1)" }}>{v}</span>
              </div>
            ))}
          </div>

          {u && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 }}>Account info</div>
              <div className="zc-panel" style={{ padding: "4px 14px" }}>
                {accountRows.map(([k, v, mono, color]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid var(--edge)", fontSize: 12.5 }}>
                    <span style={{ color: "var(--text-3)" }}>{k}</span>
                    <span className={mono ? "tnum" : undefined} style={{ fontWeight: 500, color: color || "var(--text-1)", fontFamily: mono ? "monospace" : "inherit" }}>
                      {v}
                    </span>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 16, padding: 14, borderRadius: "var(--r-ctl)", background: "var(--stop-fill)", border: "1px solid var(--stop-line)" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--stop-ink)", marginBottom: 6 }}>Delete account</div>
                <div style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 12, lineHeight: 1.5 }}>
                  This will permanently remove the user. Their orders will remain in the system.
                </div>
                <button type="button" className="zc-btn danger block" disabled={busy} onClick={() => onDelete(u._id)}>
                  {busy ? "Deleting…" : "Delete user"}
                </button>
              </div>
            </>
          )}
        </div>

        <div className="mf">
          <button type="button" className="zc-btn pri" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════
export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [page, setPage] = useState(1);
  const [openKey, setOpenKey] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([getAllUsers({ limit: 5000 }), getAllOrders({ limit: 5000 })])
      .then(([uRes, oRes]) => {
        setUsers(uRes.data?.users || []);
        setOrders(oRes.data?.orders || []);
        setError(false);
        setLoading(false);
      })
      .catch(() => { setError(true); setLoading(false); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this user permanently?")) return;
    setBusyId(id);
    try {
      await deleteUser(id);
      setUsers((p) => p.filter((u) => u._id !== id));
      setOpenKey(null);
      toast.success("User deleted");
    } catch {
      toast.error("Delete failed");
    } finally {
      setBusyId(null);
    }
  };

  // ── build one row per customer: registered accounts keyed by user id,
  //    guests keyed by phone (or, lacking one, by that single order) ─────────
  //
  // For a WAITER/ADMIN-sourced order, `order.user` is the STAFF account that
  // keyed the order in (services/orderService.js placeOrderTx sets
  // `user: req.user._id` for whoever is authenticated when placing it) — the
  // actual walk-in customer's identity lives in guestName/guestPhone. Only a
  // CUSTOMER-sourced order's `user` is ever the customer's own account, so
  // staff-sourced orders are always grouped as a guest, regardless of `user`.
  const customers = useMemo(() => {
    const map = new Map();
    orders.forEach((o) => {
      const staffPlaced = o.source === "WAITER" || o.source === "ADMIN";
      const registered = !!o.user && !staffPlaced;
      const phone = (registered ? o.user?.phone : o.guestPhone) || "";
      const key = registered ? `u:${o.user._id}` : phone ? `g:${phone}` : `o:${o._id}`;
      if (!map.has(key)) {
        map.set(key, {
          key, registered, phone,
          name: (registered ? o.user?.name : o.guestName) || "Guest",
          userId: registered ? o.user?._id : null,
          orders: [],
        });
      }
      map.get(key).orders.push(o);
    });
    // fold in every registered account, including those with zero orders yet
    users.forEach((u) => {
      const key = `u:${u._id}`;
      if (!map.has(key)) {
        map.set(key, { key, registered: true, phone: u.phone || "", name: u.name || "—", userId: u._id, orders: [] });
      }
      map.get(key).user = u;
    });
    return Array.from(map.values())
      .map((c) => {
        const total = c.orders.reduce((s, o) => s + Number(o.total || 0), 0);
        const count = c.orders.length;
        const last = c.orders.reduce((latest, o) => (!latest || new Date(o.createdAt) > new Date(latest.createdAt) ? o : latest), null);
        return { ...c, orderCount: count, lifetime: total, average: count ? total / count : 0, lastOrderAt: last?.createdAt || null };
      })
      .sort((a, b) => b.lifetime - a.lifetime || b.orderCount - a.orderCount);
  }, [orders, users]);

  const filtered = customers.filter((c) => {
    const q = search.trim().toLowerCase();
    const matchQ = !q || c.name?.toLowerCase().includes(q) || c.phone?.includes(q);
    const matchT = typeFilter === "All" || (typeFilter === "Registered" ? c.registered : !c.registered);
    return matchQ && matchT;
  });

  const hasFilters = search || typeFilter !== "All";
  const clearFilters = () => { setSearch(""); setTypeFilter("All"); setPage(1); };

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);
  const pageList = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter((p) => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
    .reduce((acc, p, i, arr) => {
      if (i > 0 && arr[i - 1] !== p - 1) acc.push("…");
      acc.push(p);
      return acc;
    }, []);

  const openCustomer = openKey ? customers.find((c) => c.key === openKey) || null : null;

  // ── stats — live aggregates only ──────────────────────────────────────────
  const now = new Date();
  const registeredThisMonth = users.filter((u) => {
    const d = u.createdAt && new Date(u.createdAt);
    return d && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;
  const repeatCustomers = customers.filter((c) => c.registered && c.orderCount > 1).length;
  const returnRate = users.length ? Math.round((repeatCustomers / users.length) * 100) : 0;
  const guestOrderCount = orders.filter((o) => !o.user || o.source === "WAITER" || o.source === "ADMIN").length;
  const guestOrderPct = orders.length ? Math.round((guestOrderCount / orders.length) * 100) : 0;
  const topSpender = customers.length ? customers[0] : null;

  const STATS = [
    { label: "Registered", value: fmt(users.length), grad: true, sub: `+${registeredThisMonth} this month` },
    { label: "Repeat customers", value: fmt(repeatCustomers), color: "var(--ready-ink)", sub: `${returnRate}% return rate` },
    { label: "Guest orders", value: `${guestOrderPct}%`, color: "var(--text-2)", sub: "No account created" },
    {
      label: "Highest spender",
      value: topSpender ? `₹${fmt(topSpender.lifetime)}` : "—",
      sub: topSpender ? `${topSpender.name} · ${topSpender.orderCount} order${topSpender.orderCount === 1 ? "" : "s"}` : "No orders yet",
    },
  ];

  return (
    <div>
      <PageHeader
        title="Users"
        sub={`${users.length} registered customer${users.length === 1 ? "" : "s"} · ${customers.length} have ordered`}
      />

      {/* stat row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 20 }}>
        {STATS.map((b, i) => <StatCard key={i} {...b} />)}
      </div>

      {/* filters */}
      <div className="usr-filters">
        <input
          className="zc-input"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search by name or phone"
          aria-label="Search customers"
          style={{ flex: 1, minWidth: 240 }}
        />
        <div className="zc-seg" role="tablist" aria-label="Customer type filter">
          {TYPE_SEG.map((s) => (
            <button
              key={s} type="button" role="tab" aria-selected={typeFilter === s}
              className={typeFilter === s ? "on" : ""}
              onClick={() => { setTypeFilter(s); setPage(1); }}
            >
              {s}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        {hasFilters ? (
          <>
            <span style={{ fontSize: 12, color: "var(--text-2)" }}>
              <b style={{ color: "var(--accent-ink)" }}>{filtered.length}</b> of {customers.length}
            </span>
            <button type="button" className="zc-btn sm" onClick={clearFilters}>Clear ✕</button>
          </>
        ) : (
          <span style={{ fontSize: 12, color: "var(--text-3)" }}>{customers.length} customers</span>
        )}
      </div>

      {/* list */}
      <div className="zc-card">
        <div className="zc-card-h">
          <span className="t">Customers</span>
          <span className="s">{loading ? "loading…" : error ? "unavailable" : `${filtered.length} matching`}</span>
        </div>

        {loading ? (
          <div style={{ padding: "16px 18px" }}><Loader rows={8} /></div>
        ) : error ? (
          <ErrorState title="Could not load users"
            sub="The server did not respond. Check that the backend is running, then try again."
            onRetry={load} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" />
              </svg>
            }
            title={customers.length === 0 ? "No customers yet" : "No customers match"}
            sub={customers.length === 0
              ? "Customers appear here once they place an order or create an account."
              : "Nothing matches these filters. Try clearing them."}
            action={hasFilters ? <button type="button" className="zc-btn" onClick={clearFilters}>Clear filters</button> : null}
          />
        ) : (
          <>
            {/* desktop / tablet ledger */}
            <div className="usr-ledger-wrap" style={{ overflowX: "auto", padding: "6px 10px 8px" }}>
              <table className="zc-ledger" style={{ minWidth: 760 }}>
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th style={{ width: 140 }}>Phone</th>
                    <th className="num" style={{ width: 90 }}>Orders</th>
                    <th className="num" style={{ width: 110 }}>Lifetime</th>
                    <th className="num" style={{ width: 100 }}>Average</th>
                    <th style={{ width: 120 }}>Last order</th>
                    <th style={{ width: 100 }}>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((c) => (
                    <tr key={c.key} className="usr-click" onClick={() => setOpenKey(c.key)}>
                      <td>
                        <div className="usr-who">
                          <span className="av" style={{ background: avc(c.name) }}>{ini(c.name)}</span>
                          <div style={{ minWidth: 0 }}><b>{c.name}</b></div>
                        </div>
                      </td>
                      <td style={{ color: "var(--text-2)", fontSize: 11.5 }}>{c.phone ? `+91 ${c.phone}` : "—"}</td>
                      <td className="num" style={{ fontWeight: 600 }}>{c.orderCount}</td>
                      <td className="money">₹{fmt(c.lifetime)}</td>
                      <td className="num" style={{ color: "var(--text-2)" }}>₹{fmt(c.average)}</td>
                      <td className="usr-idc">
                        {c.lastOrderAt
                          ? new Date(c.lastOrderAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })
                          : "—"}
                      </td>
                      <td><span className={`zc-tag ${c.registered ? "live" : "done"} sq`}>{c.registered ? "Registered" : "Guest"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* mobile cards */}
            <div className="usr-cards" style={{ padding: "10px 12px 4px" }}>
              {paginated.map((c) => (
                <div key={c.key} className="usr-ocard" onClick={() => setOpenKey(c.key)}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <span style={{ width: 32, height: 32, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 11.5, fontWeight: 700, color: "#fff", background: avc(c.name), flex: "none" }}>
                      {ini(c.name)}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-1)" }}>{c.name}</div>
                      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>
                        {c.orderCount} order{c.orderCount === 1 ? "" : "s"} · ₹{fmt(c.lifetime)}
                      </div>
                    </div>
                    <span className={`zc-tag ${c.registered ? "live" : "done"} sq`}>{c.registered ? "Registered" : "Guest"}</span>
                  </div>
                </div>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="zc-tfoot" style={{ padding: "14px 18px 6px" }}>
                <span>
                  Showing {(safePage - 1) * PER_PAGE + 1}–{Math.min(safePage * PER_PAGE, filtered.length)} of {filtered.length}
                </span>
                <div className="zc-pager">
                  <button type="button" disabled={safePage === 1} onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label="Previous page">‹</button>
                  {pageList.map((p, i) =>
                    p === "…"
                      ? <span key={`g${i}`} className="gap">…</span>
                      : <button type="button" key={p} className={safePage === p ? "on" : ""} onClick={() => setPage(p)}>{p}</button>,
                  )}
                  <button type="button" disabled={safePage === totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} aria-label="Next page">›</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {openCustomer && (
        <CustomerDetailModal
          customer={openCustomer}
          busy={!!openCustomer.user && busyId === openCustomer.user._id}
          onClose={() => setOpenKey(null)}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
