// src/pages/admin/DeliveryPage.jsx — Admin → Delivery (home delivery).
// Board (jobs + exceptions), Partners, Live map, Cash (COD), Reports, Settings.
// Riders are registered in Employees (role "Delivery partner"). Live updates:
// the delivery-admin socket room (admin + manager) — every delivery:* event
// bumps `rev`, and each tab re-reads what it shows (debounced).
import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { getSocket } from "../../services/socketService.js";
import { useAuth } from "../../hooks/useAuth.js";
import { isManager } from "../../utils/access.js";
import { PageHeader, Loader } from "./shared";
import { t, N_ } from "../../i18n/core.js";

const BoardTab = lazy(() => import("./delivery/BoardTab.jsx"));
const PartnersTab = lazy(() => import("./delivery/PartnersTab.jsx"));
const LiveTab = lazy(() => import("./delivery/LiveTab.jsx"));
const CashTab = lazy(() => import("./delivery/CashTab.jsx"));
const ReportsTab = lazy(() => import("./delivery/ReportsTab.jsx"));
const SettingsTab = lazy(() => import("./delivery/SettingsTab.jsx"));

const TABS = [
  { key: "board", label: N_("Board") },
  { key: "partners", label: N_("Partners") },
  { key: "live", label: N_("Live map") },
  { key: "cash", label: N_("Cash (COD)") },
  { key: "reports", label: N_("Reports") },
  { key: "settings", label: N_("Settings"), adminOnly: true },
];

const EVENTS = [
  "delivery:job_created", "delivery:request_broadcast", "delivery:status_updated", "delivery:escalated",
  "delivery:rejected", "delivery:partner_updated", "delivery:completed", "delivery:cod_collected", "delivery:cod_updated",
];

export default function DeliveryPage({ onNavigate }) {
  const manager = isManager(useAuth().user);
  const tabs = TABS.filter((x) => !(x.adminOnly && manager));
  const [tab, setTab] = useState(() => { try { return sessionStorage.getItem("deliveryTab") || "board"; } catch { return "board"; } });
  const active = tabs.some((x) => x.key === tab) ? tab : "board";
  useEffect(() => { try { sessionStorage.setItem("deliveryTab", active); } catch { /* storage off */ } }, [active]);

  // Realtime: structural events refresh the open tab; GPS only moves the map.
  const [rev, setRev] = useState(0);
  const [live, setLive] = useState({}); // partnerId → latest location (from delivery:location_updated)
  const timer = useRef(null);
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const bump = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setRev((r) => r + 1), 600); };
    const onLoc = (p) => p?.partnerId && setLive((m) => ({ ...m, [p.partnerId]: p.location }));
    EVENTS.forEach((e) => socket.on(e, bump));
    socket.on("delivery:location_updated", onLoc);
    socket.on("connect", bump);
    return () => {
      EVENTS.forEach((e) => socket.off(e, bump));
      socket.off("delivery:location_updated", onLoc);
      socket.off("connect", bump);
      clearTimeout(timer.current);
    };
  }, []);

  return (
    <div>
      <PageHeader
        title={t("Delivery")}
        sub={t("Home-delivery riders, live deliveries, cash on delivery and reports")}
        right={<button type="button" className="zc-btn" onClick={() => onNavigate?.("employees")}>+ {t("Add delivery partner")}</button>}
      />
      <div className="zc-seg" role="tablist" style={{ marginBottom: 16, flexWrap: "wrap" }}>
        {tabs.map((x) => (
          <button key={x.key} type="button" role="tab" aria-selected={active === x.key} className={active === x.key ? "on" : ""} onClick={() => setTab(x.key)}>
            {t(x.label)}
          </button>
        ))}
      </div>
      <Suspense fallback={<div className="zc-card" style={{ padding: 20 }}><Loader rows={5} /></div>}>
        {active === "board" && <BoardTab rev={rev} />}
        {active === "partners" && <PartnersTab rev={rev} onNavigate={onNavigate} />}
        {active === "live" && <LiveTab rev={rev} live={live} />}
        {active === "cash" && <CashTab rev={rev} />}
        {active === "reports" && <ReportsTab />}
        {active === "settings" && !manager && <SettingsTab />}
      </Suspense>
    </div>
  );
}
