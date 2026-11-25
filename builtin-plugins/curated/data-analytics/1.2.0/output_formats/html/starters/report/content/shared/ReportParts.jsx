import React from "react";
import { DataTable, EvidenceChart, ReportSection, RichNarrative, useDataApp, chartConfigEntries } from "../../data-app-public.jsx";
import { ReportCitation, ReportSources } from "./ReportSources.jsx";

/** @param {{preparedOn: string, author?: string}} props */
export function ReportHeader({ preparedOn, author }) {
  const { appTitle, setAppTitle, canEdit, mode } = useDataApp();
  const editing = canEdit && mode === "edit";
  return <header className="report-hero">
    <h1 data-data-app-title contentEditable={editing} suppressContentEditableWarning
      aria-label={editing ? "Edit report heading" : undefined}
      onBlur={editing ? e => setAppTitle((e.currentTarget.textContent ?? "").trim() || appTitle) : undefined}
      onKeyDown={editing ? e => { if(e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } } : undefined}>
      {appTitle}
    </h1>
    <RichNarrative id="report:byline" className="report-deck" label="Edit report date and author"
      value={[preparedOn, author].filter(Boolean).join(" · ")} />
  </header>;
}

/** Keep the numbered Sources list with the claim citations when changing the body.
 * @param {{sources: readonly string[], preparedOn: string, author?: string, children: React.ReactNode,
 * className?: string, label?: string, beforeHeader?: React.ReactNode}} props */
export function ReportFrame({ sources, preparedOn, author, children, className = "", label = "Analytical report", beforeHeader }) {
  return <article className={["report-content", className].filter(Boolean).join(" ")} aria-label={label}>
    {beforeHeader}
    <ReportHeader preparedOn={preparedOn} author={author} />
    {children}
    <ReportSources queryIds={sources} />
  </article>;
}

/** A lookup in reviewed report data. Use a separate query for a different display grain.
 * @param {{queryId: string, caption: string,
 * columns?: import("../../data-app-public.jsx").DataTableProps["columns"]}} props */
export function ReportTable({ queryId, caption, columns }) {
  const { reviewedRows } = useDataApp();
  return <DataTable rows={reviewedRows(queryId)} caption={caption} columns={columns} searchable={false} />;
}

/** @typedef {{id: string, title: string, markdown: string, queryIds?: readonly string[],
 * sourceRowsByQuery?: Record<string, readonly import("../../data-app-public.jsx").DataRow[]>}} Finding */
/** @param {Finding & {sources: readonly string[]}} props */
export function ReportFinding({ id, title, markdown, sources, queryIds = [], sourceRowsByQuery }) {
  const prose = <RichNarrative id={id + ":body"} value={markdown} label="Edit finding" className="report-finding-prose" />;
  const [first] = queryIds;
  if (!first) return prose;
  return <ReportSection id={id} title={title} queryId={first} queryIds={queryIds} className="report-finding"
    sourceRowsByQuery={sourceRowsByQuery} showHeading={false}>
    {prose}{" "}{queryIds.map(queryId => <ReportCitation key={queryId} queryIds={sources} queryId={queryId}
      sourceRows={sourceRowsByQuery?.[queryId]} />)}
  </ReportSection>;
}

/** @typedef {{queryId: string, config: Omit<import("../../data-app-public.jsx").SingleChart, "rows" | "columns">}} FindingChart */
/** Contextual typing preserves the visualize-data config when authoring reusable chart factories.
 * @param {string} queryId @param {FindingChart["config"]} config @returns {FindingChart} */
export function chartFor(queryId, config) {
  return { queryId, config };
}

/** @param {{chart: FindingChart|null}} props */
export function ReportChart({ chart }) {
  const { reviewedRows } = useDataApp();
  if (!chart) return null;
  const rows = reviewedRows(chart.queryId);
  let resolved;
  try {
    [resolved] = chartConfigEntries({ ...chart.config, height: chart.config.height ?? undefined, rows });
  } catch (error) {
    return <div role="alert" data-chart-config-error="true">{error instanceof Error ? error.message : String(error)}</div>;
  }
  /** @type {import("../../data-app-public.jsx").ChartOptions & {canonical: boolean, accessibleLabel: string}} */
  const chartOptions = { canonical: true, accessibleLabel: resolved.summary ?? resolved.title };
  return <EvidenceChart queryId={chart.queryId} id={resolved.id} title={resolved.title}
    description={resolved.description ?? undefined} height={resolved.height} spec={resolved.spec}
    rows={resolved.rows} sourceRows={rows} chartOptions={chartOptions} />;
}
