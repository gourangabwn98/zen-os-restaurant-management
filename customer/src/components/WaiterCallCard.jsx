import { useEffect, useState, useCallback, useRef } from "react";
import toast from "react-hot-toast";
import Button from "./ui/Button.jsx";
import {
  getWaiterCallState, callWaiter, withdrawWaiterCall, onWaiterCallUpdate,
} from "../services/waiterCallService.js";

const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * "Call waiter" for a dine-in order. The server decides who is rung and for
 * how long (3 min, then 2 min to every waiter, then the restaurant's phone
 * number — restaurant-server/services/waiterCallService.js); this card just
 * shows the state and counts down using the server's clock.
 */
export default function WaiterCallCard({ orderId, reason }) {
  const [state, setState] = useState(null); // server call state
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const skew = useRef(0); // server time − phone time

  const apply = useCallback((s) => {
    if (s?.serverNow) skew.current = new Date(s.serverNow).getTime() - Date.now();
    setState(s);
  }, []);

  const load = useCallback(() => {
    getWaiterCallState(orderId).then(({ data }) => apply(data)).catch(() => {});
  }, [orderId, apply]);

  useEffect(() => {
    load();
    const off = onWaiterCallUpdate(orderId, apply);
    const poll = setInterval(load, 20000); // in case the socket drops
    return () => { off(); clearInterval(poll); };
  }, [orderId, load, apply]);

  // Tick once a second only while a call is running.
  const live = state?.nextAction === "WAIT" && state.call;
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live]);

  const left = live ? new Date(state.call.expiresAt).getTime() - (now + skew.current) : 0;
  // The timer ran out on screen — ask the server what's next (call again / phone).
  const timeUp = !!live && left <= 0;
  useEffect(() => { if (timeUp) load(); }, [timeUp, load]);

  const doCall = async () => {
    setBusy(true);
    try {
      const { data } = await callWaiter(orderId);
      apply(data);
      if (data?.call && !data.adminPhone) toast.success(data.call.attempt === 2 ? "Calling all waiters…" : "Calling your waiter…");
    } catch (err) {
      const d = err.response?.data;
      if (d?.code === "CALL_RESTAURANT") setState((s) => ({ ...(s || {}), nextAction: "PHONE", adminPhone: d.adminPhone }));
      else toast.error(d?.message || "Couldn't call a waiter. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const doWithdraw = async () => {
    setBusy(true);
    try { const { data } = await withdrawWaiterCall(orderId); apply(data); }
    catch { toast.error("Couldn't cancel the call"); }
    finally { setBusy(false); }
  };

  if (!state) return null;
  const { call, nextAction, adminPhone } = state;
  const phoneLink = adminPhone ? `tel:${adminPhone.replace(/[^\d+]/g, "")}` : null;

  return (
    <div className="card" aria-live="polite">
      <div className="card-title">🛎️ Call waiter</div>

      {nextAction === "CALL" && (
        <>
          <p className="muted small" style={{ margin: "4px 0 12px", lineHeight: 1.5 }}>
            {reason || "Need something, or ready to pay? A waiter will come to your table."}
          </p>
          <Button onClick={doCall} disabled={busy}>{busy ? "Calling…" : "Call waiter"}</Button>
        </>
      )}

      {nextAction === "WAIT" && call && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "6px 0 10px" }}>
            <span className="pulse" aria-hidden="true" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>{call.acknowledgedBy?.name ? `${call.acknowledgedBy.name} is on the way` : call.attempt === 2 ? "Calling all waiters…" : "Calling your waiter…"}</b>
              <div className="muted tiny">
                {call.acknowledgedBy?.name ? "They'll be at your table shortly." : "Please stay at your table."}
              </div>
            </div>
            <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 800, fontSize: 20 }} aria-label="Time left">{mmss(left)}</span>
          </div>
          {adminPhone && (
            <div className="notice" role="status" style={{ marginBottom: 10 }}>
              No waiter is on duty right now — please call us at{" "}
              <a href={phoneLink} style={{ fontWeight: 800 }}>{adminPhone}</a>.
            </div>
          )}
          <Button variant="ghost" onClick={doWithdraw} disabled={busy}>Cancel call</Button>
        </>
      )}

      {nextAction === "CALL_AGAIN" && (
        <>
          <p className="muted small" style={{ margin: "4px 0 12px", lineHeight: 1.5 }}>
            Sorry — nobody has come yet. Call again and we&rsquo;ll ring every waiter on duty.
          </p>
          <Button onClick={doCall} disabled={busy}>{busy ? "Calling…" : "Call again"}</Button>
        </>
      )}

      {nextAction === "PHONE" && (
        <>
          <p className="muted small" style={{ margin: "4px 0 12px", lineHeight: 1.5 }}>
            Sorry for the wait. Please call the restaurant and we&rsquo;ll send someone right away.
          </p>
          {phoneLink
            ? <a href={phoneLink} className="btn btn-primary">📞 Call {adminPhone}</a>
            : <p className="muted small">Please ask any staff member nearby.</p>}
        </>
      )}
    </div>
  );
}
