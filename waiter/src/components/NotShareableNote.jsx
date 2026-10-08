// KH-05 — red "Thali not shareable" note under an item whose category the
// admin marked "Not shareable" (GET /menu sets item.notShareableCategory).
// Renders nothing for every other item.
import { RED } from "../theme.js";
import { t } from "../i18n/index.jsx";

export default function NotShareableNote({ item }) {
  if (!item?.notShareableCategory) return null;
  return (
    <div style={{ fontSize: 11.5, fontWeight: 700, color: RED, marginTop: 3 }}>
      {t("{name} not shareable", { name: item.notShareableCategory })}
    </div>
  );
}
