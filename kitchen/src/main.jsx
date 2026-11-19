import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./fonts/fonts.css"; // self-hosted, works offline
import "./index.css";
import { registerPwa } from "./pwa/registerPwa.js";
import UpdatePrompt from "./pwa/UpdatePrompt.jsx";
import OfflineBanner from "./offline/OfflineBanner.jsx";

// App shell works offline; a new deploy waits for "Reload" (src/pwa/).
registerPwa();
ReactDOM.createRoot(document.getElementById("root")).render(<React.StrictMode><App /><UpdatePrompt /><OfflineBanner /></React.StrictMode>);
