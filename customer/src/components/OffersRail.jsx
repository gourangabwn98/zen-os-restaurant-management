import { Link } from "react-router-dom";
import toast from "react-hot-toast";

const big = (c) => (c.discountType === "PERCENT" ? `${c.discountValue}% OFF` : `₹${c.discountValue} OFF`);
const till = (c) => new Date(c.endsAt).toLocaleDateString([], { day: "numeric", month: "short" });

/** CUS-03 — coupons live right now as a scrollable poster rail on Home.
 * GET /api/coupons only returns ones inside their start/end time and meant
 * for this customer (audience) — nothing here is invented. Hidden when none. */
export default function OffersRail({ offers = [] }) {
  if (!offers.length) return null;
  const copy = async (code) => {
    try { await navigator.clipboard.writeText(code); toast.success(`Code ${code} copied`); }
    catch { toast(`Use code ${code} in your cart`); }
  };
  return (
    <section aria-label="Offers">
      <div className="sec-h">
        <h3>Offers for you</h3>
        <Link to="/offers" className="link">All offers</Link>
      </div>
      <div className="offer-rail">
        {offers.map((c) => (
          <article key={c.code} className="offer-poster">
            <span className="op-big">{big(c)}</span>
            <b className="op-title">{c.title}</b>
            <span className="op-sub">{c.minOrderAmount ? `On orders above ₹${c.minOrderAmount}` : "On your whole order"} · till {till(c)}</span>
            <button type="button" className="op-code" onClick={() => copy(c.code)} aria-label={`Copy code ${c.code}`}>
              {c.code}<span aria-hidden="true"> · Copy</span>
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
