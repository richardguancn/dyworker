# Dashboard decisions for complex requests

For an ordinary dashboard with supplied evidence, [Build Dashboard](../SKILL.md) contains the starter, scoped views and checked handoff. Use the sections below when a decision is unresolved.

## Plan the evidence and hierarchy

Identify the audience, decision, population, period and comparison. Map distinct questions to the evidence: level or change, trajectory, variation across groups, denominators and useful detail. An operating cadence may matter for a recurring review. Ask for consequential missing information under [task intake](../../../shared/task-intake.md); otherwise choose a reversible default. For a selected template, preserve its format and structure under [template handling](../../../shared/output-and-template-handling.md#template-handling).

Choose views for the decision. A queue of records can lead an operational dashboard. Show groups or histories together when their comparison matters; a filter or one-entity drilldown does not answer that question. Give each section a distinct job. Use consistent units, order and scales across panels; label any justified scale change. Add a scenario only when the data supports its assumptions, with modeled outputs and reset separate from observations.

## Resolve the measurement

Use [source selection](../../../shared/source-selection.md#find-the-authoritative-source) for missing or ambiguous evidence and [metric definitions](../../../shared/metric-definitions.md) for an unknown company measure. Respect source restrictions. Use [reviewed data and provenance](../../../output_formats/html/docs/evidence.md#reviewed-data-and-provenance) to record row grain, definitions, provenance and coverage, including supplied or fictional source classifications. Never invent missing records or lineage. Preserve requested measures; identify an unavailable requirement and its consequence. For workbook inputs, use spreadsheet tools for ingestion and calculations.

Reconcile ratios from numerators and denominators, and distinct counts at their true grain. Preserve nulls, cohort maturity, uncertainty and distinctions between actuals, targets and scenarios. A missing baseline is unavailable; an endpoint delta is not a substitute. Apply [analysis quality](../../../shared/analysis-quality.md) to unresolved analytical claims.

## Design a longer dashboard

Group views in the order the reader reviews them. Use [sortable layouts](../../../output_formats/html/docs/components/layout/sortable-layout.md) for movable blocks; preserve authored grids, freeform layouts, tabs or saved placement when requested. Put section filters beside the section they govern. Keep useful evidence visible together; make supporting records available through chart actions or row detail. A tab should have a distinct job.

Use descriptive headings, show an unfamiliar metric’s meaning beside its first use, and put other definitions in a tooltip or source inspector. Give uncertainty its interval and level. Do not rank tied groups as if their order carried information. For copy or display decisions, consult [dashboard examples](content-examples.md), [data writing](../../../shared/data-writing.md) or [comparison formatting](../../../output_formats/html/docs/components/metrics/comparison-formatting.md) as needed.

For a substantial revision, check the opening hierarchy and ensure each requested measure, comparison and section is accounted for. Reuse the [checked handoff](../SKILL.md#check-and-deliver-the-html); for an unresolved layout or rendering issue consult [build and verification](../../../output_formats/html/docs/build-and-verify.md#rendered-verification). Keep refreshes in the same artifact under its [data lifecycle](../../../output_formats/html/docs/refresh.md#local-and-hosted-data-lifecycle).
