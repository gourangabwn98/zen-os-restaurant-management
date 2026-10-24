import { lazy, Suspense } from "react";
import InventoryPage from "./InventoryPage.jsx";
import { useInventoryV3Flag } from "../../hooks/useInventoryV3Flag.js";
const InventoryV3Page = lazy(() => import("./inventory-v3/InventoryV3Page.jsx"));
export default function InventoryEntry(props) {
  const enabled = useInventoryV3Flag();
  return enabled ? <Suspense fallback={<p role="status">Loading inventory…</p>}><InventoryV3Page {...props} /></Suspense> : <InventoryPage {...props} />;
}
