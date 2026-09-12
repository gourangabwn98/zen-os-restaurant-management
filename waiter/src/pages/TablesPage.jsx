import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { getAllTables, getOpenTableSessions, clearTableSession } from "../services/tableService.js";
import TableCard from "../components/TableCard.jsx";
import OrderCard from "../components/OrderCard.jsx";
import GlassCard from "../components/ui/GlassCard.jsx";
import PrimaryButton from "../components/ui/PrimaryButton.jsx";
import { Loader, ErrorState, EmptyState } from "../components/StateViews.jsx";
import { ACCENT, TEXT_MUTED, TEXT_FAINT, GLASS_BORDER, NAV_HEIGHT } from "../theme.js";

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
  const occupiedCount = tables.filter((t) => t.occupancyStatus === "OCCUPIED").length;

  return (
    <div style={{ paddingBottom: NAV_HEIGHT + 90 }}>
      <div style={{ padding: "20px 16px 4px", display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div style={{ fontSize: 19, fontWeight: 800, color: "#fff" }}>Tables</div>
        {tables.length > 0 && (
          <div style={{ fontSize: 12, color: TEXT_FAINT }}>
            <span style={{ color: ACCENT, fontWeight: 700 }}>{occupiedCount}</span> / {tables.length} occupied
          </div>
        )}
      </div>
      <div style={{ padding: "4px 16px 14px", fontSize: 12, color: TEXT_FAINT }}>
        Tap a table to view its orders or clear it once everything's settled.
      </div>

      {tables.length === 0 ? (
        <EmptyState icon="🍽️" title="No tables set up yet" sub="Ask an admin to add tables" />
      ) : (
        <div className="tables-grid" style={{ padding: "0 16px" }}>
          {tables.filter((t) => t.status !== "Inactive").sort((a, b) => a.tableNo - b.tableNo).map((t) => (
            <TableCard
              key={t.tableNo} table={t} session={sessions[t.tableNo]}
              active={selected === t.tableNo}
              onClick={() => setSelected(selected === t.tableNo ? null : t.tableNo)}
            />
          ))}
        </div>
      )}

      {selectedTable && (
        <div style={{ margin: "20px 16px 0" }}>
          <GlassCard padding={0} style={{ overflow: "hidden" }}>
            <div style={{ padding: "14px 16px", borderBottom: `1px solid ${GLASS_BORDER}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontWeight: 800, fontSize: 14, color: "#fff" }}>Table {selectedTable.tableNo}</div>
              {selectedSession ? (
                <PrimaryButton variant="success" onClick={() => handleClear(selectedSession)} disabled={clearing} style={{ padding: "8px 16px", fontSize: 11.5 }}>
                  {clearing ? "Clearing…" : "🧹 Clear Table"}
                </PrimaryButton>
              ) : (
                <PrimaryButton onClick={() => nav(`/new-order?table=${selectedTable.tableNo}`)} style={{ padding: "8px 16px", fontSize: 11.5 }}>
                  + New Order
                </PrimaryButton>
              )}
            </div>

            {selectedSession ? (
              <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                {(selectedSession.orders || []).map((o) => (
                  <OrderCard key={o._id} order={o} onClick={() => nav(`/order/${o._id}`)} />
                ))}
              </div>
            ) : (
              <div style={{ padding: "22px 16px", textAlign: "center", fontSize: 12.5, color: TEXT_MUTED }}>
                Table is free — start a new order for this table.
              </div>
            )}
          </GlassCard>
        </div>
      )}
    </div>
  );
}
