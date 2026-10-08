import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import { STORAGE } from "../theme.js";
import { validateTable } from "../services/tableService.js";

const readCtx = () => {
  try { return JSON.parse(localStorage.getItem(STORAGE.tableCtx)) || null; }
  catch { return null; }
};
const writeCtx = (ctx) => {
  try {
    if (ctx) localStorage.setItem(STORAGE.tableCtx, JSON.stringify(ctx));
    else localStorage.removeItem(STORAGE.tableCtx);
  } catch { /* storage off — the table just won't survive a reload */ }
};

/** What the QR put in the landing URL (read once, at app start). A table QR
 * is `/?table=N&t=<token>` (server: utils/qrLink.js); a counter one `/?mode=takeaway`. */
const readScan = () => {
  const p = new URLSearchParams(window.location.search);
  const tableNo = (p.get("table") || "").trim();
  const token = (p.get("t") || "").trim();
  return { takeaway: p.get("mode") === "takeaway", tableNo, token, full: !!(tableNo && token) };
};

const sameTable = (ctx, tableNo, token) => !!ctx && String(ctx.tableNo) === String(tableNo) && ctx.tableToken === token;

/** → { valid: true, data } | { valid: false } (the server said no) | { offline: true }.
 * A 4xx (unknown / inactive table) is a definite "no", never a network hiccup;
 * no response or a 5xx is retried a couple of times first. */
const verify = async (tableNo, token) => {
  if (!/^\d{1,6}$/.test(String(tableNo))) return { valid: false }; // tables are numbered
  for (let attempt = 0; ; attempt++) {
    try {
      const { data } = await validateTable(tableNo, token);
      return data?.valid ? { valid: true, data } : { valid: false };
    } catch (err) {
      const status = err.response?.status;
      if (status && status < 500) return { valid: false };
      if (attempt >= 2) return { offline: true };
      await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
    }
  }
};

/**
 * Table identity is only ever trusted after the backend confirms the
 * (tableNo, token) pair from a scanned QR — see tableController.validateTableToken.
 * A manually-typed table number, or a URL with no/invalid token, never
 * reaches "verified" state and dine-in ordering stays unavailable.
 *
 * QR landing: a scan of a DIFFERENT table than the stored one never shows the
 * old table while the new one is checked (`checking` is true meanwhile), and
 * a failed check never falls back to the old table. A stored table with no QR
 * in the URL (refresh, in-app navigation, installed-app launch) shows at once
 * and is re-checked quietly, so a regenerated/deactivated QR drops it.
 */
export function useTableSession() {
  const [scan] = useState(readScan);
  const [ctx, setCtx] = useState(() => {
    if (scan.takeaway) return null;
    const stored = readCtx();
    if (scan.full && !sameTable(stored, scan.tableNo, scan.token)) return null;
    return stored;
  }); // { tableNo, label, tableToken, verified }
  const [checking, setChecking] = useState(() => {
    if (!scan.full || scan.takeaway) return false;
    return !sameTable(readCtx(), scan.tableNo, scan.token);
  });

  useEffect(() => {
    if (scan.takeaway) { // counter takeaway QR — never dine-in
      writeCtx(null);
      setCtx(null);
      return;
    }
    if (scan.tableNo && !scan.token) {
      toast("Scan the QR code on your table to order dine-in.", { id: "table-qr", icon: "📷", duration: 5000 });
    }
    const stored = readCtx();
    const tableNo = scan.full ? scan.tableNo : stored?.tableNo;
    const token   = scan.full ? scan.token   : stored?.tableToken;
    if (!tableNo || !token) return; // no QR and nothing stored — takeaway

    const known = sameTable(stored, tableNo, token);
    let alive = true;
    if (!known) setChecking(true);
    verify(tableNo, token).then((r) => {
      if (!alive) return;
      if (r.valid) {
        const next = { tableNo: r.data.tableNo, label: r.data.tableName || r.data.label || `Table ${r.data.tableNo}`, tableToken: token, verified: true };
        writeCtx(next);
        setCtx(next);
      } else if (!r.offline) {
        writeCtx(null);
        setCtx(null);
        toast.error(scan.full
          ? "This table QR code isn't valid any more — please ask a staff member."
          : "Your table's QR code has changed — scan it again to order dine-in.", { id: "table-qr", duration: 6000 });
      } else if (!known) {
        // Couldn't reach the server for a NEW table: stay unverified (takeaway).
        toast.error("Couldn't check your table — check your connection and scan the QR again.", { id: "table-qr", duration: 6000 });
      } // offline re-check of an already-verified table: keep it
      setChecking(false);
    });
    return () => { alive = false; };
  }, [scan]);

  const clearTable = useCallback(() => {
    writeCtx(null);
    setCtx(null);
  }, []);

  return {
    tableNo:    ctx?.verified ? ctx.tableNo : null,
    tableLabel: ctx?.verified ? ctx.label   : null,
    tableToken: ctx?.verified ? ctx.tableToken : null,
    isDineIn:   !!ctx?.verified,
    checking,
    clearTable,
  };
}
