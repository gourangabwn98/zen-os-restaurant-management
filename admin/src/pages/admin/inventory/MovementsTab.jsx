import { useEffect, useState, useCallback } from "react";
import { getStockMovements, getInventoryItems } from "../../../services/inventoryService.js";
import { Toolbar, Spacer, Count, Loading, ErrorBox, TableShell, TableFooter } from "./invUI.jsx";
import { num, fmtDateTime } from "./invKit.js";

// LEDGER_TYPES — restaurant-server/utils/inventoryConstants.js
const TYPES = ["PURCHASE", "SALE_DEDUCTION", "WASTAGE", "ADJUSTMENT", "PHYSICAL_COUNT", "REVERSAL"];
const typeLabel = (t) => t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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
  if (error) return <ErrorBox onRetry={() => load({ item: inventoryItem, typ: type, pg: page, haveItems: items.length > 0 })} what="stock movements" />;

  return (
    <div>
      <Toolbar>
        <select className="zc-select" value={inventoryItem} onChange={(e) => changeItem(e.target.value)}
          aria-label="Filter by item" style={{ width: "auto" }}>
          <option value="">All items</option>
          {items.map((i) => <option key={i._id} value={i._id}>{i.name}</option>)}
        </select>
        <select className="zc-select" value={type} onChange={(e) => changeType(e.target.value)}
          aria-label="Filter by movement type" style={{ width: "auto" }}>
          <option value="">All movement types</option>
          {TYPES.map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
        </select>
        <Spacer />
        <Count>{meta.total} movement{meta.total === 1 ? "" : "s"}</Count>
      </Toolbar>

      <TableShell
        headers={["", "Item", "Change", "Balance", "Source", "By", "When"]}
        minWidth={760}
        isEmpty={movements.length === 0}
        emptyIcon="📒"
        emptyText="No stock movements match these filters"
        footer={<TableFooter page={page} pages={meta.pages} total={meta.total} perPage={PER_PAGE} onPage={setPage} unit="movements" />}
      >
        {movements.map((m) => {
          const inbound = m.quantity >= 0;
          return (
            <tr key={m._id}>
              <td style={{ width: 40 }}>
                <span className={`invp-mv-ic ${inbound ? "in" : "out"}`}>{inbound ? "+" : "−"}</span>
              </td>
              <td style={{ fontWeight: 600, color: "var(--text-1)" }}>{m.inventoryItem?.name || "—"}</td>
              <td className="num" style={{ fontWeight: 700, color: inbound ? "var(--ready-ink)" : "var(--stop-ink)" }}>
                {inbound ? "+" : ""}{num(m.quantity)} {m.inventoryItem?.unit || ""}
              </td>
              <td className="num" style={{ color: "var(--text-2)" }}>{num(m.balanceAfter)} {m.inventoryItem?.unit || ""}</td>
              <td style={{ color: "var(--text-2)", fontSize: 11.5 }}>
                <span style={{ fontWeight: 600 }}>{typeLabel(m.type)}</span>
                {m.reason ? <span style={{ color: "var(--text-3)" }}> · {m.reason}</span> : null}
              </td>
              <td style={{ color: "var(--text-3)", fontSize: 11.5 }}>{m.createdBy?.name || "System"}</td>
              <td className="num" style={{ color: "var(--text-3)", fontSize: 11.5 }}>{fmtDateTime(m.createdAt)}</td>
            </tr>
          );
        })}
      </TableShell>
    </div>
  );
}
