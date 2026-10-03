import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import { initInstallPrompt } from "./services/installPrompt.js";

// Before React: the browser may offer installation right away.
initInstallPrompt();
ReactDOM.createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
