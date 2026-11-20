// src/pages/admin/DevicesPage.jsx — Admin → Devices (Offline Edition only).
// Shown only when this admin app was opened from the restaurant PC
// (LOCAL_SERVER, src/local/localAuth.js). Three tabs:
//   Devices    — approve a waiting device after checking its pairing code,
//                reject it, or revoke a trusted one (lost/stolen/retired:
//                its sessions end at once).
//   Staff PINs — set a temporary PIN (must be changed at first sign-in);
//                also how a forgotten PIN or a locked account is fixed.
//   Sign-in log — append-only audit of every sign-in event (admin only).
// The server enforces every rule (restaurant-server/services/localAuthService.js);
// the role limits here only shape what a manager is offered.
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { useAuth } from "../../hooks/useAuth.js";
import { isManager } from "../../utils/access.js";
import { getEmployees } from "../../services/adminService.js";
import {
  listDevices, approveDevice, rejectDevice, revokeDevice, listPinStatus, setStaffPin, changeMyPin, listAuthEvents,
} from "../../local/localAdminService.js";
import { PageHeader, Loader, EmptyState } from "./shared";
import { t, N_ } from "../../i18n/core.js";

const PIN_ROLES = ["admin", "manager", "inventory_manager", "waiter", "chef"];
const MANAGER_DEVICE_ROLES = ["waiter", "chef"];
const ROLE_LABEL = { admin: N_("Admin"), manager: N_("Manager"), inventory_manager: N_("Inventory"), waiter: N_("Waiter"), chef: N_("Chef") };
const STATUS_TAG = { PENDING: ["wait", N_("Waiting")], APPROVED: ["ready", N_("Trusted")], REJECTED: ["done", N_("Rejected")], REVOKED: ["stop", N_("Revoked")] };
const EVENT_LABEL = {
  BOOTSTRAP: N_("First-time setup"), BOOTSTRAP_REJECTED: N_("Setup refused"),
  DEVICE_REGISTERED: N_("Device registered"), DEVICE_APPROVED: N_("Device approved"), DEVICE_REJECTED: N_("Device rejected"), DEVICE_REVOKED: N_("Device revoked"),
  LOGIN_SUCCESS: N_("Signed in"), LOGIN_FAILED: N_("Wrong phone or PIN"), LOGIN_BLOCKED: N_("Sign-in blocked"), LOCKOUT: N_("Account locked"),
  LOGOUT: N_("Signed out"), PIN_SET: N_("Temporary PIN set"), PIN_CHANGED: N_("PIN changed"), PIN_CHANGE_FAILED: N_("Wrong current PIN"),
  SESSION_REVOKED: N_("Session ended"), RECOVERY: N_("Recovery"),
};
const ALERT_EVENTS = new Set(["LOGIN_FAILED", "LOGIN_BLOCKED", "LOCKOUT", "BOOTSTRAP_REJECTED", "PIN_CHANGE_FAILED", "DEVICE_REVOKED"]);

const roleOf = (u) => (u?.isAdmin ? "admin" : u?.role || "");
const when = (d) => (d ? new Date(d).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");
const errMsg = (err, fallback) => err?.response?.data?.message || fallback;
const digits = (v, max = 8) => v.replace(/\D/g, "").slice(0, max);

export default function DevicesPage() {
  const { user } = useAuth();
  const manager = isManager(user);
  const [tab, setTab] = useState("devices");
  const tabs = [
    { key: "devices", label: t("Devices") },
    { key: "pins", label: t("Staff PINs") },
    ...(manager ? [] : [{ key: "log", label: t("Sign-in log") }]),
  ];
  return (
    <div>
      <PageHeader title={t("Devices & PINs")} sub={t("Phones, tablets and PCs allowed to sign in on the restaurant network, and staff PINs")} />
      <div className="zc-seg" role="tablist" style={{ marginBottom: 16, flexWrap: "wrap" }}>
        {tabs.map((x) => (
          <button key={x.key} type="button" role="tab" aria-selected={tab === x.key} className={tab === x.key ? "on" : ""} onClick={() => setTab(x.key)}>{x.label}</button>
        ))}
      </div>
      {tab === "devices" && <DevicesTab manager={manager} />}
      {tab === "pins" && <PinsTab manager={manager} me={user} />}
      {tab === "log" && !manager && <LogTab />}
    </div>
  );
}

// ── Devices ──────────────────────────────────────────────────────────────────
function DevicesTab({ manager }) {
  const [devices, setDevices] = useState(null);
  const [error, setError] = useState(false);
  const load = useCallback(() => {
    listDevices().then(({ data }) => { setDevices(data); setError(false); }).catch(() => setError(true));
  }, []);
  useEffect(() => { load(); const id = setInterval(load, 8000); return () => clearInterval(id); }, [load]);

  if (error && !devices) return <div className="zc-card"><EmptyState title={t("Couldn't load devices")} action={<button type="button" className="zc-btn" onClick={load}>{t("Retry")}</button>} /></div>;
  if (!devices) return <div className="zc-card" style={{ padding: 20 }}><Loader rows={4} /></div>;

  const waiting = devices.filter((d) => d.status === "PENDING");
  const trusted = devices.filter((d) => d.status === "APPROVED");
  const past = devices.filter((d) => d.status === "REJECTED" || d.status === "REVOKED");
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="zc-card">
        <div className="zc-card-h"><div>
          <div className="t">{t("Waiting for approval")}</div>
          <div className="s">{t("On the new device: open the waiter, kitchen or admin app and tap “Register this device”. It shows a 6-letter code.")}</div>
        </div></div>
        <div className="zc-card-b" style={{ display: "grid", gap: 10 }}>
          {waiting.length === 0 && <div style={{ color: "var(--text-2)", fontSize: 13 }}>{t("No device is waiting.")}</div>}
          {waiting.map((d) => <PendingDevice key={d._id} d={d} manager={manager} onDone={load} />)}
        </div>
      </div>

      <div className="zc-card">
        <div className="zc-card-h"><div>
          <div className="t">{t("Trusted devices")}</div>
          <div className="s">{t("Lost or stolen? Revoke it — anyone signed in on it is signed out immediately.")}</div>
        </div></div>
        <div className="zc-card-b" style={{ display: "grid", gap: 10 }}>
          {trusted.length === 0 && <div style={{ color: "var(--text-2)", fontSize: 13 }}>{t("No trusted devices yet.")}</div>}
          {trusted.map((d) => <TrustedDevice key={d._id} d={d} manager={manager} onDone={load} />)}
        </div>
      </div>

      {past.length > 0 && (
        <details className="zc-card">
          <summary className="zc-card-h" style={{ cursor: "pointer" }}><div className="t">{t("Rejected and revoked ({n})", { n: past.length })}</div></summary>
          <div className="zc-card-b" style={{ display: "grid", gap: 8 }}>
            {past.map((d) => (
              <div key={d._id} style={rowStyle}>
                <DeviceTitle d={d} />
                <div style={{ fontSize: 12, color: "var(--text-2)" }}>
                  {d.status === "REVOKED" ? `${t("Revoked")} ${when(d.revokedAt)}${d.revokeReason ? ` — ${d.revokeReason}` : ""}` : `${t("Rejected")} ${when(d.decidedAt)}`}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

const rowStyle = { border: "1px solid var(--line, rgba(127,127,127,.2))", borderRadius: 12, padding: "12px 14px", display: "grid", gap: 8 };

function DeviceTitle({ d }) {
  const [kind, label] = STATUS_TAG[d.status] || ["done", d.status];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ fontWeight: 700, color: "var(--text-1)" }}>{d.label || t("Device")}</span>
      <span className={`zc-tag ${kind}`}>{t(label)}</span>
      {d.allowedRoles?.length > 0 && d.status === "APPROVED" && (
        <span style={{ fontSize: 12, color: "var(--text-2)" }}>{d.allowedRoles.map((r) => t(ROLE_LABEL[r] || r)).join(" · ")}</span>
      )}
    </div>
  );
}

function RolePicker({ value, onChange, manager }) {
  const offered = manager ? MANAGER_DEVICE_ROLES : PIN_ROLES;
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      {offered.map((r) => (
        <label key={r} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-1)", cursor: "pointer" }}>
          <input type="checkbox" checked={value.includes(r)} onChange={(e) => onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))} />
          {t(ROLE_LABEL[r])}
        </label>
      ))}
    </div>
  );
}

function PendingDevice({ d, manager, onDone }) {
  const [code, setCode] = useState("");
  const [roles, setRoles] = useState([]);
  const [label, setLabel] = useState(d.label || "");
  const [busy, setBusy] = useState(false);
  const approve = async () => {
    if (code.replace(/[\s-]/g, "").length !== 6) return toast.error(t("Type the 6-letter code shown on the device"));
    if (!roles.length) return toast.error(t("Choose who may sign in on this device"));
    setBusy(true);
    try { await approveDevice(d._id, { pairingCode: code, allowedRoles: roles, label }); toast.success(t("Device approved")); onDone(); }
    catch (err) { toast.error(errMsg(err, t("Couldn't approve the device"))); }
    finally { setBusy(false); }
  };
  const reject = async () => {
    if (!window.confirm(t("Reject “{name}”? It will have to register again.", { name: d.label }))) return;
    setBusy(true);
    try { await rejectDevice(d._id); toast.success(t("Device rejected")); onDone(); }
    catch (err) { toast.error(errMsg(err, t("Couldn't reject the device"))); }
    finally { setBusy(false); }
  };
  return (
    <div style={rowStyle}>
      <DeviceTitle d={d} />
      <div style={{ fontSize: 12, color: "var(--text-2)" }}>
        {t("Registered {time} from {ip}", { time: when(d.createdAt), ip: d.registeredFromIp || "—" })}
        {d.platform ? ` · ${d.platform.slice(0, 80)}` : ""}
      </div>
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <label style={{ fontSize: 12, color: "var(--text-2)", display: "grid", gap: 4 }}>
          {t("Code shown on the device")}
          <input className="zc-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 7))} placeholder="ABC234" autoComplete="off" style={{ letterSpacing: 3, fontWeight: 700 }} />
        </label>
        <label style={{ fontSize: 12, color: "var(--text-2)", display: "grid", gap: 4 }}>
          {t("Device name")}
          <input className="zc-input" value={label} onChange={(e) => setLabel(e.target.value.slice(0, 60))} />
        </label>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-2)" }}>{t("Who may sign in on it")}</div>
      <RolePicker value={roles} onChange={setRoles} manager={manager} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="zc-btn pri" disabled={busy} onClick={approve}>✓ {t("Approve")}</button>
        <button type="button" className="zc-btn" disabled={busy} onClick={reject}>{t("Reject")}</button>
      </div>
    </div>
  );
}

function TrustedDevice({ d, manager, onDone }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const canManage = !manager || d.allowedRoles.every((r) => MANAGER_DEVICE_ROLES.includes(r));
  const revoke = async () => {
    if (reason.trim().length < 3) return toast.error(t("Say why (e.g. lost, stolen, replaced)"));
    setBusy(true);
    try { await revokeDevice(d._id, reason.trim()); toast.success(t("Device revoked — everyone on it was signed out")); onDone(); }
    catch (err) { toast.error(errMsg(err, t("Couldn't revoke the device"))); }
    finally { setBusy(false); }
  };
  return (
    <div style={rowStyle}>
      <DeviceTitle d={d} />
      <div style={{ fontSize: 12, color: "var(--text-2)" }}>
        {t("Approved {time}", { time: when(d.decidedAt) })} · {t("Last used {time}", { time: when(d.lastSeenAt) })}
      </div>
      {canManage && !open && (
        <div><button type="button" className="zc-btn" onClick={() => setOpen(true)}>{t("Revoke…")}</button></div>
      )}
      {canManage && open && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input className="zc-input" value={reason} onChange={(e) => setReason(e.target.value.slice(0, 200))} placeholder={t("Reason (lost, stolen, replaced…)")} style={{ flex: "1 1 200px" }} autoFocus />
          <button type="button" className="zc-btn pri" disabled={busy} onClick={revoke}>{t("Revoke now")}</button>
          <button type="button" className="zc-btn" disabled={busy} onClick={() => { setOpen(false); setReason(""); }}>{t("Cancel")}</button>
        </div>
      )}
    </div>
  );
}

// ── Staff PINs ───────────────────────────────────────────────────────────────
function PinsTab({ manager, me }) {
  const [people, setPeople] = useState(null);
  const [pins, setPins] = useState({});
  const [error, setError] = useState(false);
  const load = useCallback(() => {
    Promise.all([getEmployees({}), listPinStatus()]).then(([emp, st]) => {
      setPeople((emp.data.employees || []).filter((u) => PIN_ROLES.includes(roleOf(u)) && u.status !== "Inactive"));
      setPins(Object.fromEntries(st.data.map((p) => [String(p.user), p])));
      setError(false);
    }).catch(() => setError(true));
  }, []);
  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => (people || []).filter((u) => String(u.phone) !== String(me?.phone)), [people, me]);
  if (error && !people) return <div className="zc-card"><EmptyState title={t("Couldn't load staff")} action={<button type="button" className="zc-btn" onClick={load}>{t("Retry")}</button>} /></div>;
  if (!people) return <div className="zc-card" style={{ padding: 20 }}><Loader rows={4} /></div>;
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <MyPinCard />
      <div className="zc-card">
        <div className="zc-card-h"><div>
          <div className="t">{t("Staff PINs")}</div>
          <div className="s">{t("Set a temporary PIN and tell the person in private. They choose their own PIN at the next sign-in. Setting a PIN also unlocks a locked account and signs that person out everywhere.")}</div>
        </div></div>
        <div className="zc-card-b" style={{ display: "grid", gap: 8 }}>
          {visible.length === 0 && <div style={{ color: "var(--text-2)", fontSize: 13 }}>{t("No staff accounts yet — add them in Employees.")}</div>}
          {visible.map((u) => (
            <PinRow key={u._id} u={u} st={pins[String(u._id)]} canSet={!manager || MANAGER_DEVICE_ROLES.includes(roleOf(u))} onDone={load} />
          ))}
        </div>
      </div>
    </div>
  );
}

function PinRow({ u, st, canSet, onDone }) {
  const [pin, setPin] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (pin.length < 6) return toast.error(t("PIN must be 6–8 digits"));
    setBusy(true);
    try { await setStaffPin(u._id, pin); toast.success(t("Temporary PIN set for {name}", { name: u.name })); setPin(""); setOpen(false); onDone(); }
    catch (err) { toast.error(errMsg(err, t("Couldn't set the PIN"))); }
    finally { setBusy(false); }
  };
  const state = !st ? <span className="zc-tag done">{t("No PIN")}</span>
    : st.lockedUntil ? <span className="zc-tag stop">{t("Locked until {time}", { time: new Date(st.lockedUntil).toLocaleTimeString([], { timeStyle: "short" }) })}</span>
    : st.mustChange ? <span className="zc-tag wait">{t("Temporary PIN")}</span>
    : <span className="zc-tag ready">{t("PIN set")}</span>;
  return (
    <div style={{ ...rowStyle, gridTemplateColumns: "1fr auto", alignItems: "center" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, color: "var(--text-1)" }}>{u.name} <span style={{ fontWeight: 500, fontSize: 12, color: "var(--text-2)" }}>· {t(ROLE_LABEL[roleOf(u)] || roleOf(u))} · {u.phone}</span></div>
        <div style={{ marginTop: 4 }}>{state}</div>
      </div>
      {canSet && !open && <button type="button" className="zc-btn" onClick={() => setOpen(true)}>{st ? t("Reset PIN") : t("Set PIN")}</button>}
      {canSet && open && (
        <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input className="zc-input" type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(e) => setPin(digits(e.target.value))} placeholder={t("Temporary PIN (6–8 digits)")} style={{ flex: "1 1 180px", letterSpacing: 4 }} autoFocus />
          <button type="button" className="zc-btn pri" disabled={busy} onClick={save}>{t("Save")}</button>
          <button type="button" className="zc-btn" disabled={busy} onClick={() => { setOpen(false); setPin(""); }}>{t("Cancel")}</button>
        </div>
      )}
    </div>
  );
}

function MyPinCard() {
  const [cur, setCur] = useState(""), [n1, setN1] = useState(""), [n2, setN2] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (n1.length < 6) return toast.error(t("PIN must be 6–8 digits"));
    if (n1 !== n2) return toast.error(t("The two PINs don't match"));
    setBusy(true);
    try { await changeMyPin(cur, n1); toast.success(t("PIN changed — your other devices were signed out")); setCur(""); setN1(""); setN2(""); }
    catch (err) { toast.error(errMsg(err, t("Couldn't change the PIN"))); }
    finally { setBusy(false); }
  };
  const field = (label, v, set, ac) => (
    <label style={{ fontSize: 12, color: "var(--text-2)", display: "grid", gap: 4 }}>
      {label}
      <input className="zc-input" type="password" inputMode="numeric" autoComplete={ac} value={v} onChange={(e) => set(digits(e.target.value))} style={{ letterSpacing: 4 }} />
    </label>
  );
  return (
    <div className="zc-card">
      <div className="zc-card-h"><div><div className="t">{t("My PIN")}</div><div className="s">{t("Change the PIN you use to sign in on the restaurant network.")}</div></div></div>
      <div className="zc-card-b" style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", alignItems: "end" }}>
        {field(t("Current PIN"), cur, setCur, "current-password")}
        {field(t("New PIN"), n1, setN1, "new-password")}
        {field(t("New PIN again"), n2, setN2, "new-password")}
        <button type="button" className="zc-btn pri" disabled={busy} onClick={save}>{t("Change PIN")}</button>
      </div>
    </div>
  );
}

// ── Sign-in log ──────────────────────────────────────────────────────────────
function LogTab() {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState(false);
  const load = useCallback(() => {
    listAuthEvents(300).then(({ data }) => { setEvents(data); setError(false); }).catch(() => setError(true));
  }, []);
  useEffect(() => { load(); }, [load]);
  if (error && !events) return <div className="zc-card"><EmptyState title={t("Couldn't load the sign-in log")} action={<button type="button" className="zc-btn" onClick={load}>{t("Retry")}</button>} /></div>;
  if (!events) return <div className="zc-card" style={{ padding: 20 }}><Loader rows={6} /></div>;
  return (
    <div className="zc-card">
      <div className="zc-card-h">
        <div><div className="t">{t("Sign-in log")}</div><div className="s">{t("Latest 300 events. This log can't be edited or deleted.")}</div></div>
        <button type="button" className="zc-btn" onClick={load}>↻ {t("Refresh")}</button>
      </div>
      <div className="zc-card-b" style={{ overflowX: "auto" }}>
        <table className="zc-tbl" style={{ width: "100%" }}>
          <thead><tr><th>{t("When")}</th><th>{t("Event")}</th><th>{t("By")}</th><th>{t("Phone")}</th><th>{t("Address")}</th><th>{t("Details")}</th></tr></thead>
          <tbody>
            {events.map((e) => (
              <tr key={e._id}>
                <td style={{ whiteSpace: "nowrap" }}>{when(e.at)}</td>
                <td>{ALERT_EVENTS.has(e.type) ? <span className="zc-tag stop">{t(EVENT_LABEL[e.type] || e.type)}</span> : t(EVENT_LABEL[e.type] || e.type)}</td>
                <td>{e.actor?.kind === "USER" ? t(ROLE_LABEL[e.actor.role] || e.actor.role || "—") : e.actor?.kind === "SYSTEM" ? t("System") : "—"}</td>
                <td>{e.phone || "—"}</td>
                <td>{e.ip || "—"}</td>
                <td style={{ color: "var(--text-2)" }}>{e.reason || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {events.length === 0 && <div style={{ color: "var(--text-2)", fontSize: 13, padding: 12 }}>{t("Nothing yet.")}</div>}
      </div>
    </div>
  );
}
