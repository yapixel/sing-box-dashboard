import { createContext, useContext, useEffect, useState } from "react";

import type { DaemonApi } from "../api/daemon";

export const ApiContext = createContext<DaemonApi | null>(null);

export function useApi(): DaemonApi {
  const api = useContext(ApiContext);
  if (!api) {
    throw new Error("missing api context");
  }
  return api;
}

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function navigate(path: string) {
  location.hash = `#/${path}`;
}

// Must stay in sync with the mobile breakpoint in global.css.
const MOBILE_QUERY = "(max-width: 720px)";

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return isMobile;
}

export type ThemePreference = "auto" | "light" | "dark";

const THEME_KEY = "sing-box-dashboard.theme";

export function loadThemePreference(): ThemePreference {
  const value = localStorage.getItem(THEME_KEY);
  if (value === "light" || value === "dark") {
    return value;
  }
  return "auto";
}

export function saveThemePreference(preference: ThemePreference) {
  localStorage.setItem(THEME_KEY, preference);
}

export function applyTheme(preference: ThemePreference) {
  const dark =
    preference === "dark" ||
    (preference === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";

  // Keep theme-color in sync with the topbar surface for browsers that use
  // it (Chrome, Safari 15–18). Update both per-scheme metas so an explicit
  // preference wins over the media query the browser matched against.
  const surface = getComputedStyle(document.documentElement).getPropertyValue("--surface").trim();
  if (surface) {
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
      meta.setAttribute("content", surface);
    });
  }

  // iOS 26 Safari ignores theme-color and tints the status bar from the
  // .statusbar-tint probe (see global.css). It only samples a fixed element
  // when a new node enters the render tree: color changes on a registered
  // element go unnoticed, and removals are dropped too (WebKit bug 300965),
  // so display-toggling the same node nets out to nothing. Swap in a fresh
  // clone, and since even that may coalesce into a no-op if WebKit diffs the
  // fixed-element set by shape rather than node identity, also flash a twin
  // probe on top for two frames — the same insert-then-remove sequence as
  // the drawer scrim, which provably re-tints; its dropped removal leaves
  // the new color registered, which is exactly the color we want shown.
  const tint = document.getElementById("statusbar-tint");
  if (tint) {
    const fresh = tint.cloneNode(true) as HTMLElement;
    tint.replaceWith(fresh);
    const flash = fresh.cloneNode(true) as HTMLElement;
    flash.removeAttribute("id");
    document.body.appendChild(flash);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        flash.remove();
      });
    });
  }
}

export function watchSystemTheme(getPreference: () => ThemePreference): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => applyTheme(getPreference());
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
