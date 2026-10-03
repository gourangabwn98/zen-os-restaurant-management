import { useEffect, useState } from "react";
import Sheet from "./ui/Sheet.jsx";
import { getLiveCoupons, checkCoupon } from "../services/couponService.js";
import { couponDiscount, couponShortfall, describeCoupon, couponValidTill } from "../utils/coupon.js";

/** One coupon as a ticket: code, what it gives, conditions, and an action. */
export function CouponTicket({ coupon, subtotal, applied, onApply, onLogin }) {
  const short = subtotal == null ? 0 : couponShortfall(coupon, subtotal);
  const save = subtotal == null ? 0 : couponDiscount(coupon, subtotal);
  return (
    <div className={`coupon${applied ? " on" : ""}${short ? " locked" : ""}`}>
      <div className="coupon-side" aria-hidden="true">{coupon.discountType === "PERCENT" ? `${coupon.discountValue}%` : `₹${coupon.discountValue}`}<small>OFF</small></div>
      <div className="coupon-main">
        <div className="coupon-top">
          <b className="coupon-code">{coupon.code}</b>
          {onApply && (
            applied
              ? <span className="coupon-tag">Applied</span>
              // Guests see every coupon but can't apply one (server: LOGIN_REQUIRED).
              : coupon.loginRequired && onLogin
                ? <button type="button" className="link-btn" onClick={onLogin}>Log in to use</button>
                : <button type="button" className="link-btn" disabled={Boolean(short)} onClick={() => onApply(coupon)}>Apply</button>
          )}
        </div>
        <div className="coupon-title">{coupon.title} · {describeCoupon(coupon)}</div>
        {coupon.audience === "REGISTERED" && <div className="coupon-hint member">★ Members-only offer</div>}
        {coupon.description && <div className="muted small">{coupon.description}</div>}
        {short > 0
          ? <div className="coupon-hint warn">Add ₹{short} more to unlock</div>
          : save > 0 ? <div className="coupon-hint ok">You save ₹{save} on this order</div> : null}
        <div className="muted tiny">
          {coupon.minOrderAmount ? `Min order ₹${coupon.minOrderAmount} · ` : ""}{couponValidTill(coupon)}
        </div>
      </div>
    </div>
  );
}

/** "Apply coupon" sheet: type a code, or pick from every coupon that is live
 * right now (the server only returns coupons inside their date window). */
export default function CouponSheet({ subtotal, applied, onApply, onClose, loggedIn = true, onLogin }) {
  const [coupons, setCoupons] = useState(null);
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getLiveCoupons()
      .then(({ data }) => setCoupons(data.coupons || []))
      .catch(() => setCoupons([]));
  }, []);

  const applyTyped = async (e) => {
    e.preventDefault();
    if (!code.trim() || checking) return;
    setChecking(true); setError("");
    try {
      const { data } = await checkCoupon(code);
      const short = couponShortfall(data.coupon, subtotal);
      if (short) setError(`Add items worth ₹${short} more to use ${data.coupon.code}`);
      else onApply(data.coupon);
    } catch (err) {
      // Expired / not started / unknown / log in — the server's own words.
      setError(err.response?.data?.message || "Couldn't check this code — try again");
    } finally {
      setChecking(false);
    }
  };

  return (
    <Sheet onClose={onClose} label="Apply coupon">
      <h3>Apply coupon</h3>
      <form className="coupon-entry" onSubmit={applyTyped}>
        <input
          value={code} onChange={(e) => { setCode(e.target.value.toUpperCase().replace(/\s/g, "")); setError(""); }}
          placeholder="Enter coupon code" maxLength={20} autoComplete="off" spellCheck={false}
          aria-label="Coupon code" aria-invalid={Boolean(error)}
        />
        <button type="submit" className="link-btn" disabled={!code.trim() || checking}>{checking ? "Checking…" : "Apply"}</button>
      </form>
      {error && <p role="alert" className="small danger" style={{ margin: "6px 4px 0" }}>{error}</p>}
      {!loggedIn && (
        <div className="coupon-unlock" role="note">
          <span aria-hidden="true">🔒</span>
          <span className="grow">Please log in to use coupons. You can still order as a guest.</span>
          {onLogin && <button type="button" className="btn btn-primary sm" onClick={onLogin}>Log in</button>}
        </div>
      )}

      <div className="card-title" style={{ margin: "18px 0 8px" }}>Available coupons</div>
      {coupons === null && <p className="muted small">Loading coupons…</p>}
      {coupons?.length === 0 && <p className="muted small">No coupons available right now — check back during our next offer.</p>}
      <div className="coupon-list">
        {(coupons || []).map((c) => (
          <CouponTicket key={c.code} coupon={c} subtotal={subtotal} applied={applied?.code === c.code} onApply={onApply} onLogin={onLogin} />
        ))}
      </div>
    </Sheet>
  );
}
