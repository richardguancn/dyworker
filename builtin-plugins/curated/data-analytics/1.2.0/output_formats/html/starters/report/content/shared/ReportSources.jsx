import React from "react";
import { useDataApp } from "../../data-app-public.jsx";
import { useDataViewEvidence } from "./DataView";

/** @type {React.CSSProperties} */
const style = {
  background: "transparent", border: 0, color: "inherit", cursor: "pointer", font: "inherit",
  padding: "0 .15em", textAlign: "left", textDecoration: "underline",
};

/** Use the same ordered query IDs for the citations and the report's source list.
 * @param {{ queryIds: readonly string[], queryId: string, showTitle?: boolean,
 * sourceRows?: readonly import("../../data-app-public.jsx").DataRow[] }} props */
export function ReportCitation({ queryIds, queryId, showTitle = false, sourceRows }) {
  const { queries, componentActions } = useDataApp();
  const scopedEvidence = useDataViewEvidence(queryId);
  const index = queryIds.indexOf(queryId);
  const query = queries[queryId];
  if (index < 0 || !query) throw new Error("Unlisted report source: " + queryId);
  const title = query.source?.name || (typeof query.source?.label === "string" && query.source.label) || queryId;
  const number = "[" + (index + 1) + "]";
  return <button type="button" style={style} data-report-citation={showTitle ? "list" : "claim"}
    aria-label={number + " " + title}
    onClick={() => componentActions.onOpen?.("source", {
      id: "source-" + queryId, queryId, title, ...scopedEvidence,
      ...(sourceRows !== undefined ? { sourceRows } : {}),
    })}>
    {showTitle ? number + " " + title : number}
  </button>;
}

/** @param {{ queryIds: readonly string[] }} props */
export function ReportSources({ queryIds }) {
  if (!queryIds.length) return null;
  return <section aria-label="Sources">
    <h2>Sources</h2>
    <ol style={{ listStyle: "none", padding: 0 }}>
      {queryIds.map(id => <li key={id}><ReportCitation queryIds={queryIds} queryId={id} showTitle /></li>)}
    </ol>
  </section>;
}
