import { Code, ConnectError } from "@connectrpc/connect";
import { useSyncExternalStore } from "react";

export type StreamPhase = "connecting" | "active" | "error";

export interface StreamSnapshot<T> {
  phase: StreamPhase;
  error?: string;
  errorCode?: Code;
  data: T;
}

export interface StreamContext<T> {
  signal: AbortSignal;
  update(updater: (data: T) => T): void;
}

export function describeError(error: unknown): { message: string; code?: Code } {
  if (error instanceof ConnectError) {
    return { message: error.rawMessage, code: error.code };
  }
  if (error instanceof Error) {
    return { message: error.message };
  }
  return { message: String(error) };
}

// Errors a retry cannot fix: the daemon does not support the call, or it
// rejects the configured credentials. The reconnect loop stops on these,
// and the UI takes over with the error screen immediately instead of
// granting a reconnect grace period.
export function isTerminalCode(code: Code | undefined): boolean {
  return (
    code === Code.Unimplemented ||
    code === Code.Unauthenticated ||
    code === Code.PermissionDenied
  );
}

// A subscription stream shared by all components observing it: the stream is
// opened while at least one component subscribes, and reconnects with backoff
// until the error is one a retry cannot fix.
export class StreamStore<T> {
  private listeners = new Set<() => void>();
  private snapshot: StreamSnapshot<T>;
  private controller: AbortController | null = null;
  private skipBackoff = false;
  private wakeBackoff: (() => void) | null = null;

  constructor(
    private createInitial: () => T,
    private runStream: (context: StreamContext<T>) => Promise<void>,
    private resetOnReconnect = false,
  ) {
    this.snapshot = { phase: "connecting", data: createInitial() };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      this.start();
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.stop();
      }
    };
  };

  getSnapshot = (): StreamSnapshot<T> => this.snapshot;

  // Cuts the current (or next) reconnect backoff short and restarts the
  // attempt counter: called when the page returns to the foreground or the
  // network comes back, where waiting out an accumulated backoff would keep
  // stale data on screen. The flag (rather than waking alone) covers the
  // resume race where the visibility event fires before the killed stream
  // reports its error; a stale flag at most skips one 1 s backoff later.
  retryNow = (): void => {
    this.skipBackoff = true;
    this.wakeBackoff?.();
  };

  private setSnapshot(next: StreamSnapshot<T>) {
    this.snapshot = next;
    for (const listener of this.listeners) {
      listener();
    }
  }

  private start() {
    const controller = new AbortController();
    this.controller = controller;
    this.skipBackoff = false;
    void this.loop(controller.signal);
  }

  private stop() {
    this.controller?.abort();
    this.controller = null;
  }

  private async loop(signal: AbortSignal) {
    let attempt = 0;
    while (!signal.aborted) {
      const data = this.resetOnReconnect ? this.createInitial() : this.snapshot.data;
      this.setSnapshot({ phase: "connecting", data });
      try {
        await this.runStream({
          signal,
          update: (updater) => {
            attempt = 0;
            this.setSnapshot({ phase: "active", data: updater(this.snapshot.data) });
          },
        });
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        const described = describeError(error);
        this.setSnapshot({
          ...this.snapshot,
          phase: "error",
          error: described.message,
          errorCode: described.code,
        });
        if (isTerminalCode(described.code)) {
          return;
        }
      }
      attempt += 1;
      await this.backoff(Math.min(1000 * attempt, 5000), signal);
      if (this.skipBackoff) {
        // Woken by retryNow: the next failure backs off from scratch.
        this.skipBackoff = false;
        attempt = 0;
      }
    }
  }

  // The sleep between reconnect attempts; retryNow() resolves it early.
  private backoff(durationMs: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal.aborted || this.skipBackoff) {
        resolve();
        return;
      }
      const finish = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", finish);
        this.wakeBackoff = null;
        resolve();
      };
      const timer = setTimeout(finish, durationMs);
      signal.addEventListener("abort", finish, { once: true });
      this.wakeBackoff = finish;
    });
  }
}

export function useStream<T>(store: StreamStore<T>): StreamSnapshot<T> {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
