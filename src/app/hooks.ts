import { useEffect, useRef, useState, type RefObject } from "react";

import type { StreamSnapshot } from "../api/stream";

// How long a stream that already delivered data may stay failing before its
// outage is surfaced (the connection-lost takeover, the per-view error
// banners). The reconnect loop retries at roughly t=1/3/6 s (1/2/3 s backoff
// steps), so anything shorter than ~6 s would expire inside the gap before
// the third attempt and flash an error for an outage that attempt was about
// to fix.
export const RECONNECT_GRACE_MS = 6500;

// Latched error message for a failing stream: null while the stream is
// healthy or the outage is still within the grace period, the error text
// once latched — immediately when `immediate` holds (errors a retry cannot
// fix, first-connect failures). Cleared only when the stream delivers
// again, and the timer spans the error → connecting → error cycles of the
// reconnect loop, so the result neither bounces nor re-arms between
// attempts.
export function useStreamOutage(
  snapshot: StreamSnapshot<unknown>,
  immediate: boolean,
  graceMs = RECONNECT_GRACE_MS,
): string | null {
  const [outage, setOutage] = useState<string | null>(null);
  // The message is latched through a ref because the "connecting" snapshot
  // between attempts carries no error fields.
  const lastError = useRef("");
  const timer = useRef<number | null>(null);
  useEffect(() => {
    const cancel = () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
    if (snapshot.phase === "active") {
      cancel();
      setOutage(null);
    } else if (snapshot.phase === "error") {
      lastError.current = snapshot.error ?? "";
      if (immediate) {
        cancel();
        setOutage(lastError.current);
      } else if (timer.current === null) {
        timer.current = window.setTimeout(() => {
          timer.current = null;
          setOutage(lastError.current);
        }, graceMs);
      }
    }
  }, [snapshot, immediate, graceMs]);
  useEffect(() => {
    const pending = timer;
    return () => {
      if (pending.current !== null) {
        clearTimeout(pending.current);
      }
    };
  }, []);
  return outage;
}

// Menus register here while open; Escape dismisses only the topmost one.
// Dialogs and drawers are native <dialog> elements that close through their
// cancel event instead — the preventDefault below also stops that default
// action, so a menu open inside a dialog closes before the dialog does.
const escapeStack: (() => void)[] = [];

function useEscapeEntry(active: boolean, onDismiss: () => void) {
  // Read through a ref so a new callback identity per render neither
  // re-registers the listener nor needs to be a dependency.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    if (!active) {
      return;
    }
    const entry = () => dismissRef.current();
    escapeStack.push(entry);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && escapeStack[escapeStack.length - 1] === entry) {
        event.preventDefault();
        entry();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      const index = escapeStack.indexOf(entry);
      if (index >= 0) {
        escapeStack.splice(index, 1);
      }
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [active]);
}

// Dismissal behavior shared by the popup menus (server picker, theme menu,
// overflow menus): pointerdown outside the anchor or Escape closes them.
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onDismiss: () => void,
) {
  useEscapeEntry(open, onDismiss);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        dismissRef.current();
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [ref, open]);
}

// Optimistic pending value for fire-and-forget selections (Clash mode, group
// outbound, group expand): the UI shows the value the user picked right away
// and drops it once the stream confirms the server reached it; a failed
// mutation clears it by setting null. The clear happens during render — the
// supported "adjust state when props change" form of this latch.
export function usePendingValue<T>(serverValue: T): [T, (pending: T | null) => void] {
  const [pending, setPending] = useState<T | null>(null);
  if (pending !== null && serverValue === pending) {
    setPending(null);
  }
  return [pending ?? serverValue, setPending];
}

// One-shot unary fetch shared by the version / uptime / deprecated-warnings
// lookups: runs once `enabled` holds and the value is still missing, ignores
// failures (daemons predating the method reject with Unimplemented), and
// drops a result that lands after unmount.
export function useUnaryOnce<T>(call: () => Promise<T>, enabled = true): T | null {
  const [value, setValue] = useState<T | null>(null);
  const callRef = useRef(call);
  callRef.current = call;
  useEffect(() => {
    if (!enabled || value !== null) {
      return;
    }
    let stale = false;
    callRef.current().then(
      (result) => {
        if (!stale) {
          setValue(result);
        }
      },
      () => {},
    );
    return () => {
      stale = true;
    };
  }, [enabled, value]);
  return value;
}

// State machine shared by the streaming tools (network quality test, STUN
// test, Tailscale ping): a running flag plus a stream error, with the stream
// aborted on unmount and the rejection a user-initiated stop causes ignored.
export function useStreamingAction(): {
  running: boolean;
  error: string;
  reportError: (message: string) => void;
  start: (run: (signal: AbortSignal) => Promise<void>) => void;
  stop: () => void;
} {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const start = (run: (signal: AbortSignal) => Promise<void>) => {
    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);
    setError("");
    void run(controller.signal)
      .catch((streamError: unknown) => {
        if (!controller.signal.aborted) {
          setError(String(streamError));
        }
      })
      .finally(() => setRunning(false));
  };

  const stop = () => {
    controllerRef.current?.abort();
    setRunning(false);
  };

  return { running, error, reportError: setError, start, stop };
}
