import React, { useEffect, useState, useSyncExternalStore } from "react";

import { useOptionalDataAppShell } from "../DataAppContext.jsx";
import { ComponentSkeleton, ComponentState } from "../charting/ChartState.jsx";
import { DataAppLoadingContent } from "./DataAppLoadingContent.jsx";
import { refreshFailureMessage } from "../live-refresh.js";

const subscribeNone = () => () => {};
const eagerVersion = () => 0;

/** Put query-dependent calculations and controls inside this boundary. */
export function QueryDataBoundary({ queryIds = [], children, loadingLayout = "page", loadingKind = "chart", loadingHeight = 240, loadingChart }) {
  const shell = useOptionalDataAppShell();
  const store = shell?.queryDataStore;
  useSyncExternalStore(store?.subscribe ?? subscribeNone, store?.getVersion ?? eagerVersion, store?.getVersion ?? eagerVersion);
  const key = JSON.stringify(queryIds);
  useEffect(() => {
    if (store) void store.ensure(JSON.parse(key)).catch(() => {});
  }, [store, key]);
  const ready = !store || store.isReady(queryIds);
  const error = store?.error(queryIds);
  if (store?.live) return <LiveQueryState store={store} queryIds={queryIds} ready={ready} error={error}
    kind={loadingKind} height={loadingHeight} chart={loadingChart}>{children}</LiveQueryState>;
  if (ready) return children;
  const retry = () => { void store.ensure(queryIds).catch(() => {}); };
  if (!error && loadingLayout === "page") return <div className="dashboard-shell-loading-embedded" aria-busy="true">
    <DataAppLoadingContent status="Loading reviewed data" />
  </div>;
  return <div className="component-skeleton" aria-busy={!error || undefined}
    style={{ "--component-state-height": typeof loadingHeight === "number" ? `${loadingHeight}px` : loadingHeight }}>
    {error?.code === "SNAPSHOT_CHANGED" ? <div className="component-data-state" role="alert" style={{ minHeight: loadingHeight }}>
      <strong>Dashboard data changed.</strong><p>Reload the page to load the current data.</p>
    </div> : error ? <ComponentState error kind={loadingKind} height={loadingHeight} onRetry={retry} />
      : <div className="component-loading-body" role="status" aria-label="Loading reviewed data">
        <ComponentSkeleton kind={loadingKind} chart={loadingChart} />
      </div>}
  </div>;
}

// Use the existing chart geometry for both first load and refresh. A successful
// empty result reaches the chart; a failed read never masquerades as zero rows.
function LiveQueryState({ store, queryIds, ready, error, kind, height, chart, children }) {
  const [, tick] = useState(0);
  const retryAt = store.retryAt(queryIds);
  useEffect(() => {
    if (retryAt <= Date.now()) return;
    const timer = setTimeout(() => tick(value => value + 1), Math.min(retryAt - Date.now(), 2_147_483_647));
    return () => clearTimeout(timer);
  }, [retryAt]);
  const pending = store.pending(queryIds);
  const run = () => { void store.refresh(queryIds).catch(() => {}); };
  const status = error?.status;
  const reconnect = status === "reauthentication_required";
  const reload = status === "request_context_expired" || status === "invalid_request";
  const denied = status === "permission_denied";
  const disabled = status === "connector_access_disabled";
  const builder = ["tool_not_allowed", "tool_not_found", "binding_unavailable"].includes(status);
  const needsAction = store.needsAction(queryIds);
  const noun = kind === "metric" ? "metric" : kind === "table" ? "table" : "chart";
  const times = queryIds.map(id => store.getQueries()[id]?.source?.executedAt).filter(Boolean);
  const returnTo = `${globalThis.location?.pathname ?? "/"}${globalThis.location?.search ?? ""}`;
  return <div aria-busy={pending || undefined}>
    {/* Keep mounted controls while refreshing; access loss still unmounts them. */}
    {ready && <div hidden={pending} style={{ display: pending ? "none" : "contents" }}>{children}</div>}
    {(!ready || pending) && !error && !needsAction && <div className="component-skeleton"
      style={{ "--component-state-height": typeof height === "number" ? `${height}px` : height }}>
      <div className="component-loading-body" role="status" aria-label="Loading data"><ComponentSkeleton kind={kind} chart={chart} /></div>
    </div>}
    {(error || needsAction) && <div className="component-data-state" role={error ? "alert" : "status"}
      style={{ minHeight: ready ? undefined : height }}>
      <strong>{ready ? "Showing earlier data"
        : reconnect ? "Sign in to load this data" : denied ? "You don’t have permission to this data"
        : disabled ? "This source is disabled for this Site" : needsAction ? "Run query to load this chart"
        : `Couldn’t load this ${noun}`}</strong>
      {error && <p>{refreshFailureMessage(error)}</p>}
      {ready && error && <p>Last loaded: {times.sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? "unknown"}. This data may be out of date.</p>}
      {reconnect ? <a className="button secondary" target="_top" href={`/signin-with-chatgpt?return_to=${encodeURIComponent(returnTo)}`}>Review access</a>
        : reload ? <a className="button secondary" href={returnTo}>Reload page</a>
        : !denied && !disabled && !builder && !pending && <button type="button" className="button secondary"
          disabled={retryAt > Date.now()} onClick={run}>{error?.pendingJob ? "Check status" : needsAction ? "Run query" : "Try again"}</button>}
    </div>}
  </div>;
}
