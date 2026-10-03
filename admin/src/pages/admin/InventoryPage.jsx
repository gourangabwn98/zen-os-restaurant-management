// src/pages/admin/InventoryPage.jsx — Admin → Operations → Inventory
// ─────────────────────────────────────────────────────────────────────────────
// Layout: PageHeader → add bar (one tile per way stock gets recorded) →
// .zc-subnav tabs → tab body. Every figure comes from the existing inventory
// API (/admin/inventory/*) — stock levels are the server's `stockLevel`
// (classifyStockLevel: 0 → Out, ≤ criticalLevel → Critical, ≤ reorderLevel →
// Low), stock only changes through purchase / wastage / adjust / count /
// order deduction, each of which writes a StockLedger row server-side.
//
// Stock items + suppliers are loaded once here and shared with every tab and
// entry modal; any save bumps `version`, which every tab re-loads on.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback, useMemo } from "react";
import PageHeader from "./shared/PageHeader.jsx";
import { t, N_, fmtNum } from "../../i18n/core.js";
import { getInventoryItems, getSuppliers } from "../../services/inventoryService.js";
import InventoryOverview from "./inventory/InventoryOverview.jsx";
import StockItemsTab from "./inventory/StockItemsTab.jsx";
import PurchasesTab from "./inventory/PurchasesTab.jsx";
import MovementsTab from "./inventory/MovementsTab.jsx";
import WastageTab from "./inventory/WastageTab.jsx";
import RecipesTab from "./inventory/RecipesTab.jsx";
import SuppliersTab from "./inventory/SuppliersTab.jsx";
import ItemDrawer from "./inventory/ItemDrawer.jsx";
import ImportPurchaseModal from "./inventory/ImportPurchaseModal.jsx";
import { PurchaseModal, WastageModal, CountModal, AdjustModal, ItemFormModal } from "./inventory/EntryModals.jsx";
import { Icon } from "./inventory/invUI.jsx";
import { needsReorder } from "./inventory/invKit.js";
import "./inventory/inventory.css";

const SECTIONS = [
  { id: "overview",  label: N_("Overview") },
  { id: "items",     label: N_("Stock") },
  { id: "recipes",   label: N_("Recipes & food cost") },
  { id: "purchases", label: N_("Purchases") },
  { id: "wastage",   label: N_("Wastage") },
  { id: "movements", label: N_("History") },
  { id: "suppliers", label: N_("Suppliers") },
];

const ADD_TILES = [
  { kind: "purchase", icon: "cart", title: N_("Record purchase"), sub: N_("stock in from a bill") },
  { kind: "wastage",  icon: "bin",  title: N_("Log wastage"),     sub: N_("spoiled, expired, damaged") },
  { kind: "count",    icon: "box",  title: N_("Count stock"),     sub: N_("what's on the shelf now") },
  { kind: "import",   icon: "cam",  title: N_("Import a bill"),   sub: N_("read a PDF or photo") },
  { kind: "item",     icon: "plus", title: N_("Add stock item"),  sub: N_("name and unit to start") },
];

export default function InventoryPage({ onNavigate }) {
  const [section, setSection] = useState("overview");
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [suppliers, setSuppliers] = useState([]);
  const [sharedError, setSharedError] = useState(false);
  const [version, setVersion] = useState(0);
  const [modal, setModal] = useState(null);       // { kind, item?, prefill? }
  const [drawerId, setDrawerId] = useState(null);
  const [historyItem, setHistoryItem] = useState("");

  const loadShared = useCallback(async () => {
    try {
      const [iRes, sRes] = await Promise.all([getInventoryItems(), getSuppliers()]);
      setItems(iRes.data?.items || []);
      setSuppliers(sRes.data?.suppliers || []);
      setSharedError(false);
    } catch { setSharedError(true); }
    finally { setLoaded(true); }
  }, []);
  useEffect(() => { loadShared(); }, [loadShared]);

  const refresh = useCallback(() => { loadShared(); setVersion((v) => v + 1); }, [loadShared]);

  // kind: purchase | wastage | count | adjust | item | edit | import
  const open = useCallback((kind, item = null, extra = {}) => setModal({ kind, item, ...extra }), []);
  const close = useCallback(() => setModal(null), []);
  const saved = useCallback((opts) => { if (!opts?.keepOpen) setModal(null); refresh(); }, [refresh]);

  const reorderCount = useMemo(
    () => items.filter((i) => i.status === "Active" && needsReorder(i)).length,
    [items],
  );

  const goHistory = (itemId) => { setHistoryItem(itemId || ""); setDrawerId(null); setSection("movements"); };

  const ctx = {
    items, itemsLoading: !loaded, sharedError, suppliers, version,
    open, openItem: setDrawerId, setSection, goHistory, refresh, onNavigate,
  };

  const m = modal;
  return (
    <div className="ivt">
      <PageHeader
        title={t("Inventory")}
        sub={t("Stock, purchases, wastage and recipes. Every change is written to the stock history.")}
      />

      <div className="ivt-addbar">
        {ADD_TILES.map((a) => (
          <button key={a.kind} type="button" className="ivt-add" onClick={() => open(a.kind)}>
            <span className="ic"><Icon id={a.icon} /></span>
            <span><b>{t(a.title)}</b><small>{t(a.sub)}</small></span>
          </button>
        ))}
      </div>

      <div className="zc-subnav" role="tablist" aria-label={t("Inventory sections")}>
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={section === s.id}
            className={section === s.id ? "on" : ""} onClick={() => { if (s.id === "movements") setHistoryItem(""); setSection(s.id); }}>
            {t(s.label)}
            {s.id === "items" && reorderCount > 0 && <span className="ivt-tabn" title={t("Needs reorder")}>{fmtNum(reorderCount)}</span>}
          </button>
        ))}
      </div>

      {section === "overview"  && <InventoryOverview {...ctx} />}
      {section === "items"     && <StockItemsTab {...ctx} />}
      {section === "recipes"   && <RecipesTab version={version} />}
      {section === "purchases" && <PurchasesTab {...ctx} />}
      {section === "wastage"   && <WastageTab {...ctx} />}
      {section === "movements" && <MovementsTab {...ctx} initialItem={historyItem} key={historyItem || "all"} />}
      {section === "suppliers" && <SuppliersTab {...ctx} />}

      {drawerId && (
        <ItemDrawer id={drawerId} version={version} onClose={() => setDrawerId(null)}
          onAction={(kind, it) => open(kind, it)} onFullHistory={goHistory} />
      )}

      {m?.kind === "purchase" && (
        <PurchaseModal items={ctx.items} suppliers={suppliers} prefill={m.prefill || (m.item ? [m.item._id] : [])}
          onClose={close} onSaved={saved} onImport={() => open("import")} />
      )}
      {m?.kind === "wastage" && <WastageModal items={ctx.items} prefillItem={m.item?._id || ""} onClose={close} onSaved={saved} />}
      {m?.kind === "count" && <CountModal items={ctx.items} only={m.item?._id || null} onClose={close} onSaved={saved} />}
      {m?.kind === "adjust" && m.item && <AdjustModal item={m.item} onClose={close} onSaved={saved} />}
      {(m?.kind === "item" || m?.kind === "edit") && (
        <ItemFormModal item={m.kind === "edit" ? m.item : null} items={ctx.items} suppliers={suppliers} onClose={close} onSaved={saved} />
      )}
      {m?.kind === "import" && <ImportPurchaseModal inventoryItems={ctx.items} onClose={close} onImported={refresh} />}
    </div>
  );
}
