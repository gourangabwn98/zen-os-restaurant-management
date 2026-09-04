// src/pages/admin/AdminLayout.jsx  — Full Dark Theme
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

import {
  PRIMARY, PRIMARY_LIGHT, PRIMARY_MID, PRIMARY_GLOW,
  BG_SIDEBAR, BG_MAIN, BG_CARD, BORDER,
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED,
  GRADIENT_PURPLE, GRADIENT_SIDEBAR,
  BRAND_NAME, BRAND_VERSION, BRAND_MAKER,
  STORAGE_KEY,
} from "../../theme.js";

const PINK = PRIMARY;

const NAV = [
   { id: "orders",    label: "Billing",       icon: "📦", group: "main" },
    { id: "invoices",  label: "Invoices",     icon: "🧾", group: "main" },
  { id: "dashboard", label: "Dashboard",    icon: "⊞",  group: "main" },
 
  { id: "tables",    label: "Table Map", icon: "🪑", group: "main" },
  { id: "menu",      label: "Menu Items",   icon: "🍽", group: "main" },
  { id: "employees", label: "Employees",     icon: "🧑‍🍳", group: "main" },
  { id: "inventory", label: "Inventory",    icon: "🗄️", group: "main" },
  { id: "users",     label: "Users",        icon: "👥", group: "main" },
 
  { id: "analytics", label: "Insights",      icon: "📊", group: "main" },
  { id: "profile",   label: "Profile",      icon: "⚙️", group: "settings" },
  { id: "help",      label: "Help & Support", icon: "❓", group: "settings" },
];

if (!document.getElementById("admin-layout-styles")) {
  const s = document.createElement("style");
  s.id = "admin-layout-styles";
  s.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,400&display=swap');
    * { box-sizing: border-box; }
    body { margin: 0; font-family: 'DM Sans', sans-serif; background: #1a1625; color: #f1f0f5; }

    .nav-item {
      display: flex; align-items: center; gap: 10px;
      padding: 9px 12px; border-radius: 10px; margin: 1px 8px;
      cursor: pointer; font-size: 13px; font-weight: 400; color: ${TEXT_SECONDARY};
      transition: all .15s; user-select: none;
    }
    .nav-item:hover  { background: rgba(255,255,255,0.05); color: ${TEXT_PRIMARY}; }
    .nav-item.active {
      background: ${PRIMARY_LIGHT};
      color: #c4b5fd;
      font-weight: 500;
      box-shadow: inset 0 0 0 1px rgba(124,58,237,0.2);
    }
    .nav-icon {
      width: 28px; height: 28px; border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      font-size: 15px; flex-shrink: 0; transition: background .15s;
    }
    .nav-item.active .nav-icon { background: ${PRIMARY_MID}; }
    .nav-item:hover  .nav-icon { background: rgba(255,255,255,0.08); }
    .nav-group-label {
      padding: 14px 20px 5px; font-size: 10px; color: ${TEXT_MUTED};
      letter-spacing: 1.5px; text-transform: uppercase; font-weight: 600;
    }
    .sidebar-logo-img { width: 120px; height: 48px; object-fit: contain; flex-shrink: 0; }
    .logout-btn {
      display: flex; align-items: center; gap: 8px;
      padding: 9px 12px; margin: 4px 8px; border-radius: 10px;
      font-size: 13px; color: #f87171; cursor: pointer;
      transition: background .15s; border: none; background: none;
      width: calc(100% - 16px); font-family: 'DM Sans', sans-serif;
    }
    .logout-btn:hover { background: rgba(248,113,113,0.1); }
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes darkPulse {
      0%,100%{ box-shadow: 0 0 0 0 rgba(124,58,237,0); }
      50%    { box-shadow: 0 0 20px 4px rgba(124,58,237,0.3); }
    }

    /* ── Global dark overrides for all pages ── */
    .admin-page-bg { background: transparent !important; }

    /* Cards */
    .dark-card {
      background: #1e1a2e !important;
      border: 1px solid rgba(255,255,255,0.07) !important;
      color: #f1f0f5 !important;
    }

    /* Tables */
    .dark-table th { color: #9ca3af; border-bottom: 1px solid rgba(255,255,255,0.07); }
    .dark-table td { border-bottom: 1px solid rgba(255,255,255,0.04); }
    .dark-table tr:hover td { background: rgba(124,58,237,0.05); }

    /* Inputs */
    .dark-input {
      background: #252038 !important;
      border: 1px solid rgba(255,255,255,0.1) !important;
      color: #f1f0f5 !important;
      border-radius: 8px;
    }
    .dark-input:focus {
      border-color: rgba(124,58,237,0.5) !important;
      box-shadow: 0 0 0 3px rgba(124,58,237,0.1) !important;
    }
    .dark-input option { background: #1e1a2e; color: #f1f0f5; }

    /* Buttons */
    .btn-primary-dark {
      background: linear-gradient(135deg, #7C3AED, #5b21b6) !important;
      color: #fff !important; border: none !important;
      box-shadow: 0 4px 15px rgba(124,58,237,0.3) !important;
    }
    .btn-primary-dark:hover { filter: brightness(1.1); transform: translateY(-1px); }

    /* Stat cards */
    .stat-card-dark {
      background: #1e1a2e;
      border: 1px solid rgba(255,255,255,0.07);
      border-radius: 16px;
      padding: 20px;
      position: relative;
      overflow: hidden;
    }
    .stat-card-dark::before {
      content: '';
      position: absolute;
      top: 0; right: 0;
      width: 80px; height: 80px;
      background: radial-gradient(circle, rgba(124,58,237,0.15), transparent);
      border-radius: 0 16px 0 80px;
    }

    /* Select dark */
    select option { background: #1e1a2e !important; color: #f1f0f5 !important; }

    /* Modal dark */
    .modal-dark {
      background: #1e1a2e !important;
      border: 1px solid rgba(255,255,255,0.1) !important;
      box-shadow: 0 25px 60px rgba(0,0,0,0.5) !important;
    }

    /* Scrollbar */
    ::-webkit-scrollbar { width: 5px; height: 5px; }
    ::-webkit-scrollbar-track { background: #12101a; }
    ::-webkit-scrollbar-thumb { background: rgba(124,58,237,0.3); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(124,58,237,0.5); }
  `;
  document.head.appendChild(s);
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

  const rName = restaurant?.restaurantName || "Kolhad Cafe";
  const rLogo = restaurant?.logo || "";

  const mainNav     = NAV.filter((n) => n.group === "main");
  const settingsNav = NAV.filter((n) => n.group === "settings");

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "'DM Sans', sans-serif", background: BG_MAIN }}>
      <NotificationBell user={user} />
      <aside style={{
        width: 220,
        background: BG_SIDEBAR,
        borderRight: `1px solid ${BORDER}`,
        position: "sticky", top: 0, height: "100vh",
        overflowY: "auto", display: "flex", flexDirection: "column",
        backgroundImage: GRADIENT_SIDEBAR,
      }}>
        {/* Logo */}
        <div style={{ padding: "20px 16px 16px", borderBottom: `1px solid ${BORDER}` }}>
          {rLogo ? (
            <img src={rLogo} alt={rName} className="sidebar-logo-img"
              onError={(e) => { e.currentTarget.style.display = "none"; }} />
          ) : (
            <div style={{ fontSize: 22, fontWeight: 700, color: "#c4b5fd", letterSpacing: -0.5 }}>
              {rName}
            </div>
          )}
        </div>

        {/* Main nav */}
        <div className="nav-group-label">Management</div>
        {mainNav.map((n) => (
          <div key={n.id} className={`nav-item${page === n.id ? " active" : ""}`} onClick={() => setPage(n.id)}>
            <div className="nav-icon">{n.icon}</div>
            {n.label}
          </div>
        ))}

        <div className="nav-group-label" style={{ marginTop: 8 }}>Settings</div>
        {settingsNav.map((n) => (
          <div key={n.id} className={`nav-item${page === n.id ? " active" : ""}`} onClick={() => setPage(n.id)}>
            <div className="nav-icon">{n.icon}</div>
            {n.label}
          </div>
        ))}

        <div style={{ flex: 1 }} />

        {/* User footer */}
        <div style={{ borderTop: `1px solid ${BORDER}`, padding: "10px 8px 8px" }}>
          {user && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", marginBottom: 4 }}>
              <div style={{
                width: 32, height: 32, borderRadius: "50%",
                background: PRIMARY_MID,
                border: `2px solid rgba(124,58,237,0.4)`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13, fontWeight: 600, color: "#c4b5fd", flexShrink: 0,
              }}>
                {(user.name || user.email || "A").charAt(0).toUpperCase()}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: TEXT_PRIMARY, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {user.name || "Admin"}
                </div>
                <div style={{ fontSize: 10, color: TEXT_MUTED, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {user.email || user.phone || ""}
                </div>
              </div>
            </div>
          )}
          <a
            href="/kitchen" target="_blank" rel="noopener noreferrer"
            className="logout-btn"
            style={{ textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 8 }}
          >
            <span style={{ fontSize: 15 }}>🍳</span> Kitchen Display
          </a>
          <button className="logout-btn" onClick={handleLogout}>
            <span style={{ fontSize: 15 }}>⎋</span> Sign out
          </button>
          <div style={{ padding: "6px 12px", fontSize: 10, color: TEXT_MUTED }}>
            {BRAND_NAME} {BRAND_VERSION} · {BRAND_MAKER}
          </div>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main style={{
        flex: 1, padding: 24, overflowY: "auto", minHeight: "100vh",
        background: BG_MAIN,
        backgroundImage: GRADIENT_PURPLE,
        backgroundAttachment: "fixed",
      }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: "100px 0", color: TEXT_MUTED }}>
            <div style={{
              width: 36, height: 36, borderRadius: "50%",
              border: `3px solid ${PRIMARY_LIGHT}`,
              borderTopColor: PRIMARY,
              animation: "spin .7s linear infinite",
              margin: "0 auto 16px",
            }} />
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
