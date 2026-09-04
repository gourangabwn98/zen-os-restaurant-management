import { useState, useEffect, useCallback } from "react";
import { STORAGE } from "../theme.js";
import { validateTable } from "../services/tableService.js";

const readCtx = () => {
  try { return JSON.parse(localStorage.getItem(STORAGE.tableCtx)) || null; }
  catch { return null; }
};

/**
 * Table identity is only ever trusted after the backend confirms the
 * (tableNo, token) pair from a scanned QR — see tableController.validateTableToken.
 * A manually-typed table number, or a URL with no/invalid token, never
 * reaches "verified" state and dine-in ordering stays unavailable.
 */
export function useTableSession() {
  const [ctx, setCtx]         = useState(readCtx); // { tableNo, label, tableToken, verified }
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const params  = new URLSearchParams(window.location.search);
    const tableNo = params.get("table");
    const token   = params.get("t");
    if (!tableNo || !token) return; // no QR context in this URL — keep whatever was stored, if anything

    setChecking(true);
    validateTable(tableNo, token)
      .then(({ data }) => {
        if (data.valid) {
          const next = { tableNo: data.tableNo, label: data.label || `Table ${data.tableNo}`, tableToken: token, verified: true };
          localStorage.setItem(STORAGE.tableCtx, JSON.stringify(next));
          setCtx(next);
        } else {
          localStorage.removeItem(STORAGE.tableCtx);
          setCtx(null);
        }
      })
      .catch(() => { /* network hiccup — keep previously verified ctx if any */ })
      .finally(() => setChecking(false));
  }, []);

  const clearTable = useCallback(() => {
    localStorage.removeItem(STORAGE.tableCtx);
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
