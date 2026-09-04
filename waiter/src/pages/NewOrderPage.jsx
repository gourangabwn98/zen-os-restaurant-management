import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { getMenu, getMenuCategories } from "../services/menuService.js";
import { getAllTables } from "../services/tableService.js";
import { placeOrder, newIdempotencyKey } from "../services/orderService.js";
import { Loader, EmptyState } from "../components/StateViews.jsx";
import { BLUE, BLUE_LIGHT, TEXT_MUTED, TEXT_FAINT, BORDER, NAV_HEIGHT } from "../theme.js";

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
        <div style={{ padding: "16px 16px 4px", display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => setReviewing(false)} style={backBtn}>←</button>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Review Order</div>
        </div>

        <div style={{ padding: "8px 16px" }}>
          {cart.map((c) => (
            <div key={c.item._id} style={{ padding: "10px 0", borderBottom: `1px solid ${BORDER}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{c.item.name} × {c.qty}</div>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>₹{c.item.price * c.qty}</div>
              </div>
              <input
                value={c.notes} onChange={(e) => setNotes(c.item._id, e.target.value)}
                placeholder="Add note (e.g. less spicy)…"
                style={{ marginTop: 6, width: "100%", padding: "8px 10px", fontSize: 12.5, borderRadius: 8, border: `1px solid ${BORDER}`, boxSizing: "border-box" }}
              />
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "14px 0", fontWeight: 800, fontSize: 15 }}>
            <span>Total</span><span>₹{subtotal}</span>
          </div>
        </div>

        <div style={{ padding: "4px 16px" }}>
          <label style={{ fontSize: 11.5, fontWeight: 700, color: TEXT_FAINT, display: "block", marginBottom: 6 }}>Customer name (optional)</label>
          <input
            value={customerName} onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Walk-in guest" style={{ width: "100%", padding: "11px 13px", borderRadius: 10, border: `1px solid ${BORDER}`, fontSize: 14, boxSizing: "border-box" }}
          />
          <div style={{ fontSize: 11.5, color: TEXT_FAINT, marginTop: 10 }}>
            {orderType === "DINE_IN" ? `Dine-in · Table ${tableNo}` : "Takeaway"} · this order is confirmed immediately and a KOT is sent to the kitchen.
          </div>
        </div>

        <div style={{ position: "fixed", left: 0, right: 0, bottom: NAV_HEIGHT, padding: "12px 16px", background: "#fff", borderTop: `1px solid ${BORDER}` }}>
          <button onClick={handlePlace} disabled={!canPlace || placing} style={{
            width: "100%", padding: 15, borderRadius: 14, border: "none", background: BLUE,
            color: "#fff", fontWeight: 800, fontSize: 14.5,
            opacity: !canPlace || placing ? 0.5 : 1, cursor: !canPlace || placing ? "not-allowed" : "pointer",
          }}>
            {placing ? "Placing…" : `Place Order · ₹${subtotal}`}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: NAV_HEIGHT + (itemCount > 0 ? 90 : 16) }}>
      <div style={{ padding: "16px 16px 4px", display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={() => nav(-1)} style={backBtn}>←</button>
        <div style={{ fontSize: 18, fontWeight: 800 }}>New Order</div>
      </div>

      {/* Order type + table */}
      <div style={{ padding: "10px 16px" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          {["DINE_IN", "TAKEAWAY"].map((t) => (
            <button key={t} onClick={() => setOrderType(t)} style={{
              flex: 1, padding: "10px", borderRadius: 10, cursor: "pointer",
              border: `1.5px solid ${orderType === t ? BLUE : BORDER}`,
              background: orderType === t ? BLUE_LIGHT : "#fff",
              color: orderType === t ? BLUE : TEXT_MUTED, fontWeight: 700, fontSize: 12.5,
            }}>
              {t === "DINE_IN" ? "🍽️ Dine-in" : "🛍️ Takeaway"}
            </button>
          ))}
        </div>

        {orderType === "DINE_IN" && (
          <select value={tableNo} onChange={(e) => setTableNo(e.target.value)} style={{
            width: "100%", padding: "11px 13px", borderRadius: 10, border: `1px solid ${BORDER}`, fontSize: 14,
          }}>
            <option value="">Select a table…</option>
            {tables.map((t) => (
              <option key={t.tableNo} value={t.tableNo}>
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
          style={{ width: "100%", padding: "10px 14px", borderRadius: 12, border: `1px solid ${BORDER}`, fontSize: 14, boxSizing: "border-box" }}
        />
      </div>

      {categories.length > 0 && (
        <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "8px 16px" }}>
          <Chip active={!category} onClick={() => setCategory("")}>All</Chip>
          {categories.map((c) => (
            <Chip key={c.category} active={category === c.category} onClick={() => setCategory(c.category)}>{c.category}</Chip>
          ))}
        </div>
      )}

      <div style={{ padding: "0 16px" }}>
        {items === null && <Loader label="Loading menu…" />}
        {items !== null && grouped.length === 0 && <EmptyState icon="🔎" title="No items found" />}
        {grouped.map(([cat, catItems]) => (
          <div key={cat} style={{ marginBottom: 6 }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: TEXT_MUTED, textTransform: "uppercase", padding: "12px 0 4px" }}>{cat}</div>
            {catItems.map((it) => {
              const qty = getQty(it._id);
              const outOfStock = it.stockTracked && !it.stockAvailable;
              return (
                <div key={it._id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${BORDER}`, opacity: outOfStock ? 0.5 : 1 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{it.name}</div>
                    <div style={{ fontSize: 12, color: TEXT_FAINT }}>₹{it.price}{outOfStock ? " · Out of stock" : ""}</div>
                  </div>
                  {!outOfStock && (
                    qty > 0 ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 12, border: `1.5px solid ${BLUE}`, borderRadius: 8, padding: "5px 12px" }}>
                        <button onClick={() => adjustQty(it, -1)} style={stepBtn}>−</button>
                        <span style={{ fontWeight: 700, fontSize: 13, minWidth: 14, textAlign: "center" }}>{qty}</span>
                        <button onClick={() => adjustQty(it, 1)} style={stepBtn}>+</button>
                      </div>
                    ) : (
                      <button onClick={() => adjustQty(it, 1)} style={{
                        padding: "8px 16px", borderRadius: 8, border: `1.5px solid ${BLUE}`, background: "#fff",
                        color: BLUE, fontWeight: 800, fontSize: 12, cursor: "pointer",
                      }}>
                        ADD
                      </button>
                    )
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {itemCount > 0 && (
        <button onClick={() => setReviewing(true)} style={{
          position: "fixed", left: 16, right: 16, bottom: NAV_HEIGHT + 12, zIndex: 30,
          background: BLUE, color: "#fff", border: "none", borderRadius: 14, padding: "14px 18px",
          display: "flex", alignItems: "center", justifyContent: "space-between", fontWeight: 800, fontSize: 14,
          cursor: "pointer", boxShadow: "0 8px 20px rgba(37,99,235,0.35)",
        }}>
          <span>{itemCount} item{itemCount > 1 ? "s" : ""} · ₹{subtotal}</span>
          <span>Review →</span>
        </button>
      )}
    </div>
  );
}

const Chip = ({ active, onClick, children }) => (
  <button onClick={onClick} style={{
    flexShrink: 0, padding: "7px 15px", borderRadius: 20, fontSize: 12.5, fontWeight: 700,
    border: `1.5px solid ${active ? BLUE : BORDER}`,
    background: active ? BLUE_LIGHT : "#fff", color: active ? BLUE : TEXT_MUTED, cursor: "pointer",
  }}>
    {children}
  </button>
);

const stepBtn = { border: "none", background: "none", color: BLUE, fontWeight: 800, fontSize: 15, cursor: "pointer", width: 16 };
const backBtn = { border: "none", background: "none", fontSize: 20, cursor: "pointer", color: TEXT_MUTED };
