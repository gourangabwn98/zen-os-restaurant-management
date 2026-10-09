import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { getMenu, getMenuCategories } from "../services/menuService.js";
import { getAllTables } from "../services/tableService.js";
import { placeOrder, newIdempotencyKey, getRestaurantProfile } from "../services/orderService.js";
import { getSocket } from "../services/socketService.js";
import { Loader, EmptyState } from "../components/StateViews.jsx";
import GlassCard from "../components/ui/GlassCard.jsx";
import PrimaryButton from "../components/ui/PrimaryButton.jsx";
import Chip from "../components/ui/Chip.jsx";
import VoiceOrder from "../components/VoiceOrder.jsx";
import QtyStepper, { AddButton } from "../components/ui/QtyStepper.jsx";
import { useAppState } from "../context/AppState.jsx";
import { ACCENT, ACCENT_SOFT, ACCENT_GRADIENT, TEXT_MUTED, TEXT_FAINT, GLASS_BG, GLASS_BORDER, NAV_HEIGHT } from "../theme.js";
import { t as tr, tn, localName } from "../i18n/index.jsx";
import NotShareableNote from "../components/NotShareableNote.jsx";
import AddonPicker, { AddonHint } from "../components/AddonPicker.jsx";
import { hasAddons, lineKey, unitPrice, addonNames } from "../utils/addons.js";
import { TABLE_AREA_LABEL, groupTablesByArea, tableLabel, isAcRoom } from "../utils/diningArea.js";

export default function NewOrderPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const preTable = params.get("table");
  // Opened from the Table Map: a picked table, or the "Take Away" tile.
  // Either way the type is decided — no Dine-in / Takeaway switch.
  const preTakeaway = params.get("type") === "takeaway";
  const locked = Boolean(preTable) || preTakeaway;
  const { auth, duty } = useAppState();
  // Only a waiter is duty-gated (mirrors the backend — see
  // attendanceService.assertOnDuty); wait for duty.session to resolve
  // (undefined = still loading) so this never flashes before we know.
  const dutyGated = auth.user?.role === "waiter" && duty.session !== undefined && !duty.onDuty;

  const [orderType, setOrderType] = useState(preTable ? "DINE_IN" : "TAKEAWAY"); // takeaway default when nothing picked
  const [tableNo, setTableNo]     = useState(preTable || "");
  // The table's area (Indoor / AC Room / Garden) is set by the admin on the
  // table; the server takes the order's area from the table.
  const [tables, setTables]       = useState([]);
  // The picked table's area, as the admin configured it (display only — the
  // server sets the order's area from the table itself).
  const pickedTable = tables.find((x) => String(x.tableNo) === String(tableNo));
  // "Indoor-AC 1" — never the internal tableNo (that may be 15).
  const pickedName = pickedTable ? tableLabel(pickedTable) : tr("Table {n}", { n: tableNo });

  // Whole menu (unfiltered), fetched ONCE — the list below and voice ordering
  // both read it. null = still loading. (It used to be fetched twice, and the
  // two identical GET /menu requests ran one after the other in Chrome.)
  const [fullMenu, setFullMenu]   = useState(null);
  const [categories, setCategories] = useState([]);
  const [search, setSearch]       = useState("");
  const [category, setCategory]   = useState("");

  const [cart, setCart]           = useState([]); // [{key, item, qty, notes, addonIds}] — KH-12: one line per item + add-ons
  const [picker, setPicker]       = useState(null); // KH-12: item whose add-ons are being asked about
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState(""); // optional — printed on the KOT and bill
  const [guests, setGuests]       = useState(""); // KH-11: Indoor-AC only
  const [acRate, setAcRate]       = useState(20); // ₹ per guest (profile) — preview; the server prices it
  const [placing, setPlacing]     = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [idemKey]                 = useState(newIdempotencyKey);

  const loadFullMenu = useCallback(() => {
    getMenu().then(({ data }) => setFullMenu(Array.isArray(data) ? data : [])).catch(() => setFullMenu((m) => m || []));
  }, []);

  useEffect(() => {
    // The table list is only shown when no table was picked on the map.
    getAllTables().then(({ data }) => setTables((data.tables || []).filter((t) => t.status !== "Inactive"))).catch(() => {});
    getMenuCategories().then(({ data }) => setCategories(data || [])).catch(() => {});
    getRestaurantProfile().then(({ data }) => { const r = (data?.data || data)?.acServiceChargePerGuest; if (r != null) setAcRate(Number(r)); }).catch(() => {});
    loadFullMenu();
  }, [locked, loadFullMenu]);

  // Menu changed on the server (item switched off, sold out, price) → reload,
  // as tapping a category used to.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    socket.on("menu:updated", loadFullMenu);
    return () => { socket.off("menu:updated", loadFullMenu); };
  }, [loadFullMenu]);

  // Category / search filter the menu already loaded — same result as the
  // server's GET /menu?category=&search= (categoryList = primary + extra +
  // smart categories, name contains the search, case-insensitive; order kept).
  const items = useMemo(() => {
    if (!fullMenu) return null;
    const q = search.trim().toLowerCase();
    return fullMenu.filter((it) =>
      (!category || (it.categoryList || [it.category]).includes(category))
      && (!q || String(it.name || "").toLowerCase().includes(q)));
  }, [fullMenu, category, search]);

  // Total of this item across its lines (with / without add-ons).
  const getQty = (id) => cart.filter((c) => c.item._id === id).reduce((s, c) => s + c.qty, 0);

  // KH-12: add one of (item + these add-ons) — same combination → same line.
  const addLine = (item, addonIds = [], qty = 1) => {
    const key = lineKey(item._id, addonIds);
    setCart((prev) => (prev.some((c) => c.key === key)
      ? prev.map((c) => (c.key === key ? { ...c, qty: Math.min(99, c.qty + qty) } : c))
      : [...prev, { key, item, qty, notes: "", addonIds: [...addonIds] }]));
  };
  const changeLine = (key, delta) => setCart((prev) => prev
    .map((c) => (c.key === key ? { ...c, qty: Math.min(99, c.qty + delta) } : c))
    .filter((c) => c.qty > 0));

  const adjustQty = (item, delta) => {
    if (delta > 0) {
      if (hasAddons(item)) setPicker(item); // ask: does the customer want an extra?
      else addLine(item, []);
      return;
    }
    // "−" on the menu card: take one off this item's most recently added line.
    const last = [...cart].reverse().find((c) => c.item._id === item._id);
    if (last) changeLine(last.key, -1);
  };

  // Voice order: add each confirmed line, merging with what's already in the cart.
  const addVoiceItems = (lines) => {
    setCart((prev) => {
      let next = prev;
      for (const { item, qty } of lines) {
        const key = lineKey(item._id, []); // voice lines: no add-ons
        const ex = next.find((c) => c.key === key);
        next = ex
          ? next.map((c) => (c.key === key ? { ...c, qty: Math.min(99, c.qty + qty) } : c))
          : [...next, { key, item, qty, notes: "", addonIds: [] }];
      }
      return next;
    });
    const n = lines.reduce((s, l) => s + l.qty, 0);
    toast.success(tn(n, "Added {n} item by voice", "Added {n} items by voice"));
  };
  const voiceMenu = useMemo(() => (fullMenu || []).filter((it) => !(it.stockTracked && !it.stockAvailable)), [fullMenu]);

  const setNotes = (key, notes) => setCart((prev) => prev.map((c) => (c.key === key ? { ...c, notes } : c)));

  const itemCount = cart.reduce((s, c) => s + c.qty, 0);
  const subtotal  = cart.reduce((s, c) => s + unitPrice(c.item, c.addonIds) * c.qty, 0); // preview; server re-prices

  const grouped = useMemo(() => {
    if (!items) return [];
    const map = new Map();
    for (const it of items) {
      if (!map.has(it.category)) map.set(it.category, []);
      map.get(it.category).push(it);
    }
    return [...map.entries()];
  }, [items]);

  // KH-11: Indoor-AC table → number of guests (required unless the table's
  // guests were already entered on its first order) × rate, in the subtotal.
  const acTable   = orderType === "DINE_IN" && isAcRoom(pickedTable);
  const guestsReq = acTable && pickedTable?.occupancyStatus !== "OCCUPIED";
  const guestsN   = /^\d+$/.test(guests) ? Number(guests) : 0;
  const guestsOk  = !acTable || (guests === "" ? !guestsReq : guestsN >= 1 && guestsN <= 100);
  const acCharge  = acTable && guestsN > 0 ? guestsN * acRate : 0;
  const grand     = subtotal + acCharge; // preview; server re-prices

  const canPlace = itemCount > 0 && (orderType !== "DINE_IN" || tableNo) && guestsOk;

  const handlePlace = async () => {
    if (!canPlace || placing) return;
    setPlacing(true);
    try {
      const body = {
        items: cart.map((c) => ({ menuItemId: c.item._id, qty: c.qty, notes: c.notes, ...(c.addonIds?.length && { addonIds: c.addonIds }) })),
        orderType,
        tableNo: orderType === "DINE_IN" ? Number(tableNo) : undefined,
        customerName: customerName.trim(),
        ...(customerPhone && { customerPhone }),
        ...(acTable && guestsN > 0 && { guests: guestsN }),
        notes: "",
        idempotencyKey: idemKey,
      };
      const { data: order } = await placeOrder(body);
      toast.success(order.status === "CONFIRMED"
        ? tr("Order {id} placed — it goes to the kitchen in a few minutes", { id: order.orderId })
        : tr("Order {id} placed — cooking now", { id: order.orderId }));
      nav(`/order/${order._id}`, { replace: true });
    } catch (err) {
      toast.error(err.response?.data?.message || tr("Couldn't place order"));
    } finally { setPlacing(false); }
  };

  if (dutyGated) {
    return (
      <div style={{ paddingBottom: NAV_HEIGHT + 16 }}>
        <div style={{ padding: "18px 16px 4px", display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => nav(-1)} aria-label={tr("Back")} style={backBtn}>←</button>
          <div style={{ fontSize: 21, fontWeight: 800, color: "#fff", letterSpacing: -0.4 }}>{tr("New order")}</div>
        </div>
        <EmptyState
          icon="🕔"
          title={tr("Start your duty to take orders")}
          sub={tr("You're currently off duty — clock in from the Tables page first.")}
          action={
            <PrimaryButton onClick={() => nav("/tables")}>← {tr("Back to Tables")}</PrimaryButton>
          }
        />
      </div>
    );
  }

  if (reviewing) {
    return (
      <div style={{ paddingBottom: NAV_HEIGHT + 120 }}>
        <div style={{ padding: "18px 16px 4px", display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => setReviewing(false)} aria-label={tr("Back")} style={backBtn}>←</button>
          <div style={{ fontSize: 21, fontWeight: 800, color: "#fff", letterSpacing: -0.4 }}>{tr("Review order")}</div>
        </div>

        <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          {cart.map((c) => (
            <GlassCard key={c.key} style={{ padding: "12px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, color: "#fff", flex: 1, minWidth: 0 }}>{localName(c.item)}</div>
                <QtyStepper qty={c.qty} size="sm" onDec={() => changeLine(c.key, -1)} onInc={() => changeLine(c.key, 1)} />
                <div style={{ fontWeight: 800, fontSize: 13.5, color: ACCENT, minWidth: 56, textAlign: "right" }}>₹{unitPrice(c.item, c.addonIds) * c.qty}</div>
              </div>
              {addonNames(c.item, c).map((n) => (
                <div key={n} style={{ fontSize: 12, color: "#93C5FD", marginTop: 2 }}>+ {n}</div>
              ))}
              <input
                value={c.notes} onChange={(e) => setNotes(c.key, e.target.value)}
                placeholder={tr("Add note (e.g. less spicy)…")}
                style={{
                  marginTop: 8, width: "100%", padding: "9px 11px", fontSize: 12.5, borderRadius: 10,
                  border: `1px solid ${GLASS_BORDER}`, background: "rgba(255,255,255,0.05)", color: "#fff",
                  boxSizing: "border-box", fontFamily: "inherit",
                }}
              />
            </GlassCard>
          ))}
          {acCharge > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: TEXT_MUTED, padding: "8px 4px 0" }}>
              <span>{tr("AC charge")} · {tr("{n} guests × ₹{rate}", { n: guestsN, rate: acRate })}</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>₹{acCharge}</span>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "10px 4px 0", fontWeight: 800, color: "#fff" }}>
            <span style={{ fontSize: 14 }}>{tr("Total")}</span>
            <span style={{ fontSize: 22, fontVariantNumeric: "tabular-nums", letterSpacing: -0.4 }}>₹{grand}</span>
          </div>
        </div>

        <div style={{ padding: "4px 16px" }}>
          <label style={{ fontSize: 11.5, fontWeight: 700, color: TEXT_FAINT, display: "block", marginBottom: 6 }}>{tr("Customer name (optional)")}</label>
          <input
            value={customerName} onChange={(e) => setCustomerName(e.target.value)}
            placeholder={tr("Walk-in guest")}
            style={{
              width: "100%", padding: "12px 14px", borderRadius: 12, border: `1px solid ${GLASS_BORDER}`,
              fontSize: 14, boxSizing: "border-box", background: GLASS_BG, color: "#fff",
            }}
          />
          <label style={{ fontSize: 11.5, fontWeight: 700, color: TEXT_FAINT, display: "block", margin: "12px 0 6px" }}>{tr("Phone number (optional)")}</label>
          <input
            value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
            inputMode="tel" maxLength={10} placeholder={tr("Phone number")}
            style={{
              width: "100%", padding: "12px 14px", borderRadius: 12, border: `1px solid ${GLASS_BORDER}`,
              fontSize: 14, boxSizing: "border-box", background: GLASS_BG, color: "#fff",
            }}
          />
          {acTable && (
            <>
              <label style={{ fontSize: 11.5, fontWeight: 700, color: TEXT_FAINT, display: "block", margin: "12px 0 6px" }}>
                {guestsReq ? tr("Number of guests *") : tr("Number of guests")}
              </label>
              <input
                value={guests} onChange={(e) => setGuests(e.target.value.replace(/\D/g, "").slice(0, 3))}
                inputMode="numeric" placeholder={tr("e.g. 4")}
                style={{
                  width: "100%", padding: "12px 14px", borderRadius: 12,
                  border: `1px solid ${guestsOk ? GLASS_BORDER : ACCENT}`,
                  fontSize: 14, boxSizing: "border-box", background: GLASS_BG, color: "#fff",
                }}
              />
              <div style={{ fontSize: 11.5, color: TEXT_FAINT, marginTop: 6 }}>
                {guestsReq
                  ? tr("Required for Indoor-AC · ₹{rate} per guest", { rate: acRate })
                  : tr("Table in use — only if guests weren't entered on its first order")}
              </div>
            </>
          )}
          <div style={{ fontSize: 11.5, color: TEXT_FAINT, marginTop: 10 }}>
            {orderType === "DINE_IN" ? pickedName : tr("Takeaway")} · {tr("the order is Placed right away; you can change it for a few minutes, then it goes to the kitchen and the KOT prints.")}
          </div>
        </div>

        <div className="floating-bar" style={{
          position: "fixed", left: 14, right: 14, bottom: NAV_HEIGHT + 4, padding: "12px 14px", zIndex: 30,
          background: "rgba(12,10,20,0.85)", backdropFilter: "blur(20px)", border: `1px solid ${GLASS_BORDER}`,
          borderRadius: 18, boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
        }}>
          <PrimaryButton onClick={handlePlace} disabled={!canPlace || placing} style={{ width: "100%" }}>
            {placing ? tr("Placing…") : `${tr("Place order")} · ₹${grand}`}
          </PrimaryButton>
        </div>
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: NAV_HEIGHT + (itemCount > 0 ? 90 : 16) }}>
      {picker && (
        <AddonPicker item={picker} onCancel={() => setPicker(null)}
          onConfirm={(ids) => { addLine(picker, ids); setPicker(null); }} />
      )}
      <div style={{ padding: "18px 16px 4px", display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={() => nav(-1)} aria-label={tr("Back")} style={backBtn}>←</button>
        <div style={{ fontSize: 21, fontWeight: 800, color: "#fff", letterSpacing: -0.4 }}>{tr("New order")}</div>
      </div>

      {/* Order type + table */}
      <div style={{ padding: "12px 16px" }}>
        {locked ? (<>
          <div style={{
            display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 12,
            border: "1.5px solid rgba(59,130,246,0.5)", background: ACCENT_SOFT, color: ACCENT, fontWeight: 800, fontSize: 14,
          }}>
            {preTable ? `🍽️ ${pickedName}` : `🛍️ ${tr("Take Away")}`}
            <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 600, color: TEXT_MUTED }}>
              {preTable ? tr("picked on the table map") : tr("no table")}
            </span>
          </div>
        </>) : (<>
        <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
          {/* Dine-in or takeaway. The area comes from the table (Admin → Tables). */}
          {["DINE_IN", "TAKEAWAY"].map((t) => {
            const on = orderType === t;
            return (
              <button key={t} onClick={() => setOrderType(t)} style={{
                flex: 1, padding: "12px 6px", borderRadius: 12, cursor: "pointer",
                border: `1.5px solid ${on ? "rgba(59,130,246,0.5)" : GLASS_BORDER}`,
                background: on ? ACCENT_SOFT : GLASS_BG,
                color: on ? ACCENT : TEXT_MUTED, fontWeight: 700, fontSize: 12.5,
              }}>
                {t === "TAKEAWAY" ? `🛍️ ${tr("Takeaway")}` : `🍽️ ${tr("Dine-in")}`}
              </button>
            );
          })}
        </div>

        {orderType === "DINE_IN" && (
          <select value={tableNo} onChange={(e) => setTableNo(e.target.value)} style={{
            width: "100%", padding: "12px 14px", borderRadius: 12, border: `1px solid ${GLASS_BORDER}`,
            fontSize: 14, background: GLASS_BG, color: "#fff",
          }}>
            <option value="" style={{ color: "#111" }}>{tr("Select a table…")}</option>
            {groupTablesByArea(tables).map((g) => (
              <optgroup key={g.area || "indoor"} label={tr(TABLE_AREA_LABEL[g.area] || g.area)} style={{ color: "#111" }}>
            {g.tables.map((t) => (
              <option key={t.tableNo} value={t.tableNo} style={{ color: "#111" }}>
                {tableLabel(t)} ({tn(t.seats, "{n} seat", "{n} seats")}){t.occupancyStatus === "OCCUPIED" ? ` — ${tr("occupied, adding to it")}` : ""}
              </option>
            ))}
              </optgroup>
            ))}
          </select>
        )}
        </>)}
      </div>

      {/* Search */}
      <div style={{ padding: "6px 16px", display: "flex", gap: 8 }}>
        <input
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={tr("Search menu…")}
          style={{
            flex: 1, minWidth: 0, padding: "11px 15px", borderRadius: 14, border: `1px solid ${GLASS_BORDER}`,
            fontSize: 14, boxSizing: "border-box", background: GLASS_BG, color: "#fff",
          }}
        />
        <VoiceOrder menu={voiceMenu} onAdd={addVoiceItems} onSearch={(q) => { setCategory(""); setSearch(q); }} />
      </div>

      {categories.length > 0 && (
        <div className="hide-scrollbar" style={{ display: "flex", gap: 8, overflowX: "auto", padding: "10px 16px" }}>
          <Chip active={!category} onClick={() => setCategory("")}>{tr("All")}</Chip>
          {categories.map((c) => (
            <Chip key={c.category} active={category === c.category} onClick={() => setCategory(c.category)}>{c.category}</Chip>
          ))}
        </div>
      )}

      <div style={{ padding: "4px 16px 0" }}>
        {items === null && <Loader label={tr("Loading menu…")} />}
        {items !== null && grouped.length === 0 && <EmptyState icon="🔎" title={tr("No items found")} />}
        {grouped.map(([cat, catItems]) => (
          <div key={cat} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#fff", letterSpacing: 0.3, padding: "12px 2px 6px" }}>{cat}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {catItems.map((it, i) => {
                const qty = getQty(it._id);
                const outOfStock = it.stockTracked && !it.stockAvailable;
                return (
                  <GlassCard
                    key={it._id} className="stagger-item"
                    style={{ "--i": i, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", opacity: outOfStock ? 0.5 : 1 }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5, color: "#fff" }}>{localName(it)}</div>
                      <NotShareableNote item={it} />
                      <div style={{ fontSize: 12, color: TEXT_FAINT, marginTop: 2 }}>₹{it.price}{outOfStock ? ` · ${tr("Out of stock")}` : ""}</div>
                      <AddonHint item={it} />
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
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{tn(itemCount, "{n} item", "{n} items")} · ₹{subtotal}</span>
          <span>{tr("Review")} →</span>
        </button>
      )}
    </div>
  );
}

const backBtn = {
  width: 36, height: 36, borderRadius: "50%", border: `1px solid ${GLASS_BORDER}`,
  background: GLASS_BG, fontSize: 17, cursor: "pointer", color: "#fff",
};

