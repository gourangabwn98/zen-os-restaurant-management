import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { installOffer, subscribeInstall, runInstall, dismissInstall } from "../services/installPrompt.js";
import { BRAND } from "../brand.js";

/** First QR visit: a small, dismissible "Install the app" card at the top —
 * never blocks ordering, appears a few seconds after landing, and only when
 * the browser really can install (services/installPrompt.js). */
export default function InstallPrompt() {
  const { pathname } = useLocation();
  const [offer, setOffer] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setReady(true), 4000);
    const update = () => setOffer(installOffer());
    update();
    const off = subscribeInstall(update);
    return () => { clearTimeout(t); off(); };
  }, []);

  if (!ready || !offer || pathname === "/cart" || pathname === "/login") return null;

  return (
    <div className="install-card" role="dialog" aria-label="Install the app">
      {/* CUS-01: Hotel KHOAI logo, never a blank/generic icon */}
      <img src={BRAND.mark} alt={BRAND.name} width="40" height="40" />
      <div className="grow">
        <b>Add {BRAND.name} to your phone</b>
        <span>{offer === "ios"
          ? <>Tap <b>Share</b> <span aria-hidden="true">⎋</span> then <b>Add to Home Screen</b> — order faster next time.</>
          : "Order faster next time, straight from your home screen."}</span>
      </div>
      {offer === "prompt" && <button type="button" className="btn btn-primary sm" onClick={() => runInstall()}>Install</button>}
      <button type="button" className="install-x" aria-label="Not now" onClick={dismissInstall}>✕</button>
    </div>
  );
}
