// src/utils/googleMaps.js — loads the Google Maps JavaScript API once, only
// when a key is configured (config/runtimeConfig.js GOOGLE_MAPS_KEY). No npm
// dependency: the official script tag. Resolves to `google.maps`, or null when
// there is no key / the script fails (callers then show the schematic view).
import { GOOGLE_MAPS_KEY } from "../config/runtimeConfig.js";

let loading = null;

export const hasMapsKey = () => !!GOOGLE_MAPS_KEY;

export const loadGoogleMaps = () => {
  if (!GOOGLE_MAPS_KEY) return Promise.resolve(null);
  if (window.google?.maps?.Map) return Promise.resolve(window.google.maps);
  if (loading) return loading;
  loading = new Promise((resolve) => {
    const cb = `__zenMapsReady${Date.now()}`;
    window[cb] = () => { delete window[cb]; resolve(window.google?.maps || null); };
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_KEY)}&callback=${cb}&loading=async`;
    s.async = true;
    s.onerror = () => { loading = null; resolve(null); };
    document.head.appendChild(s);
  });
  return loading;
};
