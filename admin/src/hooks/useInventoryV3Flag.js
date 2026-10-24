import { useEffect, useState } from "react";
import { v3Get } from "../services/inventoryV3Service.js";
export function useInventoryV3Flag() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (import.meta.env.VITE_INVENTORY_V3 !== "true") return;
    let active = true;
    const refresh = () => v3Get("capabilities").then((r) => { if (active) setEnabled(r.enabled === true); }).catch(() => { if (active) setEnabled(false); });
    refresh(); const timer = setInterval(refresh, 10000); window.addEventListener("focus", refresh);
    return () => { active = false; clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);
  return enabled;
}
