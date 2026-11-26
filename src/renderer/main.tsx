import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/vazirmatn/400.css";
import "@fontsource/vazirmatn/500.css";
import "@fontsource/vazirmatn/700.css";
import "./styles/base.css";
import "./styles/app.css";
import "./styles/timeline.css";
import "./styles/preview.css";
import App from "./App";

const container = document.getElementById("root");
if (!container) throw new Error("renderer root element is missing");

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Hand over from the static boot splash to the React splash once the first
// paint has happened, so the window never flashes empty content.
requestAnimationFrame(() => {
  window.setTimeout(() => {
    const splash = document.getElementById("boot-splash");
    if (!splash) return;
    splash.style.opacity = "0";
    window.setTimeout(() => splash.remove(), 420);
  }, 120);
});
