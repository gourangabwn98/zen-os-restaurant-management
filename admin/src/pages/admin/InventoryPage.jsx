// src/pages/admin/InventoryPage.jsx
import { useState } from "react";
import { PINK, T1, T2, T3, BORDER, CARD } from "./inventory/invUI.jsx";
import InventoryOverview from "./inventory/InventoryOverview.jsx";
import StockItemsTab from "./inventory/StockItemsTab.jsx";
import PurchasesTab from "./inventory/PurchasesTab.jsx";
import MovementsTab from "./inventory/MovementsTab.jsx";
import LowStockTab from "./inventory/LowStockTab.jsx";
import WastageTab from "./inventory/WastageTab.jsx";
import RecipesTab from "./inventory/RecipesTab.jsx";
import SuppliersTab from "./inventory/SuppliersTab.jsx";

const SECTIONS = [
  { id: "overview",   label: "Overview",        icon: "📊" },
  { id: "items",      label: "Stock Items",     icon: "📦" },
  { id: "purchases",  label: "Purchases",       icon: "🧾" },
  { id: "movements",  label: "Stock Movements", icon: "📒" },
  { id: "lowstock",   label: "Low Stock",       icon: "⚠️" },
  { id: "wastage",    label: "Wastage",         icon: "🗑️" },
  { id: "recipes",    label: "Recipes",         icon: "🍳" },
  { id: "suppliers",  label: "Suppliers",       icon: "🚚" },
];

export default function InventoryPage() {
  const [section, setSection] = useState("overview");

  return (
    <div style={{ padding: 28, fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: T1, margin: 0 }}>Inventory</h1>
        <p style={{ color: T2, marginTop: 5, fontSize: 13 }}>
          Stock items, purchases, recipes, and stock movements for this restaurant
        </p>
      </div>

      {/* ── Sub-navigation ── */}
      <div style={{
        display: "flex", gap: 6, marginBottom: 22, flexWrap: "wrap",
        background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 6,
      }}>
        {SECTIONS.map((s) => {
          const active = section === s.id;
          return (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              style={{
                padding: "9px 16px", borderRadius: 8, border: "none", cursor: "pointer",
                fontSize: 13, fontWeight: active ? 600 : 500,
                background: active ? `linear-gradient(135deg, ${PINK}, #5b21b6)` : "transparent",
                color: active ? "#fff" : T2,
                display: "flex", alignItems: "center", gap: 6,
                transition: "all .15s",
              }}
            >
              <span>{s.icon}</span> {s.label}
            </button>
          );
        })}
      </div>

      {section === "overview"  && <InventoryOverview onNavigate={setSection} />}
      {section === "items"     && <StockItemsTab />}
      {section === "purchases" && <PurchasesTab />}
      {section === "movements" && <MovementsTab />}
      {section === "lowstock"  && <LowStockTab />}
      {section === "wastage"   && <WastageTab />}
      {section === "recipes"   && <RecipesTab />}
      {section === "suppliers" && <SuppliersTab />}
    </div>
  );
}
