// src/pages/admin/InventoryPage.jsx
// Zen OS "Inventory" shell — PageHeader + .zc-subnav tab strip (matches
// design-reference/zen-os-design-reference.html → Inventory `invNav`).
// The eight tabs and every inventory API call are unchanged.
import { useState } from "react";
import PageHeader from "./shared/PageHeader.jsx";
import InventoryOverview from "./inventory/InventoryOverview.jsx";
import StockItemsTab from "./inventory/StockItemsTab.jsx";
import PurchasesTab from "./inventory/PurchasesTab.jsx";
import MovementsTab from "./inventory/MovementsTab.jsx";
import LowStockTab from "./inventory/LowStockTab.jsx";
import WastageTab from "./inventory/WastageTab.jsx";
import RecipesTab from "./inventory/RecipesTab.jsx";
import SuppliersTab from "./inventory/SuppliersTab.jsx";

// page-scoped layout helpers (tokens only — Light / Dark / Auto safe).
// Classes are prefixed `invp-` so they never collide with any other screen's
// page-scoped styles.
if (typeof document !== "undefined" && !document.getElementById("inventory-page-styles")) {
  const s = document.createElement("style");
  s.id = "inventory-page-styles";
  s.textContent = `
    .invp-two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media (max-width: 900px) { .invp-two-col { grid-template-columns: 1fr; } }
    .invp-queue { display: grid; gap: 12px; }
    .invp-queue-row {
      border: 1px solid var(--edge); border-radius: var(--r-card); background: var(--grad-card);
      box-shadow: var(--shadow-card); padding: 15px 18px;
      display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
    }
    .invp-queue-row.crit { border-color: var(--stop-line); }
    .invp-queue-ic {
      width: 40px; height: 40px; border-radius: 12px; flex: none; display: grid; place-items: center;
      font-size: 17px; background: var(--wait-fill); border: 1px solid var(--wait-line); color: var(--wait-ink);
    }
    .invp-queue-row.crit .invp-queue-ic { background: var(--stop-fill); border-color: var(--stop-line); color: var(--stop-ink); }
    .zc-ledger tbody tr.invp-hl td { background: linear-gradient(168deg, var(--stop-fill), transparent); border-color: var(--stop-line); }
    .invp-mv-ic {
      width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center;
      font-size: 13px; font-weight: 700; flex: none;
    }
    .invp-mv-ic.in  { color: var(--ready-ink); background: var(--ready-fill); border: 1px solid var(--ready-line); }
    .invp-mv-ic.out { color: var(--stop-ink);  background: var(--stop-fill);  border: 1px solid var(--stop-line); }
    .invp-pline { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr auto; gap: 6px; align-items: center; }
    .invp-iline { display: grid; grid-template-columns: 2fr 1fr auto; gap: 6px; align-items: center; }
    @media (max-width: 620px) {
      .invp-pline { grid-template-columns: 1fr 1fr; }
      .invp-pline > :nth-child(1) { grid-column: 1 / -1; }
      .invp-pline > button { grid-column: 1 / -1; justify-self: end; }
      .invp-iline { grid-template-columns: 1fr auto; }
    }
  `;
  document.head.appendChild(s);
}

const SECTIONS = [
  { id: "overview",  label: "Overview",   icon: "📊" },
  { id: "items",     label: "Stock items", icon: "📦" },
  { id: "purchases", label: "Purchases",  icon: "🧾" },
  { id: "movements", label: "Movements",  icon: "📒" },
  { id: "lowstock",  label: "Low stock",  icon: "⚠️" },
  { id: "wastage",   label: "Wastage",    icon: "🗑️" },
  { id: "recipes",   label: "Recipes",    icon: "🍳" },
  { id: "suppliers", label: "Suppliers",  icon: "🚚" },
];

export default function InventoryPage() {
  const [section, setSection] = useState("overview");

  return (
    <div>
      <PageHeader
        title="Inventory"
        sub="Stock items, purchases, recipes, wastage and the stock-movement ledger for this restaurant"
      />

      <div className="zc-subnav" role="tablist" aria-label="Inventory sections">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={section === s.id}
            className={section === s.id ? "on" : ""}
            onClick={() => setSection(s.id)}
          >
            <span aria-hidden="true">{s.icon}</span> {s.label}
          </button>
        ))}
      </div>

      {section === "overview"  && <InventoryOverview onNavigate={setSection} />}
      {section === "items"     && <StockItemsTab />}
      {section === "purchases" && <PurchasesTab />}
      {section === "movements" && <MovementsTab />}
      {section === "lowstock"  && <LowStockTab onNavigate={setSection} />}
      {section === "wastage"   && <WastageTab />}
      {section === "recipes"   && <RecipesTab />}
      {section === "suppliers" && <SuppliersTab />}
    </div>
  );
}
