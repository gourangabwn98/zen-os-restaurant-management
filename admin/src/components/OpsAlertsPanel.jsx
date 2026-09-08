// src/components/OpsAlertsPanel.jsx
import { useEffect, useState } from "react";
import { getInventoryOverview, getPrinterStatus } from "../services/adminService.js";
import { PRIMARY, BG_CARD, BORDER, TEXT_PRIMARY, TEXT_MUTED } from "../theme.js";
import { Modal, LevelBadge } from "../pages/admin/inventory/invUI.jsx";

const num = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—");

export default function OpsAlertsPanel({ onNavigate }) {
  const [inv, setInv]         = useState(null);
  const [printer, setPrinter] = useState(null);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    const load = () => {
      getInventoryOverview().then((r) => setInv(r.data?.data || null)).catch(() => {});
      getPrinterStatus().then((r) => setPrinter(r.data || null)).catch(() => {});
    };
    load();
    const iv = setInterval(load, 20000);
    return () => clearInterval(iv);
  }, []);

  const low       = inv?.lowStock?.count      ?? 0;
  const critical  = inv?.critical?.count      ?? 0;
  const outStock  = inv?.outOfStock?.count    ?? 0;
  const expiring  = inv?.expiringSoon?.count  ?? 0;
  const hasStockAlert = low + critical + outStock + expiring > 0;

  if (!inv && !printer) return null;

  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
      {inv && (
        <button
          type="button"
          onClick={() => setShowModal(true)}
          style={{
            flex: "1 1 320px", background: BG_CARD, textAlign: "left", cursor: "pointer",
            border: `1px solid ${hasStockAlert ? "rgba(245,158,11,0.35)" : BORDER}`,
            borderRadius: 14, padding: "14px 16px", font: "inherit",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: hasStockAlert ? 10 : 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: TEXT_PRIMARY }}>📦 Stock Alerts</div>
            {hasStockAlert
              ? <span style={{ fontSize: 11.5, color: TEXT_MUTED }}>View details →</span>
              : <span style={{ fontSize: 11.5, color: "#34d399" }}>All good</span>}
          </div>
          {hasStockAlert && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {outStock > 0  && <Chip label={`${outStock} out of stock`}   color="#f87171" />}
              {critical > 0  && <Chip label={`${critical} critical`}       color="#fb923c" />}
              {low > 0       && <Chip label={`${low} low stock`}           color="#fbbf24" />}
              {expiring > 0  && <Chip label={`${expiring} expiring soon`}  color="#a78bfa" />}
            </div>
          )}
        </button>
      )}

      {printer && (
        <div style={{
          flex: "1 1 260px", background: BG_CARD, border: `1px solid ${BORDER}`,
          borderRadius: 14, padding: "14px 16px",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: TEXT_PRIMARY }}>🖨️ Printer</div>
            <span style={{
              display: "flex", alignItems: "center", gap: 5, fontSize: 11.5,
              color: printer.online ? "#34d399" : "#9ca3af",
            }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: printer.online ? "#34d399" : "#6b7280" }} />
              {printer.online ? `${printer.connectedPrinters} connected` : "No printer connected"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: 11, color: TEXT_MUTED }}>
            <span>Pending: <b style={{ color: TEXT_PRIMARY }}>{printer.queue?.pending ?? 0}</b></span>
            <span>Printed today: <b style={{ color: TEXT_PRIMARY }}>{printer.queue?.printedToday ?? 0}</b></span>
            {printer.queue?.failed > 0 && (
              <span style={{ color: "#f87171" }}>Failed: <b>{printer.queue.failed}</b></span>
            )}
          </div>
        </div>
      )}

      {showModal && inv && (
        <Modal
          title="Stock alerts"
          sub={hasStockAlert
            ? `${outStock + critical + low} item${outStock + critical + low === 1 ? "" : "s"} need attention · ${expiring} batch${expiring === 1 ? "" : "es"} expiring soon`
            : "All stock levels are healthy right now."}
          onClose={() => setShowModal(false)}
          width={560}
          footer={
            <button
              type="button"
              className="zc-btn pri"
              onClick={() => { setShowModal(false); onNavigate?.("inventory"); }}
            >
              Open inventory →
            </button>
          }
        >
          {!hasStockAlert ? (
            <div style={{ color: "var(--text-3)", fontSize: 13, textAlign: "center", padding: "28px 0" }}>
              Everything is well-stocked ✓
            </div>
          ) : (
            <>
              <AlertGroup title="Out of stock" items={inv.outOfStock?.items} level="OUT_OF_STOCK" />
              <AlertGroup title="Critical" items={inv.critical?.items} level="CRITICAL" />
              <AlertGroup title="Low stock" items={inv.lowStock?.items} level="LOW" />
              <ExpiringGroup batches={inv.expiringSoon?.batches} withinDays={inv.expiringSoon?.withinDays} />
            </>
          )}
        </Modal>
      )}
    </div>
  );
}

function AlertGroup({ title, items, level }) {
  if (!items || items.length === 0) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 6 }}>
        {title} · {items.length}
      </div>
      {items.map((it) => (
        <div key={it._id} style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
          padding: "8px 0", borderBottom: "1px solid var(--edge)",
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-1)" }}>{it.name}</div>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>
              {num(it.currentStock)} {it.unit} in stock · reorder at {num(it.reorderLevel)} {it.unit}
            </div>
          </div>
          <LevelBadge level={level} />
        </div>
      ))}
    </div>
  );
}

function ExpiringGroup({ batches, withinDays }) {
  if (!batches || batches.length === 0) return null;
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 6 }}>
        Expiring within {withinDays} days · {batches.length}
      </div>
      {batches.map((b) => (
        <div key={b._id} style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
          padding: "8px 0", borderBottom: "1px solid var(--edge)",
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-1)" }}>
              {b.inventoryItem?.name || "—"}{b.batchNo ? ` · ${b.batchNo}` : ""}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>
              {num(b.quantity)} in this batch
            </div>
          </div>
          <span className="zc-tag wait"><i />{fmtDate(b.expiryDate)}</span>
        </div>
      ))}
    </div>
  );
}

const Chip = ({ label, color }) => (
  <span style={{
    fontSize: 11, fontWeight: 700, color, background: `${color}22`,
    border: `1px solid ${color}44`, padding: "4px 10px", borderRadius: 20,
  }}>
    {label}
  </span>
);
