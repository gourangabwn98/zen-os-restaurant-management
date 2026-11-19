// Delivery address + map pin for home-delivery checkout. The pin is the
// device's GPS fix (the server checks it is inside the delivery range); the
// written address + landmark guide the rider to the door.
import { useState } from "react";

export const emptyDelivery = () => ({ address: "", landmark: "", contactName: "", contactPhone: "", latitude: null, longitude: null, accuracy: null });

export const deliveryProblem = (d) => {
  if (!d.address || d.address.trim().length < 5) return "Enter your full delivery address";
  if (d.latitude == null) return "Set your delivery location (tap “Use my current location”)";
  if (!/^\+?\d{10,15}$/.test(String(d.contactPhone).replace(/[\s-]/g, ""))) return "Enter a phone number the delivery partner can call";
  return null;
};

export default function DeliveryDetails({ value, onChange }) {
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState("");
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });

  const locate = () => {
    if (!navigator.geolocation) { setLocError("This browser can't share your location."); return; }
    setLocating(true); setLocError("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        onChange({ ...value, latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) });
      },
      (err) => {
        setLocating(false);
        setLocError(err.code === 1 ? "Location permission was denied — allow it in your browser settings to order delivery." : "Couldn't get your location. Move near a window and try again.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  return (
    <div className="card">
      <div className="card-title">Delivery details</div>
      <label className="small muted" htmlFor="dl-addr">House / flat, street, area</label>
      <textarea id="dl-addr" rows={2} value={value.address} onChange={set("address")} maxLength={300} placeholder="e.g. Flat 3B, 12 Park Street, near the post office" style={{ width: "100%", marginBottom: 8 }} />
      <label className="small muted" htmlFor="dl-lm">Landmark (optional)</label>
      <input id="dl-lm" value={value.landmark} onChange={set("landmark")} maxLength={120} placeholder="e.g. opposite the blue gate" style={{ width: "100%", marginBottom: 8 }} />
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <label className="small muted" htmlFor="dl-name">Name</label>
          <input id="dl-name" value={value.contactName} onChange={set("contactName")} maxLength={60} style={{ width: "100%" }} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="small muted" htmlFor="dl-ph">Phone for the rider</label>
          <input id="dl-ph" value={value.contactPhone} onChange={set("contactPhone")} inputMode="tel" maxLength={16} style={{ width: "100%" }} />
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        {value.latitude != null ? (
          <p className="small ok" style={{ margin: "0 0 6px" }}>📍 Location set{value.accuracy ? ` (accurate to about ${value.accuracy} m)` : ""}.</p>
        ) : (
          <p className="small muted" style={{ margin: "0 0 6px" }}>We need your location so the rider can find you and to check you're in our delivery area.</p>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={locate} disabled={locating}>
          {locating ? "Getting your location…" : value.latitude != null ? "Update my location" : "📍 Use my current location"}
        </button>
        {locError && <p className="small danger" style={{ margin: "6px 0 0" }}>{locError}</p>}
        {value.accuracy > 200 && <p className="small muted" style={{ margin: "6px 0 0" }}>Your location is approximate — please make the address and landmark clear.</p>}
      </div>
    </div>
  );
}
