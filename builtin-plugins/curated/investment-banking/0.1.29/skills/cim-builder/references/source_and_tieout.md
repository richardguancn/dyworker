# Source, Tie-Out, and Evidence Standards

Use this reference whenever a CIM includes financial metrics, KPIs, market data, customer claims, management quotes, forecasts, or assertions that could be challenged in diligence.

## Table of contents

- [Source hierarchy](#source-hierarchy)
- [Fact tags](#fact-tags)
- [Source log schema](#source-log-schema)
- [Financial tie-out checklist](#financial-tie-out-checklist)
- [Adjusted EBITDA and add-back discipline](#adjusted-ebitda-and-add-back-discipline)
- [KPI definition standard](#kpi-definition-standard)
- [Market data and stale-data checks](#market-data-and-stale-data-checks)
- [Visual exhibit checks](#visual-exhibit-checks)
- [Discrepancy protocol](#discrepancy-protocol)

## Source hierarchy

Use the highest-quality source available. Prefer:

1. audited or reviewed financial statements.
2. management financial model or monthly management accounts.
3. QoE and diligence reports.
4. operating system exports: CRM, billing, ERP, HRIS, product analytics, customer exports, backlog, pipeline.
5. management interviews and approved notes.
6. board decks and internal reporting.
7. third-party data providers and industry reports.
8. public filings, company websites, press releases, government data, trade associations.
9. explicit assumptions and placeholders.

When sources conflict, do not silently choose one. Flag the discrepancy, explain likely cause, and ask for confirmation or use the more authoritative source with a note.

## Fact tags

Use these tags internally and in source logs:

- company-provided.
- audited financials.
- management accounts.
- management interview.
- customer data.
- crm/billing/export.
- qoe/diligence.
- third-party research.
- public filing.
- banker assumption.
- needs confirmation.
- stale / refresh required.
- internal-only.
- external-ready.

## Source log schema

Create or update a source log for substantial CIM work. For `ib-deck-qc` handoff, map the source log into the canonical `source_log` component inside `cim_builder_to_ib_deck_qc` in `../../../references/handoff-contracts.md`.

Recommended native columns:

- claim_or_metric.
- section_or_page.
- value.
- period.
- unit.
- source_name.
- source_date.
- source_location.
- fact_tag.
- confidence.
- external_ready.
- notes.
- owner.
- review_status.

Canonical handoff fields include `source_id`, `source_name`, `source_type`, `source_date`, `document_date`, `accessed_date`, `as_of_date`, `source_pointer`, `freshness_status`, `conflict_status`, `confidence`, `native_evidence_label`, `canonical_evidence_category`, `treatment`, and `limitations`.

If the user provides a CSV source log, the bundled script [`scripts/check_source_log.py`](../scripts/check_source_log.py) can validate required columns and missing values.

## Financial tie-out checklist

Check:

- fiscal year labels are consistent.
- LTM period is defined and consistent.
- revenue, EBITDA, adjusted EBITDA, gross margin, capex, working capital, and cash flow tie to the model or source financials.
- segment revenue reconciles to total revenue.
- product, geography, and customer splits reconcile to totals or disclose if based on subsets.
- percentages foot to 100% where appropriate.
- CAGRs, growth rates, margins, and bps changes recalculate correctly.
- charts match the numbers in the tables.
- forecast periods align with management plan.
- units are clear: dollars, millions, thousands, percentage, bps, units, customers, locations.
- rounding is consistent and not misleading.
- historical actuals and projections are visually distinguished.
- non-GAAP and adjusted metrics are defined.

## Adjusted EBITDA and add-back discipline

For each add-back, capture:

- description.
- amount.
- period.
- category.
- source.
- rationale.
- recurrence risk.
- QoE support status.
- buyer skepticism rating: low, medium, high.
- whether it is external-ready.

Common categories:

- transaction expenses.
- owner expenses.
- severance or restructuring.
- one-time professional fees.
- litigation or settlement.
- public-company costs or standalone dis-synergies.
- run-rate savings.
- pro forma acquisition adjustments.
- accounting policy changes.
- non-recurring revenue/cost timing.

MD guidance:

- Do not present aggressive add-backs as clean earnings.
- Run-rate savings need action taken, timing, and evidence.
- Owner add-backs require support and should be framed carefully.
- QoE unsupported add-backs create retrade risk.

## KPI definition standard

For each KPI, define:

- name.
- formula.
- source system.
- period.
- inclusion/exclusion rules.
- reconciliation to financials.
- known limitations.
- owner.

Examples:

- net revenue retention: current-period revenue from prior-period customer cohort divided by prior-period revenue from the same cohort. Clarify whether churned customers, downgrades, usage, acquired customers, and one-time revenue are included.
- ARR: annualized recurring revenue at period-end. Clarify whether implementation, usage minimums, services, usage overages, and contracted but not live revenue are included.
- backlog: signed but undelivered revenue. Clarify cancellability, expected conversion timing, margin, and relationship to deferred revenue.

## Market data and stale-data checks

Check:

- publication date.
- data vintage.
- market definition.
- geography.
- methodology.
- whether the market is TAM, SAM, SOM, or served budget pool.
- whether growth rate is nominal, real, revenue, units, or volume.
- whether the data is third-party, company estimate, or banker assumption.

Avoid inflated TAM pages. Connect market size to the company's specific products, segments, and growth plan.

## Visual exhibit checks

Every exhibit needs:

- message title.
- source.
- time period.
- units.
- definitions.
- footnotes for non-GAAP or adjusted metrics.
- readable labels.
- no misleading axis scaling.
- no cherry-picked time period without rationale.

Ask: what buyer underwriting question does this chart answer? If unclear, remove or reframe it.

## Discrepancy protocol

When a number does not tie:

1. show the discrepancy.
2. identify sources compared.
3. quantify the difference.
4. propose likely explanations: timing, accounting basis, exclusions, rounding, acquisitions, discontinued operations, currency, pro forma adjustments, LTM definition, or stale file.
5. recommend next action.
6. avoid using the disputed number externally until resolved or clearly footnoted.
