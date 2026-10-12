# Source protocol

Use this reference when deciding what evidence to use, whether source data is stale, how to cite values, and how to handle source conflicts.

## Source hierarchy

Prefer the highest-ranked available source that the user is permitted to access. If a lower-ranked source is used because a higher-ranked source is unavailable, disclose that limitation.

| Rank | Source type | Examples | Default treatment |
|---:|---|---|---|
| 1 | User-provided source package | Uploaded model, CIM, VDR export, management report, bank statement, ERP export | Treat as governing for the user's task unless contradicted by explicit instructions or a higher-control connected system. |
| 2 | Callable internal system route or export | ERP/GL, planning/EPM, data warehouse, HRIS, CRM, procurement, treasury, subledger | Treat as authoritative for actuals, plans, headcount, spend, revenue drivers, and internal reporting only when the runtime exposes a scoped route or the user provides an export. |
| 3 | Primary public-company source | 10-K, 10-Q, 8-K, earnings release, investor deck, transcript from company/primary provider | Treat as authoritative for public reported financials. |
| 4 | Callable financial-data provider route or export | FactSet, S&P Global, LSEG, PitchBook, Daloopa, CapIQ-like sources, Chronograph, iLevel | Use only through a callable runtime route or a user-provided export; cite provider and verify critical values against primary sources when material. |
| 5 | Secondary public source | News, market-data sites, aggregator pages, broker summaries, web snippets | Use only for context or fallback; mark lower confidence. |
| 6 | User assumption | User-provided forecast, case, target, or scenario assumption | Label as `assumption_user_provided`. |
| 7 | Assistant inference | Mapping inference, calculated placeholder, rough estimate | Avoid when possible; label `assumption_inferred`, disclose, and keep confidence low. |

## Stale-data checks

Assign `freshness_status` in `Source_Index`:

| Status | Use when |
|---|---|
| `current` | Source date covers the requested latest period or the user-requested period. |
| `acceptable_for_period` | Source is not the latest available but is appropriate because the user asked for that period. |
| `preliminary` | Source is from a press release, flash report, unaudited package, soft close, draft model, or management preliminary view. |
| `stale` | A newer filing/release/report/version likely exists for the requested period. |
| `unknown` | Date, period, version, or retrieval metadata cannot be determined. |

Default stale-data rules:
- Public companies: latest-quarter work should prefer the latest 10-Q/10-K and earnings release; mark prior-period-only data as stale if a newer period is available.
- Earnings work: pre-print data becomes stale once the company reports; post-print data is preliminary until filing and transcript are available.
- FP&A/accounting: actuals are preliminary until close status is final or the user accepts a soft-close view.
- Private markets: CIM/VDR data can be stale if the package lacks a recent LTM bridge, monthly flash, or updated management model.
- Treasury/cash: bank balance and liquidity data can become stale quickly; mark older-than-requested snapshots as stale.

## Citation format

For every material value, preserve enough locator detail for a reviewer to find the source:

`source_id | source_name | source_type | source_location | period | currency | units | retrieved_at`

Examples:
- `SRC-001 | FY2025 10-K | filing | p. 82 consolidated statements of operations | FY2025 | USD | $mm | 2026-05-06`
- `SRC-004 | ERP actuals export | connected_system | tab GL_Detail rows 1042-1088 | Apr-2026 | USD | ones | 2026-05-06`
- `SRC-007 | Management model | uploaded_xlsx | tab Revenue row 24 col FY2027E | FY2027E | USD | $000 | 2026-05-06`

Use citation text in workbook notes/comments or dedicated citation columns. In chat, cite files/web/connectors using the environment's required citation syntax when available.

## Source conflicts

A source conflict exists when two sources give different values for the same entity, metric, period, and accounting basis beyond immaterial rounding.

When conflicts appear:
1. Preserve both values in `Conflict_Log`.
2. Identify conflict type: `timing`, `definition`, `scale`, `currency`, `restatement`, `pro_forma`, `reported_vs_adjusted`, `provider_standardization`, `mapping`, or `unknown`.
3. Choose a working value only if source hierarchy and task context support it.
4. Label the working value's evidence and confidence.
5. Explain unresolved conflicts before downstream handoff.

## Fact vs assumption handling

Native `financials-normalizer` labels must be preserved in normalized outputs. For downstream skills that use the shared evidence-label taxonomy, also apply the crosswalk in `evidence-label-crosswalk.md` and the shared taxonomy at `../../../references/evidence-label-taxonomy.md` when available.

- Use `fact_source_reported` only for values directly visible in a cited source or connected system.
- Use `fact_provider_standardized` for provider-normalized values even if they are based on filings.
- Use `derived_calculation` when the value is mathematically calculated from cited inputs.
- Use `management_adjusted` for company-defined adjusted metrics or management model adjustments.
- Use `analyst_adjusted` for normalization, add-backs, reclasses, or user/assistant analytical changes.
- Use `assumption_user_provided` for explicit user assumptions.
- Use `assumption_inferred` only when necessary; explain why and how to replace it with evidence.
- Use `estimate_consensus` for consensus, Street estimate, or provider forecast values; include provider and vintage/as-of date.
- Use `missing_required_source` instead of filling unsupported blanks.
