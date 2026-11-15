// Runtime settings for this app — loaded by index.html before the app itself.
// This file is copied to the build output as-is (not bundled), so it can be
// edited on the server after deploying, with no rebuild.
//
// Leave apiUrl unset to use VITE_API_URL from the build (.env), or "/api"
// (same origin) if that is empty too. Examples:
//   apiUrl: "https://zen-os-backend.onrender.com/api"   // cloud backend
//   apiUrl: "/api"                                      // backend on the same address as this app
window.__ZEN_CONFIG__ = Object.assign({
  // apiUrl: "/api",
}, window.__ZEN_CONFIG__);
