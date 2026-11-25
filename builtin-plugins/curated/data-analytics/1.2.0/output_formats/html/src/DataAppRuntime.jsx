import React, { useEffect, useState } from "react";

import { DataAppShell } from "./DataAppShell.jsx";
import { loadHostedSnapshot } from "./hosted-query-bootstrap.js";
import { createQueryDataStore } from "./query-data-store.js";
import { DataAppErrorBoundary } from "./components/DataAppErrorState.jsx";
import { DataAppLoadingContent } from "./components/DataAppLoadingContent.jsx";

function DataAppLoading() {
  return (
    <main className="dashboard-shell-loading" aria-busy="true">
      <div className="dashboard-shell-loading-topbar" aria-hidden="true">
        <div className="dashboard-shell-loading-line is-brand" />
        <div className="dashboard-shell-loading-line is-action" />
      </div>
      <DataAppLoadingContent />
    </main>
  );
}


// The protected runtime accepts authored content and reviewed data at its boundary.
// Neither the source-build wrapper nor the prebuilt browser bundle owns a second
// copy of the shell, its contexts, or the hosted permission/fetch behavior.
export function DataAppRuntime({
  reviewedSnapshot,
  createContent,
  DashboardContent,
  ReportContent,
  staticDemo = false,
  hosted = globalThis.location?.hostname.endsWith(".chatgpt.site") ?? false,
} = {}) {
  const [snapshot, setSnapshot] = useState(hosted || reviewedSnapshot?.dataMode === "live" ? null : reviewedSnapshot);
  const [presentationRecord, setPresentationRecord] = useState({ presentation: {}, revision: 0 });
  const [error, setError] = useState(null);
  const [queryDataStore, setQueryDataStore] = useState(null);

  useEffect(() => {
    if (!hosted) {
      if (reviewedSnapshot?.dataMode !== "live") return;
      const store = createQueryDataStore(reviewedSnapshot, { request: async () => new Response(JSON.stringify({
        status: "binding_unavailable", message: "Publish this page with its data connections to load live data.",
      }), { status: 503 }) });
      setQueryDataStore(store);
      setSnapshot({ ...reviewedSnapshot, queries: store.getQueries() });
      return () => store.dispose();
    }
    const controller = new AbortController();
    let active = true;
    let store;
    Promise.all([
      loadHostedSnapshot(reviewedSnapshot, { signal: controller.signal }),
      fetch("/api/presentation", { signal: controller.signal }).then(response => {
        if (!response.ok) throw new Error("Data app presentation is unavailable.");
        return response.json();
      }),
    ])
      .then(([{ snapshot: snapshotValue, deferred }, record]) => {
        if (!active) return;
        if (deferred) {
          store = createQueryDataStore(snapshotValue, {
            snapshotSha256: snapshotValue._dataAppQueryLoading?.snapshotSha256,
            onChange: queries => {
              if (active) setSnapshot(current => ({ ...current, queries,
                ...(snapshotValue.dataMode === "live" ? { generatedAt: Object.values(queries)
                  .map(query => query.source?.executedAt).filter(Boolean).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1) } : {}),
              }));
            },
          });
          setQueryDataStore(store);
        }
        setPresentationRecord(record);
        setSnapshot(snapshotValue);
      })
      .catch((failure) => {
        controller.abort();
        if (active) setError(failure);
      });
    return () => {
      active = false;
      controller.abort();
      store?.dispose();
    };
  }, [hosted]);

  useEffect(() => {
    if (!queryDataStore?.live) return;
    const clear = () => queryDataStore.clear();
    const restore = event => {
      if (event.persisted) void queryDataStore.ensure(Object.keys(queryDataStore.getQueries())).catch(() => {});
    };
    // A page restored after sign-out must not resurrect earlier visitor rows.
    window.addEventListener("pagehide", clear);
    window.addEventListener("pageshow", restore);
    return () => { window.removeEventListener("pagehide", clear); window.removeEventListener("pageshow", restore); };
  }, [queryDataStore]);

  if (!snapshot) return error
    ? <main className="dashboard-shell-loading-error" role="alert">{error.message}</main>
    : <DataAppLoading />;
  return <DataAppErrorBoundary surface={snapshot.surface}>
    <ResolvedDataApp
      snapshot={snapshot}
      createContent={createContent}
      DashboardContent={DashboardContent}
      ReportContent={ReportContent}
      hosted={hosted}
      staticDemo={staticDemo}
      onSnapshotChange={setSnapshot}
      presentationRecord={presentationRecord}
      queryDataStore={queryDataStore}
    />
  </DataAppErrorBoundary>;
}

function ResolvedDataApp({ snapshot, createContent, DashboardContent, ReportContent,
  hosted, staticDemo, onSnapshotChange, presentationRecord, queryDataStore }) {
  // Eager apps retain complete module-scope imports. Explicit on-demand apps
  // declare dependencies through QueryDataBoundary before reading reviewed rows.
  // Keep component identities stable through later data updates and edits.
  const [content] = useState(() => createContent
    ? createContent(snapshot) : { DashboardContent, ReportContent });
  const Content = snapshot.surface === "report" ? content.ReportContent : content.DashboardContent;

  return (
    <DataAppShell
      snapshot={snapshot}
      hosted={hosted}
      onSnapshotChange={onSnapshotChange}
      canEdit={!staticDemo && (!hosted || presentationRecord.canEdit === true)}
      persistLocally={!staticDemo}
      initialPresentation={presentationRecord.presentation}
      initialRevision={presentationRecord.revision}
      queryDataStore={queryDataStore}
    >
      <Content />
    </DataAppShell>
  );
}
