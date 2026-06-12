import "@fontsource-variable/schibsted-grotesk";
import "@fontsource-variable/source-serif-4";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./styles/global.css";

// iOS Safari deliberately ignores user-scalable=no and touch-action for
// viewport pinch-zoom; cancelling WebKit's non-standard gesture events is the
// only way left to disable it. No-op everywhere else (the events never fire).
document.addEventListener("gesturestart", (e) => e.preventDefault());
document.addEventListener("gesturechange", (e) => e.preventDefault());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
