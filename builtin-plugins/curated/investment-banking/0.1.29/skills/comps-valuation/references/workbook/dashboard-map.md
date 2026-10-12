# Dashboard Map: Comps Model Builder

Use `dashboard-builder` for model-backed comps dashboards with source posture, outlier handling, valuation range, and export readiness.

## Decision Question

Is the comps model decision-ready and what valuation range should be shown to the client or committee?

## Recommended Sections

1. Overview: `metric_strip`, `verdict`, `flags`.
2. Model Inputs: `source_readiness`, `wide_table`.
3. Trading / Transaction Multiples: `wide_table`, `bar_chart`.
4. Valuation Output: `sensitivity_matrix`, `valuation_bridge`.
5. QA: `flags`, `action_register`.

## Top KPIs

- Median EV/Revenue and EV/EBITDA
- Implied EV / equity range
- Peer coverage completeness
- Outliers excluded
- Missing estimate count
- Model check status

## Required Sources

- Market data
- Peer estimates
- Target financials
- Share count / net debt bridge
- Inclusion/exclusion rationale
