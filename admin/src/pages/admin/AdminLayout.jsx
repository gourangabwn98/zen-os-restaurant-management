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
  BG_MAIN, BG_SIDEBAR, BORDER,
  TEXT_PRIMARY, TEXT_MUTED,
  GRADIENT_SIDEBAR,
  BRAND_NAME, BRAND_VERSION,
} from "../../theme.js";

const NAV = [
  { id: "orders",    label: "Billing",        icon: "📦", group: "main" },
  { id: "invoices",  label: "Invoices",       icon: "🧾", group: "main" },
  { id: "dashboard", label: "Dashboard",      icon: "⊞",  group: "main" },
  { id: "tables",    label: "Table Map",      icon: "🪑", group: "main" },
  { id: "menu",      label: "Menu Items",     icon: "🍽", group: "main" },
  { id: "employees", label: "Employees",      icon: "🧑‍🍳", group: "main" },
  { id: "inventory", label: "Inventory",      icon: "🗄️", group: "main" },
  { id: "users",     label: "Users",          icon: "👥", group: "main" },
  { id: "analytics", label: "Insights",       icon: "📊", group: "main" },
  { id: "profile",   label: "Profile",        icon: "⚙️", group: "settings" },
  { id: "help",      label: "Help & Support", icon: "❓", group: "settings" },
];

if (!document.getElementById("admin-layout-styles")) {
  const s = document.createElement("style");
  s.id = "admin-layout-styles";
  // All values resolve to tokens in src/theme/tokens.css so every class below
  // follows the light/dark toggle. Class names are kept stable — pages that
  // are not yet migrated to .zc-* still rely on .dark-card / .dark-input / etc.
  s.textContent = `
    .nav-item {
      display: flex; align-items: center; gap: 10px;
      padding: 9px 12px; border-radius: var(--r-ctl); margin: 1px 8px;
      cursor: pointer; font-size: 13px; font-weight: 400; color: var(--text-2);
      transition: var(--theme-transition); user-select: none; position: relative;
    }
    .nav-item:hover  { background: var(--raise); color: var(--text-1); }
    .nav-item.active {
      background: linear-gradient(96deg, var(--violet-mid), var(--violet-faint));
      color: var(--text-1);
      font-weight: 500;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.1), 0 4px 14px -6px var(--violet-glow);
    }
    .nav-item.active::before {
      content: ""; position: absolute; left: -8px; top: 7px; bottom: 7px;
      width: 3px; border-radius: 0 3px 3px 0;
      background: var(--grad-brand); box-shadow: 0 0 10px var(--violet-glow);
    }
    .nav-icon {
      width: 28px; height: 28px; border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      font-size: 15px; flex-shrink: 0; transition: var(--theme-transition);
    }
    .nav-item.active .nav-icon { background: var(--violet-mid); }
    .nav-item:hover  .nav-icon { background: var(--violet-weak); }
    .nav-group-label {
      padding: 14px 20px 5px; font-size: 10px; color: var(--text-3);
      letter-spacing: 1.5px; text-transform: uppercase; font-weight: 600;
    }
    .sidebar-logo-img { width: 120px; height: 48px; object-fit: contain; flex-shrink: 0; }
    .logout-btn {
      display: flex; align-items: center; gap: 8px;
      padding: 9px 12px; margin: 4px 8px; border-radius: var(--r-ctl);
      font-size: 13px; color: var(--stop-ink); cursor: pointer;
      transition: var(--theme-transition); border: none; background: none;
      width: calc(100% - 16px); font-family: inherit;
    }
    .logout-btn:hover { background: var(--stop-fill); }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ── Compatibility classes for pages not yet migrated to .zc-* ── */
    .admin-page-bg { background: transparent !important; }
    .dark-card {
      background: var(--card) !important;
      border: 1px solid var(--edge) !important;
      color: var(--text-1) !important;
    }
    .dark-table th { color: var(--text-2); border-bottom: 1px solid var(--edge); }
    .dark-table td { border-bottom: 1px solid var(--edge); }
    .dark-table tr:hover td { background: var(--raise); }
    .dark-input {
      background: var(--card-2) !important;
      border: 1px solid var(--edge) !important;
      color: var(--text-1) !important;
      border-radius: 8px;
    }
    .dark-input:focus {
      border-color: var(--violet-line) !important;
      box-shadow: 0 0 0 3px var(--violet-weak) !important;
    }
    .dark-input option { background: var(--card); color: var(--text-1); }
    .btn-primary-dark {
      background: var(--grad-btn) !important;
      color: #fff !important; border: none !important;
      box-shadow: 0 4px 15px -4px var(--violet-glow) !important;
    }
    .btn-primary-dark:hover { filter: brightness(1.08); transform: translateY(-1px); }
    .stat-card-dark {
      background: var(--card);
      border: 1px solid var(--edge);
      border-radius: var(--r-card);
      padding: 20px;
      position: relative;
      overflow: hidden;
    }
    .stat-card-dark::before {
      content: '';
      position: absolute;
      top: 0; right: 0;
      width: 80px; height: 80px;
      background: radial-gradient(circle, var(--violet-weak), transparent);
      border-radius: 0 var(--r-card) 0 80px;
    }
    select option { background: var(--card) !important; color: var(--text-1) !important; }
    .modal-dark {
      background: var(--grad-modal) !important;
      border: 1px solid var(--edge-hi) !important;
      box-shadow: var(--shadow-pop) !important;
    }
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

  const rName = restaurant?.restaurantName || "Ad's Cafe";
  const rLogo = restaurant?.logo || "";

  const mainNav     = NAV.filter((n) => n.group === "main");
  const settingsNav = NAV.filter((n) => n.group === "settings");

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: BG_MAIN }}>
      <NotificationBell user={user} />
      <aside style={{
        width: 228,
        background: BG_SIDEBAR,
        backgroundImage: GRADIENT_SIDEBAR,
        borderRight: `1px solid ${BORDER}`,
        position: "sticky", top: 0, height: "100vh",
        overflowY: "auto", display: "flex", flexDirection: "column",
      }}>
        {/* Brand */}
        <div style={{
          padding: "20px 16px 16px", borderBottom: `1px solid ${BORDER}`,
          display: "flex", alignItems: "center", gap: 11,
        }}>
          {rLogo ? (
            <img src={rLogo} alt={rName} className="sidebar-logo-img"
              onError={(e) => { e.currentTarget.style.display = "none"; }} />
          ) : (
            <>
              <div style={{
                width: 34, height: 34, borderRadius: 11, flexShrink: 0,
                display: "grid", placeItems: "center",
                fontWeight: 800, fontSize: 15, color: "#fff",
                background: "var(--grad-btn)",
                boxShadow: "0 6px 18px -4px var(--violet-glow), inset 0 1px 0 rgba(255,255,255,0.28)",
              }}>
                {rName.charAt(0).toUpperCase()}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontSize: 15.5, fontWeight: 700, letterSpacing: "-.02em",
                  color: TEXT_PRIMARY, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>
                  {rName}
                </div>
                <div style={{ fontSize: 11, color: TEXT_MUTED, marginTop: -2 }}>Admin panel</div>
              </div>
            </>
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

        {/* Footer */}
        <div style={{ borderTop: `1px solid ${BORDER}`, padding: "10px 8px 8px" }}>
          {user && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", marginBottom: 4 }}>
              <div style={{
                width: 32, height: 32, borderRadius: "50%",
                background: "var(--grad-btn)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13, fontWeight: 700, color: "#fff", flexShrink: 0,
                boxShadow: "0 4px 12px -3px var(--violet-glow)",
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
            style={{ textDecoration: "none", color: "var(--text-2)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 6 }}
          >
            <span style={{ fontSize: 15 }}>🍳</span> Kitchen Display
          </a>
          <button className="logout-btn" onClick={handleLogout}>
            <span style={{ fontSize: 15 }}>⎋</span> Sign out
          </button>

          <div style={{ padding: "8px 10px 4px" }}>
            <ThemeToggle />
          </div>

          <div style={{ padding: "4px 12px 2px", fontSize: 10, color: TEXT_MUTED }}>
            {BRAND_NAME} · {BRAND_VERSION}
          </div>
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
