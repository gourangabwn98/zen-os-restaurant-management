// src/pages/admin/AdminLayout.jsx — Hotel KHOAI admin / POS shell
import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth.js";
import { canOpenPage, isManager } from "../../utils/access.js";
import { getDashboard, getRestaurantProfile } from "../../services/adminService.js";
import { getSocket } from "../../services/socketService.js";
import { useLiveOrders } from "../../hooks/useLiveOrders.js";
import { invalidate } from "../../services/cache.js";
import toast from "react-hot-toast";

// Orders is the landing screen and the one used under rush — it ships in the
// main bundle so it paints without an extra round trip. Every other page is a
// separate chunk, fetched on first visit (and prefetched once the app is idle).
import OrdersPage     from "./OrdersPage.jsx";
const PAGE_LOADERS = {
  dashboard:     () => import("./DashboardPage.jsx"),
  tables:        () => import("./TablesPage.jsx"),
  menu:          () => import("./MenuAdminPage.jsx"),
  users:         () => import("./UsersPage.jsx"),
  notifications: () => import("./NotificationsPage.jsx"),
  coupons:       () => import("./CouponsPage.jsx"),
  invoices:      () => import("./InvoicesPage.jsx"),
  analytics:     () => import("./AnalyticsPage.jsx"),
  employees:     () => import("./EmployeesPage.jsx"),
  inventory:     () => import("./InventoryPage.jsx"),
  profile:       () => import("./ProfilePage.jsx"),
  help:          () => import("./HelpPage.jsx"),
};
const DashboardPage     = lazy(PAGE_LOADERS.dashboard);
const TablesPage        = lazy(PAGE_LOADERS.tables);
const MenuAdminPage     = lazy(PAGE_LOADERS.menu);
const UsersPage         = lazy(PAGE_LOADERS.users);
const NotificationsPage = lazy(PAGE_LOADERS.notifications);
const CouponsPage       = lazy(PAGE_LOADERS.coupons);
const InvoicesPage      = lazy(PAGE_LOADERS.invoices);
const AnalyticsPage     = lazy(PAGE_LOADERS.analytics);
const EmployeesPage     = lazy(PAGE_LOADERS.employees);
const InventoryPage     = lazy(PAGE_LOADERS.inventory);
const ProfilePage       = lazy(PAGE_LOADERS.profile);
const HelpPage          = lazy(PAGE_LOADERS.help);

// Warm every page chunk in the background once the first screen is up, so
// switching pages later is instant. Network-friendly: one at a time, idle only.
const prefetchPages = () => {
  const queue = Object.values(PAGE_LOADERS);
  const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 300));
  const next = () => { const load = queue.shift(); if (load) load().catch(() => {}).finally(() => idle(next)); };
  idle(next);
};

const PageFallback = () => (
  <div style={{ padding: "24px 4px" }} aria-busy="true">
    {Array.from({ length: 5 }).map((_, i) => <div key={i} className="zc-skel" />)}
  </div>
);
import NotificationBell from "../../components/NotificationBell.jsx";
import ThemeToggle from "../../components/ThemeToggle.jsx";
import LanguageToggle from "../../components/LanguageToggle.jsx";
import { t, N_ } from "../../i18n/core.js";

import { BG_MAIN } from "../../theme.js";
import { BRAND, displayName, displayLogo } from "../../brand.js";

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
  coupon:    <><path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z" /><path d="M9 15l6-6" /><circle cx="9.5" cy="9.5" r=".6" /><circle cx="14.5" cy="14.5" r=".6" /></>,
  bell:      <><path d="M6 8a6 6 0 0 1 12 0c0 4 1.5 6 2 7H4c.5-1 2-3 2-7Z" /><path d="M10 19a2 2 0 0 0 4 0" /></>,
  profile:   <><circle cx="12" cy="12" r="3" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" /></>,
  help:      <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3 2.4V14" /><path d="M12 17.5v.01" /></>,
  // Sidebar toggle — a panel glyph with a chevron pointing the direction the
  // click will move things, so "open" and "close" are visually distinct
  // rather than the same icon rotated.
  sidebarClose: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /><path d="M14.5 9l-2.5 3 2.5 3" /></>,
  sidebarOpen:  <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /><path d="M12 9l2.5 3-2.5 3" /></>,
};
const Icon = ({ id }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {ICONS[id]}
  </svg>
);

// Four groups: Operations (the floor — billing, tables, kitchen, dashboard,
// invoices, inventory), Management (staff/customers/menu config), Finance
// (Insights), then Settings pinned to the bottom.
const OPERATIONS_NAV_A = [
  { id: "orders", label: N_("Orders"), icon: "billing", badgeKey: "active" },
  { id: "tables", label: N_("Table Map"), icon: "tables", badgeKey: "tables" },
];
const OPERATIONS_NAV_B = [
  { id: "dashboard", label: N_("Dashboard"), icon: "dash" },
  { id: "invoices", label: N_("Invoices"), icon: "invoices" },
  { id: "inventory", label: N_("Inventory"), icon: "inventory" },
];
const MANAGEMENT_NAV = [
  { id: "employees", label: N_("Employees"), icon: "employees" },
  { id: "users", label: N_("Users"), icon: "users" },
  { id: "menu", label: N_("Menu Items"), icon: "menu" },
  { id: "notifications", label: N_("Notifications"), icon: "bell" },
  { id: "coupons", label: N_("Offers"), icon: "coupon" },
];
const FINANCE_NAV = [
  { id: "analytics", label: N_("Insights"), icon: "insights" },
];
const SETTINGS_NAV = [
  { id: "profile", label: N_("Profile"), icon: "profile" },
  { id: "help", label: N_("Help & Support"), icon: "help" },
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
    /* Reserves its own flex column when the sidebar is hidden — the toggle
       button lives here, never floating on top of the main content, so a
       page's own title/header text is never covered by it. */
    .side-mini { width: 52px; flex: none; display: flex; flex-direction: column; align-items: center;
      padding-top: 19px; background: var(--grad-rail); border-right: 1px solid var(--edge);
      position: sticky; top: 0; height: 100vh; }
    .side-toggle-btn { width: 34px; height: 34px; flex: none; display: flex; align-items: center;
      justify-content: center; border-radius: var(--r-ctl); border: 1px solid var(--edge);
      background: transparent; color: var(--text-2); cursor: pointer; transition: var(--theme-transition); }
    .side-toggle-btn:hover { background: var(--raise); color: var(--text-1); }
    .side-brand { padding: 19px 18px 14px; display: flex; align-items: center; gap: 11px; position: relative; z-index: 1; }
    .side-mk { width: 38px; height: 38px; border-radius: 11px; flex: none; display: grid; place-items: center;
      font-weight: 800; font-size: 15px; color: #fff; background: var(--grad-btn); overflow: hidden;
      box-shadow: 0 6px 18px -4px var(--violet-glow), inset 0 1px 0 rgba(255,255,255,.28); }
    .side-mk img { width: 100%; height: 100%; object-fit: contain; }
    .side-nm { font-size: 15.5px; font-weight: 700; letter-spacing: -.02em; color: var(--text-1);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .side-sb { font-size: 11px; color: var(--text-3); margin-top: -2px; }
    .side-toolbar { padding: 0 18px 15px; display: flex; align-items: center; gap: 8px; position: relative; z-index: 1;
      justify-content: space-between; }
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
    /* GLB-06 — collapsed rail: icons only, same navigation, bell on top. */
    .side.side-rail { width: 64px; align-items: center; padding-bottom: 12px; }
    .side-rail .side-brand { padding: 16px 0 10px; flex-direction: column; gap: 10px; }
    .side-rail .zc-nav { width: 44px; height: 40px; padding: 0; justify-content: center; position: relative; }
    .side-rail .zc-nav .ct { position: absolute; top: 2px; right: 2px; margin: 0; min-width: 16px; height: 16px; font-size: 9.5px; padding: 0 4px; }
    .side-rail .zc-navgrp { width: 36px; height: 1px; padding: 0; margin: 10px 0; background: var(--edge); overflow: hidden; color: transparent; }
    .side-rail .side-foot { padding: 8px 0 0; }
    .side-rail .side-foot-btn { justify-content: center; width: 44px; padding: 8px 0; }
    .side-mk.sm { width: 34px; height: 34px; border-radius: 50%; }
    /* Phones: a slim top bar keeps the menu button and the bell top-left. */
    .side-topbar { position: sticky; top: 0; z-index: 30; display: flex; align-items: center; gap: 10px; padding: 10px 14px;
      background: var(--bg); border-bottom: 1px solid var(--edge); }
    .side-topbar .nm { font-weight: 700; color: var(--text-1); font-size: 14px; flex: 1; min-width: 0;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    /* Phones / small tablets: the sidebar is a slide-over drawer above the
       page (it used to stay docked and leave a 390px phone ~160px of page). */
    .side.side-drawer { position: fixed; left: 0; top: 0; z-index: 950; box-shadow: var(--shadow-pop);
      max-width: calc(100vw - 48px); }
    .side-scrim { position: fixed; inset: 0; z-index: 940; background: var(--scrim); }
    @keyframes spin { to { transform: rotate(360deg); } }
  `;
  document.head.appendChild(s);
}

function NavItem({ label, icon, active, count, onClick, rail }) {
  // A real button: keyboard reachable; in the rail the label is the tooltip.
  return (
    <button type="button" className={`zc-nav${active ? " on" : ""}`} onClick={onClick}
      title={rail ? t(label) : undefined} aria-label={rail ? t(label) : undefined} aria-current={active ? "page" : undefined}
      style={{ border: "none", background: active ? undefined : "transparent", font: "inherit", textAlign: "left", width: rail ? undefined : "100%" }}>
      <Icon id={icon} />{!rail && t(label)}
      {count > 0 && <span className="ct">{count}</span>}
    </button>
  );
}

export default function AdminLayout() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  // Open page survives a refresh and a language switch (which remounts the
  // app — see i18n/LanguageProvider.jsx). Per tab, so two tabs stay independent.
  const [page, setPageRaw]            = useState(() => {
    // Attendance now lives inside Employees (person → Attendance tab).
    try {
      const p = sessionStorage.getItem("adminPage") || "orders";
      const want = p === "attendance" ? "employees" : p;
      return canOpenPage(user, want) ? want : "orders"; // a manager never lands on an admin-only page
    } catch { return "orders"; }
  });
  // Every way of changing page (sidebar, bell, a page's own links) goes
  // through here, so a manager can't be sent to a page they don't have.
  const setPage = useCallback((id) => { if (canOpenPage(user, id)) setPageRaw(id); }, [user]);
  const manager = isManager(user);
  const allowed = (list) => list.filter((n) => canOpenPage(user, n.id));
  useEffect(() => { try { sessionStorage.setItem("adminPage", page); } catch { /* storage disabled */ } }, [page]);
  const [dashboardData, setDashboardData] = useState(null);
  const [restaurant, setRestaurant]   = useState(null);
  // GLB-06: expanded sidebar or a collapsed icon rail (navigation and the
  // bell stay available either way), remembered on this device. The old
  // "adminSidebarOpen = 0" (fully hidden) now means collapsed.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const v = localStorage.getItem("adminSidebarMode");
      return v ? v === "collapsed" : localStorage.getItem("adminSidebarOpen") === "0";
    } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem("adminSidebarMode", collapsed ? "collapsed" : "expanded"); } catch { /* storage off */ } }, [collapsed]);
  // Narrow screens get a drawer instead (not persisted: it opens on demand
  // and closes once a page is picked).
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 820px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 820px)");
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const rail = !narrow && collapsed;
  const go = (id) => { setPage(id); if (narrow) setDrawerOpen(false); };
  // Where the notification panel opens: just right of the sidebar / rail.
  const panelLeft = narrow ? 0 : rail ? 64 : 228;

  // Nothing here gates the first paint any more: the page renders at once and
  // the sidebar badges / restaurant name fill in when these arrive.
  useEffect(() => {
    if (!user) { navigate("/login"); return; }
    getRestaurantProfile()
      .then((profileRes) => setRestaurant(profileRes?.data?.data || profileRes?.data || null))
      .catch(() => {});
    getDashboard()
      .then((dashRes) => setDashboardData(dashRes.data))
      .catch(() => toast.error(t("Failed to load dashboard")));
  }, [user, navigate]);
  useEffect(() => { prefetchPages(); }, []);
  // Sidebar order badge: re-read the counts on every order event (a new
  // customer order shows at once) and after a socket reconnect.
  const refreshCounts = useCallback(() => {
    getDashboard().then((r) => setDashboardData(r.data)).catch(() => {});
  }, []);
  useLiveOrders(refreshCounts, { debounceMs: 800 });
  // Any menu change (this admin or another device) drops the cached order data.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const onMenu = () => invalidate("order:menu");
    socket.on("menu:updated", onMenu);
    return () => socket.off("menu:updated", onMenu);
  }, []);

  const handleLogout = () => {
    if (!window.confirm(t("Are you sure you want to sign out?"))) return;
    logout?.();
    navigate("/login");
  };

  // GLB-01/02: the profile's name/logo once loaded, Hotel KHOAI before that
  // (src/brand.js) — never another restaurant's placeholder.
  const rName = displayName(restaurant);
  const rLogo = displayLogo(restaurant);

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
      {/* Phones / small tablets: slim top bar (menu + bell, top-left) + drawer. */}
      {narrow && drawerOpen && <div className="side-scrim" onClick={() => setDrawerOpen(false)} aria-hidden="true" />}

      {(!narrow || drawerOpen) && (
        <aside className={`side${narrow ? " side-drawer" : ""}${rail ? " side-rail" : ""}`} aria-label={t("Main menu")}>
          <div className="side-brand">
            <div className={`side-mk${rail ? " sm" : ""}`}>
              <img src={rLogo} alt={rName} onError={(e) => { e.currentTarget.src = BRAND.mark; }} />
            </div>
            {!rail && (
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="side-nm">{rName}</div>
                <div className="side-sb">{t("Admin panel")}</div>
              </div>
            )}
            {/* NTF-01: the bell, always top-left */}
            <NotificationBell user={user} onGo={go} panelLeft={panelLeft} />
          </div>

          {!rail && (
            <>
              <div className="side-toolbar">
                <div style={{ flex: 1, minWidth: 0 }}><ThemeToggle compact /></div>
                {!narrow && (
                  <button type="button" className="side-toggle-btn" onClick={() => setCollapsed(true)} title={t("Collapse sidebar")} aria-label={t("Collapse sidebar")}>
                    <Icon id="sidebarClose" />
                  </button>
                )}
                {narrow && (
                  <button type="button" className="side-toggle-btn" onClick={() => setDrawerOpen(false)} title={t("Close menu")} aria-label={t("Close menu")}>
                    <Icon id="sidebarClose" />
                  </button>
                )}
              </div>
              <div className="side-toolbar" style={{ marginTop: -6 }}>
                <LanguageToggle compact />
              </div>
            </>
          )}
          {rail && (
            <button type="button" className="side-toggle-btn" onClick={() => setCollapsed(false)} title={t("Expand sidebar")} aria-label={t("Expand sidebar")} style={{ marginBottom: 6 }}>
              <Icon id="sidebarOpen" />
            </button>
          )}

          <div className="zc-navgrp">{t("Operations")}</div>
          {allowed(OPERATIONS_NAV_A).map((n) => (
            <NavItem key={n.id} {...n} rail={rail} active={page === n.id} count={badgeFor(n.badgeKey)} onClick={() => go(n.id)} />
          ))}
          {!manager && (
            <a href="/kitchen" target="_blank" rel="noopener noreferrer" className="zc-nav" style={{ textDecoration: "none" }}
              title={rail ? t("Kitchen Display") : undefined} aria-label={rail ? t("Kitchen Display") : undefined}>
              <Icon id="chef" />{!rail && t("Kitchen Display")}
            </a>
          )}
          {allowed(OPERATIONS_NAV_B).map((n) => (
            <NavItem key={n.id} {...n} rail={rail} active={page === n.id} onClick={() => go(n.id)} />
          ))}

          <div className="zc-navgrp">{t("Management")}</div>
          {allowed(MANAGEMENT_NAV).map((n) => (
            <NavItem key={n.id} {...n} rail={rail} active={page === n.id} onClick={() => go(n.id)} />
          ))}

          {allowed(FINANCE_NAV).length > 0 && <div className="zc-navgrp">{t("Finance")}</div>}
          {allowed(FINANCE_NAV).map((n) => (
            <NavItem key={n.id} {...n} rail={rail} active={page === n.id} onClick={() => go(n.id)} />
          ))}

          <div className="side-sp" />
          <div className="zc-navgrp">{t("Settings")}</div>
          {allowed(SETTINGS_NAV).map((n) => (
            <NavItem key={n.id} {...n} rail={rail} active={page === n.id} onClick={() => go(n.id)} />
          ))}

          {user && !rail && (
            <div className="side-who">
              <div className="av">{(user.name || user.email || "A").charAt(0).toUpperCase()}</div>
              <div style={{ minWidth: 0 }}>
                <div className="n">{user.name || t(manager ? "Manager" : "Admin")}{manager && <span style={{ color: "var(--text-3)", fontWeight: 500 }}> · {t("Manager")}</span>}</div>
                <div className="r">{user.email || user.phone || ""}</div>
              </div>
            </div>
          )}

          <div className="side-foot">
            <button type="button" className="side-foot-btn danger" onClick={handleLogout} title={rail ? t("Sign out") : undefined} aria-label={rail ? t("Sign out") : undefined}>
              <span style={{ fontSize: 14 }}>⎋</span>{!rail && ` ${t("Sign out")}`}
            </button>
            {!rail && <div className="side-version">{BRAND.name} · {BRAND.version}</div>}
          </div>
        </aside>
      )}

      {/* ── Main content ── */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
      {narrow && (
        <div className="side-topbar">
          <button type="button" className="side-toggle-btn" onClick={() => setDrawerOpen(true)} title={t("Open menu")} aria-label={t("Open menu")}>
            <Icon id="sidebarOpen" />
          </button>
          {!drawerOpen && <NotificationBell user={user} onGo={go} panelLeft={0} />}
          <div className="nm">{rName}</div>
        </div>
      )}
      <main style={{
        // The window scrolls, not <main>. overflow-x "clip" (not "auto") keeps
        // wide content from side-scrolling the page WITHOUT making <main> a
        // scroll box — a scroll box that never scrolls breaks every
        // position:sticky inside it (menu categories, Orders rail, bill bar).
        flex: 1, minWidth: 0, padding: narrow ? 14 : 24, overflowX: "clip", minHeight: "100vh",
        background: BG_MAIN,
        backgroundImage: "var(--glow-main)",
        backgroundAttachment: "fixed",
      }}>
        <Suspense fallback={<PageFallback />}>
          <>
            {page === "dashboard"  && <DashboardPage data={dashboardData} onNavigate={setPage} />}
            {page === "orders"     && <OrdersPage />}
            {page === "tables"     && <TablesPage onNavigate={setPage} />}
            {page === "menu"       && <MenuAdminPage />}
            {page === "employees"  && <EmployeesPage />}
            {page === "inventory"  && <InventoryPage />}
            {page === "users"      && <UsersPage />}
            {page === "notifications" && <NotificationsPage />}
            {page === "coupons"    && <CouponsPage />}
            {page === "invoices"   && <InvoicesPage />}
            {page === "analytics"  && <AnalyticsPage onNavigate={setPage} />}
            {page === "profile"    && <ProfilePage />}
            {page === "help"       && <HelpPage />}
          </>
        </Suspense>
      </main>
      </div>
    </div>
  );
}
