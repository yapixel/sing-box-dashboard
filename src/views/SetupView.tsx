import { useEffect, useRef, useState } from "react";

import { createServerId, normalizeServerUrl, type Server } from "../api/config";
import { DaemonApi } from "../api/daemon";
import type { AccentPreference, ThemePreference } from "../app/context";
import { LanguageSelect, useI18n, type MessageKey, type Translate } from "../app/i18n";
import { Icon } from "../components/Icon";
import { Field, Spinner, ThemeMenu, ThemeSelect } from "../components/ui";
import {
  diagnoseConnection,
  isOpaqueNetworkError,
  type ConnectionDiagnosis,
} from "../lib/connectivity";

const CONNECT_TIMEOUT_MS = 8000;

// Probe the server by waiting for the first service-status message; any
// response (even an auth error) proves more than a generic fetch failure.
async function testConnection(server: Server, signal: AbortSignal, t: Translate): Promise<void> {
  const api = new DaemonApi(server);
  for await (const _ of api.client.subscribeServiceStatus({}, { signal })) {
    void _;
    return;
  }
  throw new Error(t("Stream ended without a status message"));
}

const DIAGNOSIS_MESSAGES: Record<ConnectionDiagnosis, MessageKey> = {
  "offline": "The browser is offline; check your network connection.",
  "cors-blocked":
    "The server is reachable, but the browser blocked the request: the server does not allow this origin (CORS).",
  "mixed-content":
    "The browser blocked the request: an HTTPS page cannot access an HTTP server. Open the dashboard over HTTP, or serve the API over HTTPS.",
  "mixed-content-or-unreachable":
    "The server is unreachable — or, if it is running, the browser blocked the HTTPS page from accessing the HTTP server; try opening the dashboard over HTTP.",
  "unreachable":
    "The server is unreachable; check that the address is correct and the service is running.",
};

// Browsers collapse every network-layer failure into one opaque message
// (see lib/connectivity.ts): show it as-is while a probe narrows the
// cause, then append the conclusion. Other errors pass through untouched.
export function useDiagnosedConnectError(
  message: string | null,
  serverUrl: string,
): string | null {
  const { t } = useI18n();
  const opaque = message !== null && isOpaqueNetworkError(message);
  const [diagnosis, setDiagnosis] = useState<ConnectionDiagnosis | null>(null);
  useEffect(() => {
    setDiagnosis(null);
    if (!opaque) {
      return;
    }
    const controller = new AbortController();
    void diagnoseConnection(serverUrl, controller.signal).then((result) => {
      if (!controller.signal.aborted) {
        setDiagnosis(result);
      }
    });
    return () => controller.abort();
  }, [opaque, message, serverUrl]);
  if (message === null) {
    return null;
  }
  return diagnosis === null ? message : `${message} — ${t(DIAGNOSIS_MESSAGES[diagnosis])}`;
}

export function SetupView(props: {
  onCreate: (server: Server) => void;
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  accent: AccentPreference;
  onAccentChange: (accent: AccentPreference) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [connecting, setConnecting] = useState(false);
  // The error keeps the URL it came from, so the diagnosis probe targets
  // the address that actually failed even after the field is edited.
  const [error, setError] = useState<{ message: string; url: string } | null>(null);
  const errorDetail = useDiagnosedConnectError(error?.message ?? null, error?.url ?? "");
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const normalizedUrl = normalizeServerUrl(url);
  const valid = normalizedUrl !== "";

  const submit = async () => {
    if (!valid || connecting) {
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setConnecting(true);
    setError(null);
    try {
      const server: Server = {
        id: createServerId(),
        name: name.trim(),
        url: normalizedUrl,
        secret,
      };
      // Race a hard timeout so the UI always recovers, even if the transport
      // swallows the abort signal.
      await Promise.race([
        testConnection(server, controller.signal, t),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(
              new Error(
                t("Connection timed out after {seconds} seconds", {
                  seconds: CONNECT_TIMEOUT_MS / 1000,
                }),
              ),
            );
          }, CONNECT_TIMEOUT_MS);
        }),
      ]);
      props.onCreate(server);
    } catch (connectError) {
      setError({
        message: connectError instanceof Error ? connectError.message : String(connectError),
        url: normalizedUrl,
      });
    } finally {
      clearTimeout(timer);
      setConnecting(false);
    }
  };

  return (
    <div className="setup">
      <div className="setup-panel">
        <div className="setup-brand">
          sing-box
          <small>dashboard</small>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Field label={t("Name")}>
            <input
              className="input"
              value={name}
              placeholder={t("Optional")}
              disabled={connecting}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label={t("URL")}>
            <input
              className="input"
              value={url}
              placeholder={t("Required")}
              autoFocus
              disabled={connecting}
              onChange={(event) => setUrl(event.target.value)}
            />
          </Field>
          <Field label={t("Secret")}>
            <input
              className="input"
              value={secret}
              placeholder={t("Optional")}
              autoComplete="off"
              disabled={connecting}
              onChange={(event) => setSecret(event.target.value)}
            />
          </Field>
          {errorDetail !== null && (
            <div className="banner error">
              <Icon name="warning_amber" />
              <div>{errorDetail}</div>
            </div>
          )}
          <button className="button primary setup-submit" type="submit" disabled={!valid || connecting}>
            {connecting && <Spinner />}
            {connecting ? t("Connecting...") : t("Connect")}
          </button>
        </form>
        <div className="setup-footer">
          <div className="settings-row">
            <span className="settings-row-label">{t("Appearance")}</span>
            <ThemeSelect theme={props.theme} onChange={props.onThemeChange} />
          </div>
          <div className="settings-row">
            <span className="settings-row-label">{t("Theme")}</span>
            <ThemeMenu accent={props.accent} onChange={props.onAccentChange} openUp />
          </div>
          <div className="settings-row">
            <span className="settings-row-label">{t("Language")}</span>
            <LanguageSelect className="select inline" />
          </div>
        </div>
      </div>
    </div>
  );
}
