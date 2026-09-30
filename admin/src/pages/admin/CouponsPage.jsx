// src/pages/admin/CouponsPage.jsx
// Discount coupons customers apply in the customer app's cart. Each coupon
// has a date window: customers see and can use it only from its start date
// to its end date (inclusive), judged by the server clock — so several
// seasonal coupons (e.g. Puja 10–15 Oct, Special 20–30 Oct) can be set up in
// advance and each appears/disappears on its own. "Pause" hides one early.
// The discount is always computed by the server when the order is placed
// (restaurant-server/services/couponService.js); nothing here is trusted
// from the customer's side.
import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import PageHeader from "./shared/PageHeader.jsx";
import {
  getAllCoupons, createCoupon, updateCoupon, deleteCoupon,
} from "../../services/couponService.js";

// Mirrors the server rule (couponService.normalizeCouponCode).
const COUPON_RE = /^[A-Z0-9_-]{3,20}$/;

const pad = (n) => String(n).padStart(2, "0");
/** Date → <input type="date"> value in the admin's local time. */
const toDateInput = (d) => (d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : "");
/** A start date means from 00:00 that day; an end date means until 23:59:59
 * that day — both in the admin's local time, sent to the server as ISO. */
const startOfDay = (v) => (v ? new Date(`${v}T00:00:00`) : null);
const endOfDay = (v) => (v ? new Date(`${v}T23:59:59.999`) : null);
const fmtDay = (d) => new Date(d).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });

const EMPTY = {
  code: "", title: "", description: "", discountType: "PERCENT", discountValue: "",
  maxDiscount: "", minOrderAmount: "", start: "", end: "", isActive: true,
};

/** Where a coupon is in its life right now. */
const stateOf = (c, now) => {
  if (!c.isActive) return { cls: "done", label: "Paused" };
  if (now < new Date(c.startsAt).getTime()) return { cls: "vio", label: "Upcoming" };
  if (now > new Date(c.endsAt).getTime()) return { cls: "stop", label: "Expired" };
  return { cls: "ready", label: "Live" };
};

const describeDiscount = (c) =>
  c.discountType === "PERCENT"
    ? `${c.discountValue}% off${c.maxDiscount ? ` (up to ₹${c.maxDiscount})` : ""}`
    : `₹${c.discountValue} off`;

export default function CouponsPage() {
  const [coupons, setCoupons] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(() => {
    getAllCoupons()
      .then(({ data }) => setCoupons(data.coupons || []))
      .catch(() => { setCoupons([]); toast.error("Couldn't load coupons"); });
  }, []);
  useEffect(() => { load(); }, [load]);
  // Keep Live/Upcoming/Expired labels current while the page stays open.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const isPercent = form.discountType === "PERCENT";
  const value = Number(form.discountValue);
  const errors = {
    code: form.code && !COUPON_RE.test(form.code) ? "3–20 characters: letters, numbers, - or _" : "",
    value: form.discountValue === "" ? ""
      : isPercent && !(value >= 1 && value <= 100) ? "Enter a % from 1 to 100"
      : !isPercent && !(value >= 1) ? "Enter an amount of at least ₹1" : "",
    dates: form.start && form.end && form.end < form.start ? "End date must be on or after the start date" : "",
  };
  const canSave = form.code && form.title.trim() && form.discountValue !== "" && form.start && form.end
    && !errors.code && !errors.value && !errors.dates && !saving;

  const reset = () => { setForm(EMPTY); setEditingId(null); };

  const startEdit = (c) => {
    setEditingId(c._id);
    setForm({
      code: c.code, title: c.title, description: c.description || "",
      discountType: c.discountType, discountValue: String(c.discountValue),
      maxDiscount: c.maxDiscount ? String(c.maxDiscount) : "", minOrderAmount: c.minOrderAmount ? String(c.minOrderAmount) : "",
      start: toDateInput(new Date(c.startsAt)), end: toDateInput(new Date(c.endsAt)), isActive: c.isActive,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    const payload = {
      code: form.code, title: form.title.trim(), description: form.description.trim(),
      discountType: form.discountType, discountValue: Number(form.discountValue),
      maxDiscount: isPercent && form.maxDiscount !== "" ? Number(form.maxDiscount) : null,
      minOrderAmount: form.minOrderAmount !== "" ? Number(form.minOrderAmount) : 0,
      startsAt: startOfDay(form.start).toISOString(), endsAt: endOfDay(form.end).toISOString(),
      isActive: form.isActive,
    };
    try {
      if (editingId) await updateCoupon(editingId, payload);
      else await createCoupon(payload);
      toast.success(editingId ? "Coupon updated" : "Coupon created");
      reset();
      load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Couldn't save the coupon");
    } finally {
      setSaving(false);
    }
  };

  const togglePause = async (c) => {
    try {
      await updateCoupon(c._id, { isActive: !c.isActive });
      toast.success(c.isActive ? `${c.code} paused` : `${c.code} resumed`);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Couldn't update the coupon");
    }
  };

  const handleDelete = async (c) => {
    if (!window.confirm(`Delete coupon ${c.code}? Orders already placed with it keep their discount.`)) return;
    try {
      await deleteCoupon(c._id);
      toast.success("Coupon deleted");
      if (editingId === c._id) reset();
      load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Couldn't delete the coupon");
    }
  };

  const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-2)", marginBottom: 6 };
  const hintStyle = (bad) => ({ fontSize: 11.5, marginTop: 5, color: bad ? "var(--danger, #d33)" : "var(--text-3)" });
  const opt = <span style={{ fontWeight: 400, color: "var(--text-3)" }}>(optional)</span>;
  const field = { flex: "1 1 200px", maxWidth: 260 };
  const live = (coupons || []).filter((c) => stateOf(c, now).label === "Live").length;

  return (
    <div>
      <PageHeader title="Coupons" sub="Discount codes customers can apply in their cart — each one is shown only between its start and end date" />

      <div className="zc-card" style={{ marginBottom: 20 }}>
        <div className="zc-card-h">
          <span className="t">{editingId ? `Edit coupon ${form.code}` : "Create a coupon"}</span>
          {editingId && <button type="button" className="zc-btn ghost sm" onClick={reset}>Cancel editing</button>}
        </div>
        <div className="zc-card-b" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <div style={field}>
              <label htmlFor="cp-code" style={labelStyle}>Coupon code</label>
              <input
                id="cp-code" className="zc-input" placeholder="e.g. PUJA20" value={form.code} maxLength={20}
                autoComplete="off" spellCheck={false} aria-invalid={!!errors.code}
                style={{ textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 600 }}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase().replace(/\s/g, "") }))}
              />
              <div style={hintStyle(!!errors.code)}>{errors.code || "What the customer types or taps to apply."}</div>
            </div>
            <div style={{ flex: "2 1 280px" }}>
              <label htmlFor="cp-title" style={labelStyle}>Title</label>
              <input id="cp-title" className="zc-input" placeholder="e.g. Puja offer" value={form.title} maxLength={60} onChange={set("title")} />
            </div>
          </div>

          <div>
            <label htmlFor="cp-desc" style={labelStyle}>Description {opt}</label>
            <input id="cp-desc" className="zc-input" placeholder="e.g. Celebrate Puja with 20% off your meal" value={form.description} maxLength={200} onChange={set("description")} />
          </div>

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <div style={field}>
              <label htmlFor="cp-type" style={labelStyle}>Discount type</label>
              <select id="cp-type" className="zc-select" value={form.discountType} onChange={set("discountType")} style={{ width: "100%" }}>
                <option value="PERCENT">Percentage (%)</option>
                <option value="FLAT">Flat amount (₹)</option>
              </select>
            </div>
            <div style={field}>
              <label htmlFor="cp-value" style={labelStyle}>{isPercent ? "Discount %" : "Discount ₹"}</label>
              <input
                id="cp-value" type="number" inputMode="numeric" min={1} max={isPercent ? 100 : undefined}
                className="zc-input" placeholder={isPercent ? "e.g. 20" : "e.g. 50"} value={form.discountValue}
                aria-invalid={!!errors.value} onChange={set("discountValue")}
              />
              {errors.value && <div style={hintStyle(true)}>{errors.value}</div>}
            </div>
            {isPercent && (
              <div style={field}>
                <label htmlFor="cp-max" style={labelStyle}>Max discount ₹ {opt}</label>
                <input id="cp-max" type="number" inputMode="numeric" min={1} className="zc-input" placeholder="No limit" value={form.maxDiscount} onChange={set("maxDiscount")} />
              </div>
            )}
            <div style={field}>
              <label htmlFor="cp-min" style={labelStyle}>Minimum order ₹ {opt}</label>
              <input id="cp-min" type="number" inputMode="numeric" min={0} className="zc-input" placeholder="No minimum" value={form.minOrderAmount} onChange={set("minOrderAmount")} />
              <div style={hintStyle(false)}>On the item total, before GST.</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
            <div style={field}>
              <label htmlFor="cp-start" style={labelStyle}>Start date</label>
              <input id="cp-start" type="date" className="zc-input" value={form.start} onChange={set("start")} />
              <div style={hintStyle(false)}>Customers see it from 12:00 AM this day.</div>
            </div>
            <div style={field}>
              <label htmlFor="cp-end" style={labelStyle}>End date</label>
              <input id="cp-end" type="date" className="zc-input" value={form.end} min={form.start || undefined} aria-invalid={!!errors.dates} onChange={set("end")} />
              <div style={hintStyle(!!errors.dates)}>{errors.dates || "…until 11:59 PM this day."}</div>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 28, cursor: "pointer" }}>
              <input type="checkbox" checked={form.isActive} onChange={set("isActive")} />
              Active (untick to pause)
            </label>
          </div>

          <div>
            <button type="button" className="zc-btn pri" disabled={!canSave} onClick={handleSave}>
              {saving ? "Saving…" : editingId ? "Save changes" : "🎟️ Create coupon"}
            </button>
          </div>
        </div>
      </div>

      <div className="zc-card">
        <div className="zc-card-h">
          <span className="t">All coupons</span>
          <span className="s">{live} live now</span>
        </div>
        <div className="zc-card-b" style={{ padding: 0 }}>
          {coupons === null ? (
            <div style={{ padding: 20, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>Loading…</div>
          ) : coupons.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>No coupons yet</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="zc-ledger" style={{ minWidth: 900 }}>
                <thead>
                  <tr>
                    <th style={{ width: 100 }}>Status</th>
                    <th style={{ width: 120 }}>Code</th>
                    <th>Title</th>
                    <th style={{ width: 170 }}>Discount</th>
                    <th style={{ width: 100 }}>Min order</th>
                    <th style={{ width: 210 }}>Valid</th>
                    <th style={{ width: 200 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {coupons.map((c) => {
                    const st = stateOf(c, now);
                    return (
                      <tr key={c._id}>
                        <td><span className={`zc-tag ${st.cls}`}><i />{st.label}</span></td>
                        <td style={{ fontWeight: 700, letterSpacing: ".04em" }}>{c.code}</td>
                        <td>
                          {c.title}
                          {c.description && <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2 }}>{c.description}</div>}
                        </td>
                        <td>{describeDiscount(c)}</td>
                        <td>{c.minOrderAmount ? `₹${c.minOrderAmount}` : "—"}</td>
                        <td>{fmtDay(c.startsAt)} – {fmtDay(c.endsAt)}</td>
                        <td>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button type="button" className="zc-btn sm" onClick={() => startEdit(c)}>Edit</button>
                            <button type="button" className="zc-btn sm" onClick={() => togglePause(c)}>{c.isActive ? "Pause" : "Resume"}</button>
                            <button type="button" className="zc-btn ghost sm" onClick={() => handleDelete(c)}>Delete</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
