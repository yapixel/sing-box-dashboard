import { isTerminalCode, type StreamSnapshot } from "../api/stream";
import { useStreamOutage } from "../app/hooks";
import { useI18n, type MessageKey } from "../app/i18n";
import { Icon, type IconName } from "./Icon";
import { EmptyState } from "./ui";

// Presentational form for views that latch the outage themselves (LogsView
// gates its body on the same value).
export function StreamErrorBanner(props: { error: string | null; subject: MessageKey }) {
  const { t } = useI18n();
  if (props.error === null) {
    return null;
  }
  return (
    <div className="banner error">
      <Icon name="warning_amber" />
      <div>
        {t("Failed to subscribe to {subject}: {error}", {
          subject: t(props.subject),
          error: props.error,
        })}
        <div className="hint">{t("Check the server address and secret in Settings.")}</div>
      </div>
    </div>
  );
}

// The error appears only once the outage outlasts the reconnect grace
// period (terminal errors immediately), matching the connection-lost
// takeover in App.tsx — a stream briefly killed by backgrounding the page
// must not flash a banner.
export function StreamBanner(props: { snapshot: StreamSnapshot<unknown>; subject: MessageKey }) {
  const outage = useStreamOutage(props.snapshot, isTerminalCode(props.snapshot.errorCode));
  return <StreamErrorBanner error={outage} subject={props.subject} />;
}

// The scaffolding every stream-backed list view repeats: the error banner,
// a "Loading..." placeholder until the first delivery, and an empty state
// once the stream has delivered but the view has nothing to show.
export function StreamStates(props: {
  snapshot: StreamSnapshot<unknown>;
  subject: MessageKey;
  loaded: boolean;
  empty: boolean;
  emptyIcon?: IconName;
  emptyMessage: string;
}) {
  const { t } = useI18n();
  const outage = useStreamOutage(props.snapshot, isTerminalCode(props.snapshot.errorCode));
  return (
    <>
      <StreamErrorBanner error={outage} subject={props.subject} />
      {!props.loaded && outage === null && <EmptyState>{t("Loading...")}</EmptyState>}
      {props.loaded && props.empty && (
        <EmptyState icon={props.emptyIcon}>{props.emptyMessage}</EmptyState>
      )}
    </>
  );
}
