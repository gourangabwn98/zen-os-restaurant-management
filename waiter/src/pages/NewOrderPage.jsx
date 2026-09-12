import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { getMenu, getMenuCategories } from "../services/menuService.js";
import { getAllTables } from "../services/tableService.js";
import { placeOrder, newIdempotencyKey } from "../services/orderService.js";
import { Loader, EmptyState } from "../components/StateViews.jsx";
import GlassCard from "../components/ui/GlassCard.jsx";
import PrimaryButton from "../components/ui/PrimaryButton.jsx";
import Chip from "../components/ui/Chip.jsx";
import QtyStepper, { AddButton } from "../components/ui/QtyStepper.jsx";
import { ACCENT, ACCENT_SOFT, ACCENT_GRADIENT, TEXT_MUTED, TEXT_FAINT, GLASS_BG, GLASS_BORDER, NAV_HEIGHT } from "../theme.js";

export default function NewOrderPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const preTable = params.get("table");

  const [orderType, setOrderType] = useState(preTable ? "DINE_IN" : "TAKEAWAY");
  const [tableNo, setTableNo]     = useState(preTable || "");
  const [tables, setTables]       = useState([]);

  const [items, setItems]         = useState(null);
  const [categories, setCategories] = useState([]);
  const [search, setSearch]       = useState("");
  const [category, setCategory]   = useState("");

  const [cart, setCart]           = useState([]); // [{item, qty, notes}]
  const [customerName, setCustomerName] = useState("");
  const [placing, setPlacing]     = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [idemKey]                 = useState(newIdempotencyKey);

  useEffect(() => {
    getAllTables().then(({ data }) => setTables((data.tables || []).filter((t) => t.status !== "Inactive"))).catch(() => {});
    getMenuCategories().then(({ data }) => setCategories(data || [])).catch(() => {});
  }, []);

  const loadMenu = useCallback(() => {
    getMenu({ category: category || undefined, search: search || undefined })
      .then(({ data }) => setItems(Array.isArray(data) ? data : []))
      .catch(() => setItems([]));
  }, [category, search]);

  useEffect(() => {
    const id = setTimeout(loadMenu, 250);
    return () => clearTimeout(id);
  }, [loadMenu]);

  const getQty = (id) => cart.find((c) => c.item._id === id)?.qty || 0;

  const adjustQty = (item, delta) => {
    setCart((prev) => {
      const ex = prev.find((c) => c.item._id === item._id);
      if (!ex) return delta > 0 ? [...prev, { item, qty: 1, notes: "" }] : prev;
      const nextQty = ex.qty + delta;
      if (nextQty <= 0) return prev.filter((c) => c.item._id !== item._id);
      return prev.map((c) => (c.item._id === item._id ? { ...c, qty: nextQty } : c));
    });
  };

  const setNotes = (id, notes) => setCart((prev) => prev.map((c) => (c.item._id === id ? { ...c, notes } : c)));

  const itemCount = cart.reduce((s, c) => s + c.qty, 0);
  const subtotal  = cart.reduce((s, c) => s + c.item.price * c.qty, 0);

  const grouped = useMemo(() => {
    if (!items) return [];
    const map = new Map();
    for (const it of items) {
      if (!map.has(it.category)) map.set(it.category, []);
      map.get(it.category).push(it);
    }
    return [...map.entries()];
  }, [items]);

  const canPlace = itemCount > 0 && (orderType !== "DINE_IN" || tableNo);

  const handlePlace = async () => {
    if (!canPlace || placing) return;
    setPlacing(true);
    try {
      const body = {
        items: cart.map((c) => ({ menuItemId: c.item._id, qty: c.qty, notes: c.notes })),
        orderType,
        tableNo: orderType === "DINE_IN" ? Number(tableNo) : undefined,
        customerName: customerName.trim(),
        notes: "",
        idempotencyKey: idemKey,
      };
      const { data: order } = await placeOrder(body);
      toast.success(`Order ${order.orderId} created · KOT sent`);
      nav(`/order/${order._id}`, { replace: true });
    } catch (err) {
      toast.error(err.response?.data?.message || "Couldn't place order");
    } finally { setPlacing(false); }
  };

  if (reviewing) {
    return (
      <div style={{ paddingBottom: NAV_HEIGHT + 120 }}>
        <div style={{ padding: "18px 16px 4px", display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => setReviewing(false)} aria-label="Back" style={backBtn}>←</button>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#fff" }}>Review Order</div>
        </div>

        <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          {cart.map((c) => (
            <GlassCard key={c.item._id} style={{ padding: "12px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, color: "#fff" }}>{c.item.name} × {c.qty}</div>
                <div style={{ fontWeight: 800, fontSize: 13.5, color: ACCENT }}>₹{c.item.price * c.qty}</div>
              </div>
              <input
                value={c.notes} onChange={(e) => setNotes(c.item._id, e.target.value)}
                placeholder="Add note (e.g. less spicy)…"
                style={{
                  marginTop: 8, width: "100%", padding: "9px 11px", fontSize: 12.5, borderRadius: 10,
                  border: `1px solid ${GLASS_BORDER}`, background: "rgba(255,255,255,0.05)", color: "#fff",
                  boxSizing: "border-box", fontFamily: "inherit",
                }}
              />
            </GlassCard>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 4px 0", fontWeight: 800, fontSize: 16, color: "#fff" }}>
            <span>Total</span><span>₹{subtotal}</span>
          </div>
        </div>

        <div style={{ padding: "4px 16px" }}>
          <label style={{ fontSize: 11.5, fontWeight: 700, color: TEXT_FAINT, display: "block", marginBottom: 6 }}>Customer name (optional)</label>
          <input
            value={customerName} onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Walk-in guest"
            style={{
              width: "100%", padding: "12px 14px", borderRadius: 12, border: `1px solid ${GLASS_BORDER}`,
              fontSize: 14, boxSizing: "border-box", background: GLASS_BG, color: "#fff",
            }}
          />
          <div style={{ fontSize: 11.5, color: TEXT_FAINT, marginTop: 10 }}>
            {orderType === "DINE_IN" ? `Dine-in · Table ${tableNo}` : "Takeaway"} · this order is confirmed immediately and a KOT is sent to the kitchen.
          </div>
        </div>

        <div className="floating-bar" style={{
          position: "fixed", left: 14, right: 14, bottom: NAV_HEIGHT + 4, padding: "12px 14px", zIndex: 30,
          background: "rgba(12,10,20,0.85)", backdropFilter: "blur(20px)", border: `1px solid ${GLASS_BORDER}`,
          borderRadius: 18, boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
        }}>
          <PrimaryButton onClick={handlePlace} disabled={!canPlace || placing} style={{ width: "100%" }}>
            {placing ? "Placing…" : `Place Order · ₹${subtotal}`}
          </PrimaryButton>
        </div>
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: NAV_HEIGHT + (itemCount > 0 ? 90 : 16) }}>
      <div style={{ padding: "18px 16px 4px", display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={() => nav(-1)} aria-label="Back" style={backBtn}>←</button>
        <div style={{ fontSize: 18, fontWeight: 800, color: "#fff" }}>New Order</div>
      </div>

      {/* Order type + table */}
      <div style={{ padding: "12px 16px" }}>
        <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
          {["DINE_IN", "TAKEAWAY"].map((t) => (
            <button key={t} onClick={() => setOrderType(t)} style={{
              flex: 1, padding: "12px", borderRadius: 12, cursor: "pointer",
              border: `1.5px solid ${orderType === t ? "rgba(59,130,246,0.5)" : GLASS_BORDER}`,
              background: orderType === t ? ACCENT_SOFT : GLASS_BG,
              color: orderType === t ? ACCENT : TEXT_MUTED, fontWeight: 700, fontSize: 12.5,
            }}>
              {t === "DINE_IN" ? "🍽️ Dine-in" : "🛍️ Takeaway"}
            </button>
          ))}
        </div>

        {orderType === "DINE_IN" && (
          <select value={tableNo} onChange={(e) => setTableNo(e.target.value)} style={{
            width: "100%", padding: "12px 14px", borderRadius: 12, border: `1px solid ${GLASS_BORDER}`,
            fontSize: 14, background: GLASS_BG, color: "#fff",
          }}>
            <option value="" style={{ color: "#111" }}>Select a table…</option>
            {tables.map((t) => (
              <option key={t.tableNo} value={t.tableNo} style={{ color: "#111" }}>
                Table {t.tableNo} ({t.seats} seats){t.occupancyStatus === "OCCUPIED" ? " — occupied, adding to it" : ""}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Search */}
      <div style={{ padding: "6px 16px" }}>
        <input
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search menu…"
          style={{
            width: "100%", padding: "11px 15px", borderRadius: 14, border: `1px solid ${GLASS_BORDER}`,
            fontSize: 14, boxSizing: "border-box", background: GLASS_BG, color: "#fff",
          }}
        />
      </div>

      {categories.length > 0 && (
        <div className="hide-scrollbar" style={{ display: "flex", gap: 8, overflowX: "auto", padding: "10px 16px" }}>
          <Chip active={!category} onClick={() => setCategory("")}>All</Chip>
          {categories.map((c) => (
            <Chip key={c.category} active={category === c.category} onClick={() => setCategory(c.category)}>{c.category}</Chip>
          ))}
        </div>
      )}

      <div style={{ padding: "4px 16px 0" }}>
        {items === null && <Loader label="Loading menu…" />}
        {items !== null && grouped.length === 0 && <EmptyState icon="🔎" title="No items found" />}
        {grouped.map(([cat, catItems]) => (
          <div key={cat} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#fff", letterSpacing: 0.3, padding: "12px 2px 6px" }}>{cat}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {catItems.map((it) => {
                const qty = getQty(it._id);
                const outOfStock = it.stockTracked && !it.stockAvailable;
                return (
                  <GlassCard key={it._id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", opacity: outOfStock ? 0.5 : 1 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5, color: "#fff" }}>{it.name}</div>
                      <div style={{ fontSize: 12, color: TEXT_FAINT, marginTop: 2 }}>₹{it.price}{outOfStock ? " · Out of stock" : ""}</div>
                    </div>
                    {!outOfStock && (
                      qty > 0
                        ? <QtyStepper qty={qty} size="sm" onDec={() => adjustQty(it, -1)} onInc={() => adjustQty(it, 1)} />
                        : <AddButton size="sm" onClick={() => adjustQty(it, 1)} />
                    )}
                  </GlassCard>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {itemCount > 0 && (
        <button onClick={() => setReviewing(true)} className="floating-bar" style={{
          position: "fixed", left: 16, right: 16, bottom: NAV_HEIGHT + 14, zIndex: 30,
          background: ACCENT_GRADIENT, color: "#fff", border: "none", borderRadius: 18, padding: "15px 20px",
          display: "flex", alignItems: "center", justifyContent: "space-between", fontWeight: 800, fontSize: 14,
          cursor: "pointer", boxShadow: "0 12px 28px rgba(59,130,246,0.45)",
        }}>
          <span>{itemCount} item{itemCount > 1 ? "s" : ""} · ₹{subtotal}</span>
          <span>Review →</span>
        </button>
      )}
    </div>
  );
}

const backBtn = {
  width: 36, height: 36, borderRadius: "50%", border: `1px solid ${GLASS_BORDER}`,
  background: GLASS_BG, fontSize: 17, cursor: "pointer", color: "#fff",
};
