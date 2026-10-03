// src/pages/admin/offers/Ideas.jsx
// "Ideas for this week" — only ideas backed by a real signal from
// GET /coupons/admin/stats (reach, a minimum above most bills, customers who
// stopped coming, nothing running). No estimates of extra sales are shown:
// with this much data any range would only look precise. "Use this" fills
// the composer; nothing is saved until the admin reviews it. The ideas
// themselves are built in model.js (buildIdeas).
import { t } from "../../../i18n/core.js";

export default function Ideas({ ideas, onUse }) {
  return (
    <div>
      <div className="ofr-sech">
        <span className="t">{t("Ideas for this week")}</span>
        <span className="ofr-hint">{t("from your own orders and customers · nothing is sent until you review it")}</span>
      </div>
      {ideas.length === 0 ? (
        <div className="zc-card ofr-empty" style={{ padding: "18px 14px" }}>
          <b>{t("Nothing needs your attention")}</b>{t("Your offers reach most bills and customers are coming back.")}
        </div>
      ) : (
        <div className="ofr-ideas">
          {ideas.map((d) => (
            <div key={d.key} className="zc-card ofr-idea">
              <span className={`zc-tag ${d.tag[1]}`} style={{ alignSelf: "flex-start" }}>{t(d.tag[0])}</span>
              <b className="it">{d.title}</b>
              <p>{d.why}</p>
              {d.action && (
                <div className="foot">
                  <button type="button" className="zc-btn sm pri" onClick={() => onUse(d.action)}>{t(d.action.label)}</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
