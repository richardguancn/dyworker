import React from "react";
import { RichNarrative } from "../../data-app-public.jsx";
import { ReportFrame, ReportFinding, ReportChart, chartFor } from "../shared/ReportParts.jsx";

// Fill or rearrange the report below. Omit sections that do not serve the reader.
const preparedOn = "__PREPARED_ON__";
const author = "__AUTHOR__";
/** @type {string[]} Reviewed query IDs in first-citation order. */
const sources = /* @report-sources */ [];
const summary = `## Executive Summary

- [Lead with the main finding or decision, its decisive numbers or comparison, and why it matters. Qualify the claim if uncertainty changes the answer.]
- [Connect another important finding to its evidence and implication.]
- [Add a useful supported next step or further takeaway; omit when unnecessary.]`;
/** @type {import("../shared/ReportParts.jsx").Finding[]} */
const findings = [{
  id: "report-finding",
  title: "[A specific finding]",
  markdown: "## [A specific finding]\n\n[The comparison, its scope and what it establishes.]",
  queryIds: sources.slice(0, 1), // Select the supporting queries separately for each claim.
}];
// Optional chart bound to reviewed rows; chartFor preserves the component's literal types.
const chart = /* @report-chart */ null;
// Remove irrelevant closing sections. Use ReportTable for tabular data.
/** @type {{id: string, markdown: string}[]} */
const closing = [
  { id: "report:implications", markdown: "## Recommendation and rationale\n\n[Connect the findings to the decision, if warranted.]" },
  { id: "report:caveats", markdown: "## Confidence and caveats\n\n[Explain the limits and what could change the conclusion.]" },
];

export function ReportContent() {
  const firstClaim = sources.slice(0, 1); // Give each finding its own evidence IDs.
  return <ReportFrame sources={sources} preparedOn={preparedOn} author={author}>
    <ReportFinding id="report-summary" title="Executive Summary" markdown={summary} sources={sources} queryIds={firstClaim} />
    {findings.map(finding => <ReportFinding key={finding.id} {...finding} sources={sources} />)}
    <ReportChart chart={chart} />
    {closing.map(({ id, markdown }) => <RichNarrative key={id} id={id} value={markdown} />)}
  </ReportFrame>;
}
