import { useCallback, useEffect, useState } from "react";
import { getRestaurantProfile } from "../services/restaurantService.js";

const initial = { status: "checking", profile: null, coords: null, distanceMeters: null, radiusMeters: null, message: "Checking whether ordering is available…" };

const validConfig = (profile) => {
  const latitude = Number(profile?.latitude);
  const longitude = Number(profile?.longitude);
  const radiusMeters = Number(profile?.dineInRange);
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
    && Number.isFinite(radiusMeters) && radiusMeters >= 0;
};

const distanceMeters = (a, b) => {
  const r = 6371000;
  const lat1 = a.latitude * Math.PI / 180;
  const lat2 = b.latitude * Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * Math.PI / 180;
  const dLon = (b.longitude - a.longitude) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(Math.min(1, h)));
};

export function useLocationGate() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState(initial);

  useEffect(() => {
    let live = true;
    setState(initial);
    getRestaurantProfile().then(({ data }) => {
      const profile = data?.data || {};
      if (!live) return;
      if (!validConfig(profile)) {
        setState({ ...initial, status: "unavailable", profile, message: "Ordering availability cannot be verified right now. Please try again later." });
        return;
      }
      if (!navigator.geolocation) {
        setState({ ...initial, status: "unsupported", profile, message: "This browser cannot verify your location. Please use a browser with location access." });
        return;
      }
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          if (!live) return;
          const customer = { latitude: Number(coords.latitude), longitude: Number(coords.longitude) };
          const restaurant = { latitude: Number(profile.latitude), longitude: Number(profile.longitude) };
          const distance = distanceMeters(customer, restaurant);
          const radius = Number(profile.dineInRange);
          const allowed = distance <= radius;
          setState({ status: allowed ? "allowed" : "outside", profile, coords: customer, distanceMeters: distance, radiusMeters: radius,
            message: allowed ? "Your location is within the restaurant's ordering area." : "You are outside the restaurant's permitted ordering area. Please move closer to the restaurant to place your order." });
        },
        (error) => {
          if (!live) return;
          const status = error.code === 1 ? "denied" : error.code === 3 ? "timeout" : "error";
          const message = status === "denied"
            ? "Location access is needed to verify dine-in ordering. Enable it in your browser settings, then try again."
            : status === "timeout" ? "We could not get your location in time. Please try again."
            : "We could not verify your location. Please try again.";
          setState({ ...initial, status, profile, message });
        },
        { enableHighAccuracy: false, maximumAge: 120000, timeout: 10000 },
      );
    }).catch(() => {
      if (live) setState({ ...initial, status: "unavailable", message: "Ordering availability cannot be verified right now. Please try again later." });
    });
    return () => { live = false; };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}
