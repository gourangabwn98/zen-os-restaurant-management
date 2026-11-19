// ─── src/main.jsx ─────────────────────────────────────────────────────────────
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import { ThemeProvider } from "./context/ThemeProvider.jsx";
import { LanguageProvider } from "./i18n/LanguageProvider.jsx";
import { Toaster } from "react-hot-toast";
import { registerPwa } from "./pwa/registerPwa.js";
import UpdatePrompt from "./pwa/UpdatePrompt.jsx";
import OfflineBanner from "./offline/OfflineBanner.jsx";

import "./fonts/fonts.css"; // self-hosted, works offline
import "./theme/tokens.css";
import "./theme/surfaces.css";

// A focused number box (menu price, inventory qty…) changes its value when
// the mouse wheel turns over it — scrolling the form silently edited prices.
// Dropping focus before the browser applies the wheel stops that; the page
// still scrolls normally and typing in the box is unaffected.
document.addEventListener("wheel", (e) => {
  const el = document.activeElement;
  if (el?.tagName === "INPUT" && el.type === "number" && el === e.target) el.blur();
}, { passive: true });

// App shell works offline; a new deploy waits for "Reload" (src/pwa/).
registerPwa();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuthProvider>
      <ThemeProvider>
        <Toaster
          position="top-center"
          toastOptions={{
            duration: 2500,
            style: { borderRadius: 12, fontWeight: 600 },
          }}
        />
        <LanguageProvider>
          <App />
          <UpdatePrompt />
          <OfflineBanner />
        </LanguageProvider>
      </ThemeProvider>
    </AuthProvider>
  </React.StrictMode>,
);
