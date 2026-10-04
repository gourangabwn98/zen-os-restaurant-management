// src/pages/admin/shared/PrintServiceCard.jsx — Admin → Profile → Print service.
// KOTs and bills print through the on-premises print service (print-service/),
// which logs in with a printer KEY, not a staff account. Without a key nothing
// can connect, and every KOT / bill waits in the queue forever — so this card
// is where a key is made (shown ONCE), devices are listed / revoked, the live
// status is shown, and stale waiting jobs can be dropped before a printer
// connects (otherwise it would print hours-old tickets all at once).
//   GET  /admin/printer/status · GET/POST/DELETE /admin/printer/devices
//   POST /admin/printer/skip-stale
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import api from "../../../services/api.js";
import { useVisibleInterval } from "../../../hooks/useVisibleInterval.js";
import { t, N_, fmtNum, fmtDateTime } from "../../../i18n/core.js";

const ROLES = [
  { id: "BOTH", label: N_("KOT + bills") },
  { id: "KOT", label: N_("KOT only") },
  { id: "BILL", label: N_("Bills only") },
];
const roleLabel = (r) => ROLES.find((x) => x.id === r)?.label || r;
const ago = (d) => {
  if (!d) return t("never");
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return t("just now");
  if (m < 60) return t("{n} min ago", { n: fmtNum(m) });
  if (m < 60 * 24) return t("{n} h ago", { n: fmtNum(Math.floor(m / 60)) });
  return fmtDateTime(d);
};

export default function PrintServiceCard({ backendUrl }) {
  const [status, setStatus] = useState(null);
  const [devices, setDevices] = useState(null);
  const [form, setForm] = useState(null);      // null | { name, role, saving }
  const [newKey, setNewKey] = useState(null);  // { name, key } — shown once
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get("/admin/printer/status").then((r) => setStatus(r.data)).catch(() => {});
    api.get("/admin/printer/devices").then((r) => setDevices(r.data?.devices || [])).catch(() => setDevices([]));
  }, []);
  useEffect(() => { load(); }, [load]);
  useVisibleInterval(load, 15000);

  const active = (devices || []).filter((d) => d.status === "Active");
  const waiting = status ? status.kot.pending + status.kot.failed + status.bill.pending + status.bill.failed : 0;
  const oldMin = status?.oldestWaitingAt ? Math.round((Date.now() - new Date(status.oldestWaitingAt).getTime()) / 60000) : 0;

  const create = async () => {
    const name = form?.name?.trim();
    if (!name) return toast.error(t("Give the print service a name, e.g. Counter PC"));
    setForm((f) => ({ ...f, saving: true }));
    try {
      const { data } = await api.post("/admin/printer/devices", { name, role: form.role });
      setNewKey({ name, key: data.printerKey });
      setForm(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.message || t("Couldn't create the key"));
      setForm((f) => (f ? { ...f, saving: false } : f));
    }
  };
  const revoke = async (d) => {
    if (!window.confirm(t("Revoke “{name}”? That print service stops receiving KOTs and bills until it gets a new key.", { name: d.name }))) return;
    try { await api.delete(`/admin/printer/devices/${d._id}`); toast.success(t("Key revoked")); load(); }
    catch (e) { toast.error(e?.response?.data?.message || t("Failed")); }
  };
  const skipStale = async () => {
    if (!window.confirm(t("Drop every waiting job older than 1 hour? Those tickets will not print."))) return;
    setBusy(true);
    try {
      const { data } = await api.post("/admin/printer/skip-stale", { olderThanMinutes: 60 });
      toast.success(t("Dropped {k} KOTs and {b} bills", { k: fmtNum(data.kot), b: fmtNum(data.bill) }));
      load();
    } catch (e) { toast.error(e?.response?.data?.message || t("Failed")); }
    finally { setBusy(false); }
  };
  const copy = (text) => { navigator.clipboard?.writeText(text); toast.success(t("Copied")); };
  const envText = newKey ? `BACKEND_URL=${backendUrl}\nPRINTER_KEY=${newKey.key}` : "";

  const online = status?.connectedPrinters > 0;
  const tone = online ? "ready" : active.length ? "wait" : "stop";

  return (
    <div className="zc-card" style={{ marginBottom: 16 }}>
      <div className="zc-card-h">
        <div><div className="t">{t("Print service")}</div><div className="s">{t("The program on the restaurant PC that prints KOTs and bills")}</div></div>
        <div style={{ flex: 1 }} />
        {status && <span className={`zc-tag ${tone}`}><i />{online ? t("Connected") : t("Not connected")}</span>}
      </div>
      <div style={{ padding: 18, display: "grid", gap: 12 }}>
        {status && !online && (
          <div role="alert" style={{ fontSize: 12.5, lineHeight: 1.5, padding: "10px 12px", borderRadius: 10, background: `var(--${tone}-fill)`, border: `1px solid var(--${tone}-line)`, color: `var(--${tone}-ink)` }}>
            {active.length === 0
              ? t("No print service is set up, so KOTs and bills cannot print. Create a key below and put it in the print service's .env file.")
              : t("The print service isn't running or can't reach the server. Start it on the restaurant PC and check BACKEND_URL and PRINTER_KEY in its .env file.")}
          </div>
        )}

        {status && (
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12.5, color: "var(--text-2)" }}>
            <span>{t("Waiting")}: <b style={{ color: waiting ? "var(--wait-ink)" : "var(--text-1)" }}>{t("{k} KOT · {b} bill", { k: fmtNum(status.kot.pending + status.kot.failed), b: fmtNum(status.bill.pending + status.bill.failed) })}</b></span>
            <span>{t("Printed today")}: <b style={{ color: "var(--text-1)" }}>{t("{k} KOT · {b} bill", { k: fmtNum(status.kot.printedToday), b: fmtNum(status.bill.printedToday) })}</b></span>
            {waiting > 0 && status.oldestWaitingAt && <span>{t("Oldest waiting: {when}", { when: ago(status.oldestWaitingAt) })}</span>}
          </div>
        )}
        {waiting > 0 && oldMin >= 60 && (
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "var(--text-3)", flex: "1 1 220px" }}>
              {t("Old tickets would all print at once when a printer connects. Drop the ones older than 1 hour first.")}
            </span>
            <button type="button" className="zc-btn sm" disabled={busy} onClick={skipStale}>{t("Drop old waiting jobs")}</button>
          </div>
        )}

        {newKey && (
          <div style={{ padding: 12, borderRadius: 10, border: "1px solid var(--ready-line)", background: "var(--ready-fill)", display: "grid", gap: 8 }}>
            <b style={{ fontSize: 13 }}>{t("Key for “{name}” — copy it now, it is shown only once", { name: newKey.name })}</b>
            <pre style={{ margin: 0, padding: 10, borderRadius: 8, background: "var(--card-2)", fontSize: 11.5, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{envText}</pre>
            <div style={{ fontSize: 11.5, color: "var(--text-2)" }}>
              {t("Paste these two lines into the .env file next to the print service (SohojPrintService.exe), set your printers in printers.config.json, then restart it.")}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="zc-btn sm pri" onClick={() => copy(envText)}>{t("Copy")}</button>
              <button type="button" className="zc-btn sm ghost" onClick={() => setNewKey(null)}>{t("Done")}</button>
            </div>
          </div>
        )}

        {devices && devices.length > 0 && (
          <div style={{ display: "grid", gap: 6 }}>
            {devices.map((d) => (
              <div key={d._id} className="prof-list-row" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 180px", minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 12.5 }}>{d.name}</div>
                  <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                    {t(roleLabel(d.role))} · {t("last seen {when}", { when: ago(d.lastSeenAt) })}
                    {d.lastError ? ` · ${d.lastError}` : ""}
                  </div>
                </div>
                {d.status === "Revoked"
                  ? <span className="zc-tag done"><i />{t("Revoked")}</span>
                  : <button type="button" className="zc-btn sm danger" onClick={() => revoke(d)}>{t("Revoke")}</button>}
              </div>
            ))}
          </div>
        )}

        {form ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input className="zc-input" style={{ flex: "2 1 160px" }} autoFocus placeholder={t("Name, e.g. Counter PC")} aria-label={t("Name")}
              value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && create()} />
            <select className="zc-select" style={{ flex: "1 1 120px" }} aria-label={t("Prints")} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {ROLES.map((r) => <option key={r.id} value={r.id}>{t(r.label)}</option>)}
            </select>
            <button type="button" className="zc-btn pri" disabled={form.saving} onClick={create}>{form.saving ? t("Creating…") : t("Create key")}</button>
            <button type="button" className="zc-btn ghost" onClick={() => setForm(null)}>{t("Cancel")}</button>
          </div>
        ) : (
          <button type="button" className="zc-btn sm" style={{ justifySelf: "start" }} onClick={() => setForm({ name: "", role: "BOTH" })}>
            ＋ {t("Set up a print service")}
          </button>
        )}
      </div>
    </div>
  );
}
