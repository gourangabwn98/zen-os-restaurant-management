// Cart-side preview of a coupon. Mirrors the server's computeCouponDiscount
// (restaurant-server/utils/pricing.js) so the cart shows the same saving —
// but only for display: the server re-validates the code and computes the
// real discount when the order is placed.

/** ₹ off `subtotal`; 0 below the coupon's minimum order. */
export const couponDiscount = (c, subtotal) => {
  if (!c || !(subtotal > 0) || subtotal < (c.minOrderAmount || 0)) return 0;
  let off = c.discountType === "PERCENT" ? Math.round((subtotal * c.discountValue) / 100) : Math.round(c.discountValue);
  if (c.discountType === "PERCENT" && c.maxDiscount > 0) off = Math.min(off, c.maxDiscount);
  return Math.max(0, Math.min(off, subtotal));
};

/** ₹ still to add before the coupon applies (0 = eligible). */
export const couponShortfall = (c, subtotal) => Math.max(0, (c?.minOrderAmount || 0) - subtotal);

/** "20% off up to ₹100" / "Flat ₹50 off". */
export const describeCoupon = (c) => c.discountType === "PERCENT"
  ? `${c.discountValue}% off${c.maxDiscount ? ` up to ₹${c.maxDiscount}` : ""}`
  : `Flat ₹${c.discountValue} off`;

/** "Valid till 30 Oct" — the last day it can be used. */
export const couponValidTill = (c) =>
  `Valid till ${new Date(c.endsAt).toLocaleDateString([], { day: "numeric", month: "short" })}`;
