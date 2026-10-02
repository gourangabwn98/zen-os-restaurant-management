import { useEffect, useState, useCallback } from "react";
import { getStockMovements, getInventoryItems } from "../../../services/inventoryService.js";
import { Toolbar, Spacer, Count, Loading, ErrorBox, TableShell, TableFooter } from "./invUI.jsx";
import { num, fmtDateTime } from "./invKit.js";
import { t, tn, N_, localName } from "../../../i18n/core.js";
import { unitLabel } from "../../../utils/units.js";

// LEDGER_TYPES — restaurant-server/utils/inventoryConstants.js
const TYPES = ["PURCHASE", "SALE_DEDUCTION", "WASTAGE", "ADJUSTMENT", "PHYSICAL_COUNT", "REVERSAL"];
const TYPE_LABEL = {
  PURCHASE: N_("Purchase"), SALE_DEDUCTION: N_("Sale Deduction"), WASTAGE: N_("Wastage"),
  ADJUSTMENT: N_("Adjustment"), PHYSICAL_COUNT: N_("Physical Count"), REVERSAL: N_("Reversal"),
};
const typeLabel = (ty) => t(TYPE_LABEL[ty] || ty);

// Ledger reasons are written by the server in English (audit trail) — show
// the known shapes translated; anything typed by a person is shown as-is.
const REASON_PATTERNS = [
  [/^Order (\S+) cancelled$/, (m) => t("Order {id} cancelled", { id: m[1] })],
  [/^Order (\S+)$/, (m) => t("Order {id}", { id: m[1] })],
  [/^Purchase \((.+)\)$/, (m) => t("Purchase ({ref})", { ref: m[1] })],
];
const reasonLabel = (r) => {
  for (const [re, fn] of REASON_PATTERNS) { const m = re.exec(r); if (m) return fn(m); }
  return t(r);
};
const PER_PAGE = 25;

export default function MovementsTab() {
  const [movements, setMovements] = useState([]);
  const [meta, setMeta] = useState({ total: 0, pages: 1 });
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [inventoryItem, setInventoryItem] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);

  const load = useCallback(async (opts) => {
    const { item, typ, pg, haveItems } = opts;
    try {
      const [mRes, iRes] = await Promise.all([
        getStockMovements({
          inventoryItem: item || undefined, type: typ || undefined, page: pg, limit: PER_PAGE,
        }),
        haveItems ? Promise.resolve(null) : getInventoryItems(),
      ]);
      setMovements(mRes.data?.movements || []);
      setMeta({ total: mRes.data?.total || 0, pages: mRes.data?.pages || 1 });
      if (iRes) setItems(iRes.data?.items || []);
      setError(false);
    } catch { setError(true); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load({ item: inventoryItem, typ: type, pg: page, haveItems: items.length > 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventoryItem, type, page]);

  const changeItem = (v) => { setInventoryItem(v); setPage(1); };
  const changeType = (v) => { setType(v); setPage(1); };

  if (loading && movements.length === 0 && !error) return <Loading />;
  if (error) return <ErrorBox onRetry={() => load({ item: inventoryItem, typ: type, pg: page, haveItems: items.length > 0 })} what={N_("stock movements")} />;

  return (
    <div>
      <Toolbar>
        <select className="zc-select" value={inventoryItem} onChange={(e) => changeItem(e.target.value)}
          aria-label={t("Filter by item")} style={{ width: "auto" }}>
          <option value="">{t("All items")}</option>
          {items.map((i) => <option key={i._id} value={i._id}>{localName(i)}</option>)}
        </select>
        <select className="zc-select" value={type} onChange={(e) => changeType(e.target.value)}
          aria-label={t("Filter by movement type")} style={{ width: "auto" }}>
          <option value="">{t("All movement types")}</option>
          {TYPES.map((ty) => <option key={ty} value={ty}>{typeLabel(ty)}</option>)}
        </select>
        <Spacer />
        <Count>{tn(meta.total, "{n} movement", "{n} movements")}</Count>
      </Toolbar>

      <TableShell
        headers={["", N_("Item"), N_("Change"), N_("Balance"), N_("Source"), N_("By"), N_("When")]}
        minWidth={760}
        isEmpty={movements.length === 0}
        emptyIcon="📒"
        emptyText={t("No stock movements match these filters")}
        footer={<TableFooter page={page} pages={meta.pages} total={meta.total} perPage={PER_PAGE} onPage={setPage} unit={N_("movements")} />}
      >
        {movements.map((m) => {
          const inbound = m.quantity >= 0;
          return (
            <tr key={m._id}>
              <td style={{ width: 40 }}>
                <span className={`invp-mv-ic ${inbound ? "in" : "out"}`}>{inbound ? "+" : "−"}</span>
              </td>
              <td style={{ fontWeight: 600, color: "var(--text-1)" }}>{localName(m.inventoryItem) || "—"}</td>
              <td className="num" style={{ fontWeight: 700, color: inbound ? "var(--ready-ink)" : "var(--stop-ink)" }}>
                {inbound ? "+" : ""}{num(m.quantity)} {unitLabel(m.inventoryItem?.unit)}
              </td>
              <td className="num" style={{ color: "var(--text-2)" }}>{num(m.balanceAfter)} {unitLabel(m.inventoryItem?.unit)}</td>
              <td style={{ color: "var(--text-2)", fontSize: 11.5 }}>
                <span style={{ fontWeight: 600 }}>{typeLabel(m.type)}</span>
                {m.reason ? <span style={{ color: "var(--text-3)" }}> · {reasonLabel(m.reason)}</span> : null}
              </td>
              <td style={{ color: "var(--text-3)", fontSize: 11.5 }}>{m.createdBy?.name || t("System")}</td>
              <td className="num" style={{ color: "var(--text-3)", fontSize: 11.5 }}>{fmtDateTime(m.createdAt)}</td>
            </tr>
          );
        })}
      </TableShell>
    </div>
  );
}
