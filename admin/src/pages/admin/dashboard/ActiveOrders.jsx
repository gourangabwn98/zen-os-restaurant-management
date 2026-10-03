// src/pages/admin/dashboard/ActiveOrders.jsx
// Today's still-active orders with a status control on each — the old
// "Recent orders" panel, restyled.
import { useState } from "react";
import Badge from "../shared/Badge.jsx";
import { needsPaidFirst } from "../shared/paymentRules.js";
import { ACTIVE_EXCLUDE } from "./model.js";
import { t, fmtNum, fmtTime, localName } from "../../../i18n/core.js";
import { customerName } from "../shared/customerName.js";

const money = (n) => `₹${fmtNum(Math.round(n || 0))}`;
const initials = (n) => (!n || n === "Guest" ? "G" : n.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2));

export default function ActiveOrders({ orders, nextStatus, statusLabel, statusKey, typeLabel, onStatusChange }) {
  const [type, setType] = useState("all");
  const active = orders.filter((o) => !ACTIVE_EXCLUDE.includes(o.status));
  const dining = active.filter((o) => o.orderType === "DINE_IN");
  const takeaway = active.filter((o) => o.orderType === "TAKEAWAY");
  const visible = type === "dining" ? dining : type === "takeaway" ? takeaway : active;
  const tabs = [
    { key: "all", label: t("All orders"), count: active.length },
    { key: "dining", label: t("Dine-in"), count: dining.length },
    { key: "takeaway", label: t("Takeaway"), count: takeaway.length },
  ];

  return (
    <div className="zd-card">
      <div className="zd-ch">
        <h3>{t("Active orders, today")}</h3>
        <div className="zd-seg" role="group">
          {tabs.map((b) => (
            <button type="button" key={b.key} aria-pressed={type === b.key} onClick={() => setType(b.key)}>
              {b.label} · {fmtNum(b.count)}
            </button>
          ))}
        </div>
      </div>
      {visible.length === 0 ? (
        <div className="zd-empty"><b>{t("No active orders")}</b></div>
      ) : (
        <div className="zd-olist">
          {visible.map((o) => {
            const who = customerName(o);
            const next = nextStatus[o.status] || [];
            return (
              <div className="zd-ord" key={o._id}>
                <span className="zd-av">{initials(who)}</span>
                <div style={{ minWidth: 0 }}>
                  <div className="n">{who || t("Admin")}<small>{o.orderId}</small></div>
                  <div className="it">{o.items?.map((i) => `${localName(i)} ×${fmtNum(i.qty)}`).join(", ")}</div>
                  <div className="meta">
                    <Badge label={o.status} format={statusKey} />
                    <span className="zd-chip zd-c-violet">{typeLabel(o.orderType)}</span>
                    {o.tableNo && <span className="zd-chip zd-c-grey">{t("Table {n}", { n: fmtNum(o.tableNo) })}</span>}
                    {next.length > 0 && (
                      <select
                        className="zd-select" value="" aria-label={t("Update status…")}
                        onChange={(e) => { if (e.target.value) onStatusChange(o._id, e.target.value); }}
                      >
                        <option value="" disabled>{t("Update status…")}</option>
                        {next.map((s) => (
                          <option key={s} value={s} disabled={needsPaidFirst(o, s)}>
                            {statusLabel(s)}{needsPaidFirst(o, s) ? ` (${t("mark Paid first")})` : ""}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
                <div>
                  <div className="amt">{money(o.total)}</div>
                  <div className="tm tnum">{fmtTime(o.createdAt)}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
