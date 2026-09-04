import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { getAllTables, getOpenTableSessions, clearTableSession } from "../services/tableService.js";
import TableCard from "../components/TableCard.jsx";
import OrderCard from "../components/OrderCard.jsx";
import { Loader, ErrorState, EmptyState } from "../components/StateViews.jsx";
import { BLUE, TEXT_MUTED, TEXT_FAINT, BORDER, NAV_HEIGHT } from "../theme.js";

export default function TablesPage() {
  const nav = useNavigate();
  const [tables, setTables]   = useState(null);
  const [sessions, setSessions] = useState({});
  const [error, setError]     = useState(null);
  const [selected, setSelected] = useState(null);
  const [clearing, setClearing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [tRes, sRes] = await Promise.all([getAllTables(), getOpenTableSessions()]);
      setTables(tRes.data?.tables || []);
      const map = {};
      (sRes.data?.sessions || []).forEach((s) => { map[Number(s.tableNo)] = s; });
      setSessions(map);
    } catch {
      setError("Couldn't load tables");
    }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, [load]);

  const handleClear = async (session) => {
    if (!session?._id) return;
    if (!window.confirm(`Clear Table ${session.tableNo}? This closes the session.`)) return;
    setClearing(true);
    try {
      await clearTableSession(session._id);
      toast.success(`Table ${session.tableNo} cleared`);
      setSelected(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || "Cannot clear — some orders are still active");
    } finally { setClearing(false); }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (tables === null) return <Loader label="Loading tables…" />;

  const selectedTable = selected ? tables.find((t) => t.tableNo === selected) : null;
  const selectedSession = selected ? sessions[selected] : null;

  return (
    <div style={{ paddingBottom: NAV_HEIGHT + 90 }}>
      <div style={{ padding: "16px 16px 4px", fontSize: 18, fontWeight: 800 }}>Tables</div>
      <div style={{ padding: "0 16px 10px", fontSize: 12, color: TEXT_FAINT }}>
        Tap a table to view its orders or clear it once everything's settled.
      </div>

      {tables.length === 0 ? (
        <EmptyState icon="🍽️" title="No tables set up yet" sub="Ask an admin to add tables" />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, padding: "0 16px" }}>
          {tables.filter((t) => t.status !== "Inactive").sort((a, b) => a.tableNo - b.tableNo).map((t) => (
            <TableCard
              key={t.tableNo} table={t} session={sessions[t.tableNo]}
              onClick={() => setSelected(selected === t.tableNo ? null : t.tableNo)}
            />
          ))}
        </div>
      )}

      {selectedTable && (
        <div style={{ margin: "18px 16px 0", background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 16, overflow: "hidden" }}>
          <div style={{ padding: "14px 16px", borderBottom: `1px solid ${BORDER}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>Table {selectedTable.tableNo}</div>
            {selectedSession ? (
              <button onClick={() => handleClear(selectedSession)} disabled={clearing} style={{
                padding: "7px 14px", borderRadius: 10, border: "none", background: "#16a34a",
                color: "#fff", fontWeight: 700, fontSize: 11.5, cursor: clearing ? "not-allowed" : "pointer",
                opacity: clearing ? 0.6 : 1,
              }}>
                {clearing ? "Clearing…" : "🧹 Clear Table"}
              </button>
            ) : (
              <button onClick={() => nav(`/new-order?table=${selectedTable.tableNo}`)} style={{
                padding: "7px 14px", borderRadius: 10, border: "none", background: BLUE,
                color: "#fff", fontWeight: 700, fontSize: 11.5, cursor: "pointer",
              }}>
                + New Order
              </button>
            )}
          </div>

          {selectedSession ? (
            <div style={{ padding: "4px 16px" }}>
              {(selectedSession.orders || []).map((o) => (
                <OrderCard key={o._id} order={o} onClick={() => nav(`/order/${o._id}`)} />
              ))}
            </div>
          ) : (
            <div style={{ padding: "20px 16px", textAlign: "center", fontSize: 12.5, color: TEXT_MUTED }}>
              Table is free — start a new order for this table.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
