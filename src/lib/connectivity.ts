// Browsers deliberately report every network-layer fetch failure as one
// opaque TypeError (Chromium "Failed to fetch", WebKit "Load failed",
// Firefox "NetworkError..."): letting a page distinguish "host is down"
// from "blocked by CORS" would let it probe the user's network. The cause
// can still be narrowed by testing what the error object will not say: a
// no-cors probe reaches the server iff it is up (an opaque response needs
// no CORS headers), and mixed-content blocking is a static property of the
// page and server URLs.

export type ConnectionDiagnosis =
  | "offline"
  | "cors-blocked"
  | "mixed-content"
  | "mixed-content-or-unreachable"
  | "unreachable";

// The per-engine wordings of the opaque network TypeError.
export function isOpaqueNetworkError(message: string): boolean {
  return (
    message.includes("Failed to fetch") || // Chromium
    message.includes("Load failed") || // WebKit
    message.includes("NetworkError when attempting to fetch resource") // Firefox
  );
}

export function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "[::1]" ||
    /^127(\.\d{1,3}){3}$/.test(hostname)
  );
}

const PROBE_TIMEOUT_MS = 5000;

export async function diagnoseConnection(
  serverUrl: string,
  signal: AbortSignal,
): Promise<ConnectionDiagnosis> {
  if (!navigator.onLine) {
    return "offline";
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    // An opaque response proves the server answered, so only browser-side
    // blocking (CORS) is left to explain the original failure.
    await fetch(serverUrl, { mode: "no-cors", cache: "no-store", signal: controller.signal });
    return "cors-blocked";
  } catch {
    if (location.protocol === "https:" && serverUrl.startsWith("http:")) {
      let loopback = false;
      try {
        loopback = isLoopbackHost(new URL(serverUrl).hostname);
      } catch {
        // Unparseable URL: keep the non-loopback (certain) diagnosis.
      }
      // Every browser refuses https → http for remote hosts before the
      // request leaves, so there the verdict is certain. For loopback,
      // Chrome permits the mix (a failed probe means the server is down)
      // while Safari blocks even that — without UA sniffing the two cannot
      // be told apart, so the message must name both.
      return loopback ? "mixed-content-or-unreachable" : "mixed-content";
    }
    return "unreachable";
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}
