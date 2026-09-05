// ─── src/main.jsx ─────────────────────────────────────────────────────────────
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import { ThemeProvider } from "./context/ThemeProvider.jsx";
import { Toaster } from "react-hot-toast";

import "./theme/tokens.css";
import "./theme/surfaces.css";

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
        <App />
      </ThemeProvider>
    </AuthProvider>
  </React.StrictMode>,
);
