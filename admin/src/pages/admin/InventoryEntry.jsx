import { lazy, Suspense } from "react";
import InventoryPage from "./InventoryPage.jsx";
import { useInventoryV3Flag } from "../../hooks/useInventoryV3Flag.js";
import { useAuth } from "../../hooks/useAuth.js";
const InventoryV3Page = lazy(() => import("./inventory-v3/InventoryV3Page.jsx"));
const InventoryManagerPage = lazy(() => import("./inventory-manager/InventoryManagerPage.jsx"));
export default function InventoryEntry(props) {
  const { user } = useAuth();
  const enabled = useInventoryV3Flag();
  const manager = user && !user.isAdmin && user.role === "inventory_manager";
  if (manager) return <Suspense fallback={<p role="status">Loading inventory…</p>}><InventoryManagerPage {...props} /></Suspense>;
  return enabled ? <Suspense fallback={<p role="status">Loading inventory…</p>}><InventoryV3Page {...props} /></Suspense> : <InventoryPage {...props} />;
}
