// src/pages/admin/AdminLayout.jsx — Ad's Cafe admin shell
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth.js";
import { getDashboard, getRestaurantProfile } from "../../services/adminService.js";
import toast from "react-hot-toast";

import DashboardPage  from "./DashboardPage.jsx";
import OrdersPage     from "./OrdersPage.jsx";
import TablesPage     from "./TablesPage.jsx";
import MenuAdminPage  from "./MenuAdminPage.jsx";
import UsersPage      from "./UsersPage.jsx";
import InvoicesPage   from "./InvoicesPage.jsx";
import AnalyticsPage  from "./AnalyticsPage.jsx";
import EmployeesPage   from "./EmployeesPage.jsx";
import InventoryPage  from "./InventoryPage.jsx";
import ProfilePage    from "./ProfilePage.jsx";
import HelpPage       from "./HelpPage.jsx";
import NotificationBell from "../../components/NotificationBell.jsx";
import OpsAlertsPanel from "../../components/OpsAlertsPanel.jsx";
import ThemeToggle from "../../components/ThemeToggle.jsx";

import {
  BG_MAIN, TEXT_MUTED,
  BRAND_NAME, BRAND_VERSION,
} from "../../theme.js";

// ── nav icons (line style, matching design-reference/zen-os-design-reference.html's `I` set) ──
const ICONS = {
  billing:   <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18" /></>,
  tables:    <><circle cx="12" cy="12" r="8" /><path d="M12 4v16M4 12h16" /></>,
  chef:      <><path d="M7 21h10M8 21v-5h8v5" /><path d="M6 12a3 3 0 0 1 1-5.8A3.5 3.5 0 0 1 12 4a3.5 3.5 0 0 1 5 2.2A3 3 0 0 1 18 12z" /></>,
  dash:      <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  invoices:  <><path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z" /><path d="M9 8h6M9 12h6" /></>,
  insights:  <><path d="M4 19V5M4 19h16" /><path d="M8 16v-5M13 16V8M18 16v-3" /></>,
  menu:      <path d="M4 5h16M4 12h16M4 19h10" />,
  inventory: <><path d="M3 7l9-4 9 4v10l-9 4-9-4z" /><path d="M3 7l9 4 9-4M12 11v10" /></>,
  employees: <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 8h5M18.5 5.5v5" /></>,
  users:     <><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></>,
  profile:   <><circle cx="12" cy="12" r="3" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" /></>,
  help:      <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3 2.4V14" /><path d="M12 17.5v.01" /></>,
};
const Icon = ({ id }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {ICONS[id]}
  </svg>
);

// Grouped the same way as the reference sidebar: Service / Money / Setup, then
// a separate Settings section pinned to the bottom.
const SERVICE_NAV = [
  { id: "orders", label: "Billing", icon: "billing", badgeKey: "active" },
  { id: "tables", label: "Table Map", icon: "tables", badgeKey: "tables" },
];
const MONEY_NAV = [
  { id: "dashboard", label: "Dashboard", icon: "dash" },
  { id: "invoices", label: "Invoices", icon: "invoices" },
  { id: "analytics", label: "Insights", icon: "insights" },
];
const SETUP_NAV = [
  { id: "menu", label: "Menu Items", icon: "menu" },
  { id: "inventory", label: "Inventory", icon: "inventory" },
  { id: "employees", label: "Employees", icon: "employees" },
  { id: "users", label: "Users", icon: "users" },
];
const SETTINGS_NAV = [
  { id: "profile", label: "Profile", icon: "profile" },
  { id: "help", label: "Help & Support", icon: "help" },
];

if (!document.getElementById("admin-layout-styles")) {
  const s = document.createElement("style");
  s.id = "admin-layout-styles";
  s.textContent = `
    .side { width: 228px; flex: none; display: flex; flex-direction: column; padding-bottom: 12px;
      background: var(--grad-rail); border-right: 1px solid var(--edge); position: sticky; top: 0;
      height: 100vh; overflow-y: auto; }
    .side::after { content: ""; position: absolute; top: 0; left: 0; right: 0; height: 200px;
      pointer-events: none; background: var(--glow-side); }
    .side-brand { padding: 19px 18px 17px; display: flex; align-items: center; gap: 11px; position: relative; z-index: 1; }
    .side-logo-img { width: 120px; height: 44px; object-fit: contain; flex-shrink: 0; }
    .side-mk { width: 34px; height: 34px; border-radius: 11px; flex: none; display: grid; place-items: center;
      font-weight: 800; font-size: 15px; color: #fff; background: var(--grad-btn);
      box-shadow: 0 6px 18px -4px var(--violet-glow), inset 0 1px 0 rgba(255,255,255,.28); }
    .side-nm { font-size: 15.5px; font-weight: 700; letter-spacing: -.02em; color: var(--text-1);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .side-sb { font-size: 11px; color: var(--text-3); margin-top: -2px; }
    .side-sp { flex: 1; }
    .side-who { margin: 10px 9px 0; padding: 11px; border-radius: var(--r-ctl); display: flex; align-items: center;
      gap: 10px; background: linear-gradient(140deg, rgba(255,255,255,.055), rgba(255,255,255,.01));
      border: 1px solid var(--edge); position: relative; z-index: 1; }
    .side-who .av { width: 31px; height: 31px; border-radius: 50%; flex: none; display: grid; place-items: center;
      font-size: 12px; font-weight: 700; color: #fff; background: var(--grad-btn);
      box-shadow: 0 4px 12px -3px var(--violet-glow); }
    .side-who .n { font-size: 12.5px; font-weight: 600; line-height: 1.25; color: var(--text-1);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .side-who .r { font-size: 10.5px; color: var(--text-3); line-height: 1.3;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .side-foot { position: relative; z-index: 1; padding: 8px 9px 0; }
    .side-foot-btn { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: var(--r-ctl);
      font-size: 12.5px; color: var(--text-2); cursor: pointer; border: none; background: none; width: 100%;
      font-family: inherit; text-decoration: none; box-sizing: border-box; transition: var(--theme-transition); }
    .side-foot-btn:hover { background: var(--raise); color: var(--text-1); }
    .side-foot-btn.danger { color: var(--stop-ink); }
    .side-foot-btn.danger:hover { background: var(--stop-fill); }
    .side-version { padding: 6px 12px 0; font-size: 10px; color: var(--text-3); }
    @keyframes spin { to { transform: rotate(360deg); } }
  `;
  document.head.appendChild(s);
}

function NavItem({ id, label, icon, active, count, onClick }) {
  return (
    <div className={`zc-nav${active ? " on" : ""}`} onClick={onClick}>
      <Icon id={icon} />{label}
      {count > 0 && <span className="ct">{count}</span>}
    </div>
  );
}

export default function AdminLayout() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const [page, setPage]               = useState("orders");
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading]         = useState(true);
  const [restaurant, setRestaurant]   = useState(null);

  useEffect(() => {
    if (!user) { navigate("/login"); return; }
    Promise.all([getDashboard(), getRestaurantProfile()])
      .then(([dashRes, profileRes]) => {
        setDashboardData(dashRes.data);
        const p = profileRes?.data?.data || profileRes?.data;
        setRestaurant(p || null);
      })
      .catch(() => toast.error("Failed to load dashboard"))
      .finally(() => setLoading(false));
  }, [user, navigate]);

  const handleLogout = () => {
    if (!window.confirm("Are you sure you want to sign out?")) return;
    logout?.();
    navigate("/login");
  };

  const rName = restaurant?.restaurantName || "Ad's Cafe";
  const rLogo = restaurant?.logo || "";

  // Real, cheap-to-derive counts only — no invented numbers. Everything else
  // in the reference's nav badges (Kitchen, Dashboard, Insights, …) was blank
  // too, so most items here stay without a badge.
  const activeOrders = (dashboardData?.ordersByStatus || [])
    .filter((s) => s._id !== "COMPLETED" && s._id !== "CANCELLED")
    .reduce((sum, s) => sum + (s.count || 0), 0);
  const totalTables = dashboardData?.stats?.totalTables || 0;
  const badgeFor = (key) => (key === "active" ? activeOrders : key === "tables" ? totalTables : 0);

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: BG_MAIN }}>
      <NotificationBell user={user} onNavigate={() => setPage("orders")} />
      <aside className="side">
        <div className="side-brand">
          {rLogo ? (
            <img src={rLogo} alt={rName} className="side-logo-img" onError={(e) => { e.currentTarget.style.display = "none"; }} />
          ) : (
            <>
              <div className="side-mk">{rName.charAt(0).toUpperCase()}</div>
              <div style={{ minWidth: 0 }}>
                <div className="side-nm">{rName}</div>
                <div className="side-sb">Admin panel</div>
              </div>
            </>
          )}
        </div>

        <div className="zc-navgrp">Service</div>
        {SERVICE_NAV.map((n) => (
          <NavItem key={n.id} {...n} active={page === n.id} count={badgeFor(n.badgeKey)} onClick={() => setPage(n.id)} />
        ))}
        <a href="/kitchen" target="_blank" rel="noopener noreferrer" className="zc-nav" style={{ textDecoration: "none" }}>
          <Icon id="chef" />Kitchen Display
        </a>

        <div className="zc-navgrp">Money</div>
        {MONEY_NAV.map((n) => (
          <NavItem key={n.id} {...n} active={page === n.id} onClick={() => setPage(n.id)} />
        ))}

        <div className="zc-navgrp">Setup</div>
        {SETUP_NAV.map((n) => (
          <NavItem key={n.id} {...n} active={page === n.id} onClick={() => setPage(n.id)} />
        ))}

        <div className="side-sp" />
        <div className="zc-navgrp">Settings</div>
        {SETTINGS_NAV.map((n) => (
          <NavItem key={n.id} {...n} active={page === n.id} onClick={() => setPage(n.id)} />
        ))}

        {user && (
          <div className="side-who">
            <div className="av">{(user.name || user.email || "A").charAt(0).toUpperCase()}</div>
            <div style={{ minWidth: 0 }}>
              <div className="n">{user.name || "Admin"}</div>
              <div className="r">{user.email || user.phone || ""}</div>
            </div>
          </div>
        )}

        <div className="side-foot">
          <button type="button" className="side-foot-btn danger" onClick={handleLogout}>
            <span style={{ fontSize: 14 }}>⎋</span> Sign out
          </button>
          <div style={{ padding: "4px 3px 0" }}><ThemeToggle /></div>
          <div className="side-version">{BRAND_NAME} · {BRAND_VERSION}</div>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main style={{
        flex: 1, padding: 24, overflowY: "auto", minHeight: "100vh",
        background: BG_MAIN,
        backgroundImage: "var(--glow-main)",
        backgroundAttachment: "fixed",
      }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: "100px 0", color: TEXT_MUTED }}>
            <div className="zc-spin" style={{ margin: "0 auto 16px" }} />
            <div style={{ fontSize: 14 }}>Loading…</div>
          </div>
        ) : (
          <>
            {page === "dashboard"  && <OpsAlertsPanel />}
            {page === "dashboard"  && <DashboardPage data={dashboardData} />}
            {page === "orders"     && <OrdersPage />}
            {page === "tables"     && <TablesPage />}
            {page === "menu"       && <MenuAdminPage />}
            {page === "employees"  && <EmployeesPage />}
            {page === "inventory"  && <InventoryPage />}
            {page === "users"      && <UsersPage />}
            {page === "invoices"   && <InvoicesPage data={dashboardData?.recentOrders} />}
            {page === "analytics"  && <AnalyticsPage data={dashboardData} />}
            {page === "profile"    && <ProfilePage />}
            {page === "help"       && <HelpPage />}
          </>
        )}
      </main>
    </div>
  );
}
