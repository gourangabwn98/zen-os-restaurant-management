// src/pages/admin/employees/ReviewsTab.jsx
// What customers said about this person (rated in the customer app after
// paying). Complaints (≤2★ or a negative tag) are closed with "Mark as
// looked into" + what was done.
import { useEffect, useState, useCallback } from "react";
import toast from "react-hot-toast";
import { getEmployeeReviews, markReviewLookedInto } from "../../../services/adminService.js";
import { Loader, Badge, EmptyState } from "../shared/index.js";
import ErrorState from "../shared/ErrorState.jsx";
import { t, N_, fmtNum, fmtDate } from "../../../i18n/core.js";

const FILTERS = [
  { key: "all", label: N_("All") },
  { key: "praise", label: N_("Praise") },
  { key: "complaints", label: N_("Complaints") },
];
// Tag / note keys are English values stored by the server; shown translated.
N_("Tasty"); N_("Hot"); N_("Fresh"); N_("Good portion"); N_("Cold food"); N_("Too salty"); N_("Too spicy"); N_("Late");
N_("Friendly"); N_("Helpful"); N_("Fast"); N_("Slow"); N_("Rude"); N_("Wrong order");
N_("Spoke to staff"); N_("Customer called back"); N_("Not staff's fault");

export const Stars = ({ value, size = 13 }) => (
  <span className="emp-stars" style={{ fontSize: size }} aria-label={t("{n} out of 5 stars", { n: fmtNum(value) })}>
    {"★".repeat(value)}<i>{"★".repeat(5 - value)}</i>
  </span>
);

export default function ReviewsTab({ employee, onChanged }) {
  const [filter, setFilter] = useState("all");
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [openId, setOpenId] = useState(null); // complaint whose "what did you do?" chips are showing
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    setError(false);
    getEmployeeReviews(employee._id, { filter })
      .then(({ data: d }) => setData(d))
      .catch(() => setError(true));
  }, [employee._id, filter]);
  useEffect(() => { load(); }, [load]);

  const lookedInto = async (review, note) => {
    setBusy(review._id);
    try {
      await markReviewLookedInto(review._id, note);
      toast.success(t("Complaint marked as looked into"));
      setOpenId(null);
      load();
      onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.message || t("Update failed"));
    } finally { setBusy(null); }
  };

  if (error) return <ErrorState onRetry={load} />;
  if (!data) return <Loader rows={4} />;
  const { summary, reviews, lookedIntoNotes = [], tags = {} } = data;
  const badTags = new Set([...(tags.FOOD?.bad || []), ...(tags.SERVICE?.bad || [])]);
  const isChef = employee.role === "chef";

  return (
    <div>
      <div className="emp-tabhead">
        <h4>
          {t("What customers said")}
          {summary.count > 0 && <> · {fmtNum(summary.avg)} ★ {t("average")} · {fmtNum(summary.count)}</>}
        </h4>
        <div className="zc-seg">
          {FILTERS.map((f) => (
            <button type="button" key={f.key} className={filter === f.key ? "on" : ""} onClick={() => setFilter(f.key)}>{t(f.label)}</button>
          ))}
        </div>
      </div>

      {reviews.length === 0 ? (
        <EmptyState
          title={summary.count === 0 ? t("No reviews yet") : t("Nothing in this view")}
          sub={summary.count === 0 ? t("Customers rate the food and the service in the customer app right after they pay.") : undefined}
        />
      ) : (
        <div className="emp-revs">
          {reviews.map((r) => (
            <div key={r._id} className={`zc-panel emp-rv${r.complaint ? " bad" : ""}`}>
              <div className="emp-rv-top">
                <span className="emp-rv-tags">
                  <Stars value={r.rating} />
                  <Badge label={r.kind === "FOOD" ? N_("Food") : N_("Service")} kind="vio" dot={false} />
                  {r.tags.map((tg) => <Badge key={tg} label={tg} kind={badTags.has(tg) ? "stop" : "ready"} dot={false} />)}
                </span>
                <span className="emp-hint">
                  {r.customerName}{r.tableNo ? ` · ${t("T{n}", { n: fmtNum(r.tableNo) })}` : ""}{r.orderNo ? ` · ${r.orderNo}` : ""} · {fmtDate(r.createdAt, { day: "numeric", month: "short" })}
                </span>
              </div>
              {r.comment && <p className="emp-rv-text">“{r.comment}”</p>}
              {r.complaint && (
                <div className="emp-rv-act">
                  {r.lookedInto ? (
                    <>
                      <Badge label={N_("Looked into")} kind="ready" />
                      <span className="emp-hint">{t(r.lookedInto.note)} · {r.lookedInto.by?.name || t("Admin")} · {fmtDate(r.lookedInto.at, { day: "numeric", month: "short" })}</span>
                    </>
                  ) : openId === r._id ? (
                    <>
                      <span className="emp-hint">{t("What did you do?")}</span>
                      {lookedIntoNotes.map((n) => (
                        <button type="button" key={n} className="zc-btn sm ghost" disabled={busy === r._id} onClick={() => lookedInto(r, n)}>{t(n)}</button>
                      ))}
                    </>
                  ) : (
                    <button type="button" className="zc-btn sm pri" onClick={() => setOpenId(r._id)}>{t("Mark as looked into")}</button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="emp-hint" style={{ marginTop: 12 }}>
        {isChef
          ? t("Food ratings, from orders this chef marked ready on the Kitchen Display.")
          : t("Service ratings, from tables where this waiter took the order.")}
      </p>
    </div>
  );
}
