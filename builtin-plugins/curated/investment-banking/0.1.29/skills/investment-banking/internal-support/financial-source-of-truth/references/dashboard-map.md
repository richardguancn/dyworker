# Dashboard Map: Financial Source Of Truth

Use `dashboard-builder` for source posture, conflict resolution, evidence quality, and fact-base readiness dashboards.

## Decision Question

Which financial facts are reliable, conflicted, stale, estimated, or missing?

## Recommended Sections

1. Overview: `metric_strip`, `verdict`, `flags`.
2. Source Hierarchy: `source_readiness`, `wide_table`.
3. Conflicts: `flags`, `wide_table`.
4. Fact Register: `wide_table`, `evidence_posture`.
5. Required Follow-Up: `action_register`.

## Top KPIs

- Primary sources available
- Conflicted facts
- Stale data points
- Unsupported claims
- Banker estimates
- Decision blockers

## Required Sources

- Source register
- Extracted fact table
- Conflict log
- As-of dates
- Evidence label taxonomy
