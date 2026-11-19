// Status pill for Admin → Delivery (labels/tones from ./shared.js).
import { t } from "../../../i18n/core.js";

const DeliveryTag = ({ map, value }) => {
  const s = map[value] || { label: value, tone: "done" };
  return <span className={`zc-tag ${s.tone}`}>{t(s.label)}</span>;
};

export default DeliveryTag;
