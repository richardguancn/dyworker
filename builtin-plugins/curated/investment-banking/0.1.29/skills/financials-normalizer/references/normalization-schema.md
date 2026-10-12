# Normalization schema

Use this schema for model-ready financial outputs. Prefer long-form staging first; pivot to wide statements only after QA.

## Source_Index

Required columns:
- `source_id`: stable identifier such as `SRC-001`.
- `source_name`: file, system, report, filing, provider, or source title.
- `source_type`: `uploaded_file`, `connected_system`, `filing`, `earnings_release`, `transcript`, `investor_deck`, `provider`, `web`, `user_prompt`, `assumption`.
- `owner_or_provider`: source owner, provider, or uploader when known.
- `period_covered`: period(s) covered by source.
- `as_of_date`: report date, filing date, close date, data snapshot date, or version date.
- `retrieved_at`: date/time the assistant accessed or used the source.
- `file_tab_page_url_or_location`: page, tab, cell, row, URL, connected table, or object reference.
- `source_rank`: rank from source protocol.
- `freshness_status`: `current`, `acceptable_for_period`, `preliminary`, `stale`, `unknown`.
- `notes`: caveats, version notes, limitations.

## Normalized_Financials_Long

Required columns:
- `entity`
- `source_id`
- `statement`: `income_statement`, `balance_sheet`, `cash_flow`, `kpi_schedule`, `segment`, `debt_schedule`, `share_count`, `working_capital`, `adjustment`
- `line_item_original`
- `line_item_standard`
- `line_item_id`
- `period_end`: `YYYY-MM-DD` when known.
- `period_label`: source period label such as FY2025, Q1-2026, LTM Sep-2025, Apr-2026.
- `period_type`: `annual`, `quarterly`, `monthly`, `ytd`, `ltm`, `forecast`, `budget`, `pro_forma`, `scenario`.
- `currency`
- `units`: source or normalized unit such as ones, $000, $mm, %, bps.
- `source_value`: exact extracted value where possible.
- `normalized_value`: numeric value in normalized unit/sign convention.
- `normalization_method`: e.g. `as_reported`, `scaled_to_mm`, `percent_to_decimal`, `bps_to_decimal`, `sign_flipped`, `calculated`, `mapped`, `currency_converted`, `missing_value`, `unparsed_text_value`.
- `source_location`: page, table, tab, cell, row, URL, or system object.
- `evidence_label`: one of the native labels required in SKILL.md.
- `canonical_evidence_category`: shared-taxonomy category from `evidence-label-crosswalk.md` for downstream handoff when applicable.
- `confidence`: `high`, `medium`, or `low`.
- `normalization_note`

Parsing expectations:
- Preserve the source text in `source_value`; do not replace it with the parsed number.
- Normalize percentages to decimal form with `normalization_method=percent_to_decimal` and `units=decimal`.
- Normalize basis points to decimal form with `normalization_method=bps_to_decimal` and `units=decimal`.
- Normalize clear currency scales to `$mm` when possible, while documenting the method in `normalization_note`.
- Leave ambiguous narrative values blank with `normalization_method=unparsed_text_value` and an open `QA_Flags` item rather than guessing.

## Wide outputs

Pivot long-form values into these sheets only after staging:
- `Executive_Summary` or `Cover`
- `Normalized_IS`
- `Normalized_BS`
- `Normalized_CF`
- `KPI_Schedule`
- `Debt_Schedule`
- `Share_Count`
- `Segment_Financials`
- `Working_Capital`
- `Checks`

Each wide output should retain source/citation columns or companion note columns if cell-level comments are not supported.

For financing, leverage, acquisition financing, or take-private normalization work, include two decision-facing views in addition to the audit ledgers:

### EBITDA_Treatment_Matrix

Use for reported-to-adjusted EBITDA questions and add-back diligence. Required fields:
- `item`
- `amount`
- `source_period`
- `source_id`
- `source_or_company_treatment`
- `included_in_company_metric`
- `preliminary_financing_treatment`
- `cash_or_non_cash_status`
- `recurrence_or_run_rate_risk`
- `double_count_risk`
- `required_support`
- `readiness_status`

Keep reported operating results, company-disclosed adjustments, management projections, derived calculated metrics, and accepted financing EBITDA separate. Do not label a company-defined, projected, YTD, or calculated EBITDA value as lender-approved LTM EBITDA without direct support.

### Net_Debt_Treatment_Matrix

Use for cash/debt, debt-like, cash-like, leakage, and funds-flow questions. Required fields:
- `item`
- `amount`
- `source_id`
- `reported_classification`
- `included_in_cash_only_baseline`
- `candidate_treatment`
- `accepted_treatment`
- `required_support`
- `readiness_status`

Do not automatically include, exclude, or net leases, litigation or settlement obligations, securitization facilities, derivatives, restricted cash, investments, pensions, minority interests, preferred equity, commitments, or other disputed perimeter items without supporting definitions and diligence.

### First-Read Status Fields

For financing-use workbooks, the first visible tab must show these separately:
- `Reported statement integrity`: tie-outs and source-reported statement reliability.
- `EBITDA readiness`: whether a usable financing EBITDA denominator and accepted add-back bridge exist.
- `Net debt readiness`: whether accepted debt-like/cash-like treatment and opening bridge are defined.
- `Financing model handoff`: whether the normalized package can flow into a financing model, and with what limitations.

Do not collapse clean reported-statement ties into a claim that the EBITDA denominator, net debt perimeter, or financing-model handoff is ready.

### Workbook Presentation Roles

Treat `Executive_Summary` or `Cover`, material EBITDA/net-debt treatment views, normalized statement summaries, and `Checks` as reader-facing tabs that must be legible at normal zoom when rendered. Treat `Normalized_Financials_Long`, `Mapping_Dictionary`, complete source indexes, and detailed companion logs as audit ledgers: preserve their columns and traceability, but do not rely on full-sheet renders of wide ledgers as evidence of a polished first-read deliverable.

## Sign conventions

Default institutional modeling convention:
- Revenue, gross profit, EBITDA, operating income, pretax income, net income: positive when income/profit.
- Expenses: positive as line-item values unless a downstream model explicitly requires negative expenses.
- Assets, liabilities, equity, cash, debt: positive balances.
- Cash-flow inflows: positive. Cash-flow outflows: negative.
- Capex: negative in cash-flow outputs; positive as a separate operating driver if requested by downstream model.
- Changes in working capital: preserve source cash-flow sign; do not convert to balance-sheet delta without documenting method.
- Share count and per-share data: preserve units separately from currency.

## Scaling and currency

- Preserve source scale in `source_value` / `units` and normalized scale in `normalized_value` / `units`.
- Default to `$mm` for institutional finance work unless user/source/downstream model specifies another unit.
- Do not convert currency unless requested or needed for comparability. When converting, include FX rate, date, and source in `normalization_note` and `Source_Index`.

## Required companion logs

### Adjustments_Log
Use for all normalized, pro forma, management, QoE, lender, or analyst adjustments. Include: `adjustment_id`, `entity`, `period`, `metric`, `amount`, `direction`, `reason`, `source_id`, `evidence_label`, `canonical_evidence_category`, `confidence`, `included_in_output`, and `preliminary_model_treatment` when downstream model use is contemplated.

### Conflict_Log
Use for material conflicting values. Include: `conflict_id`, `entity`, `metric`, `period`, `source_a`, `value_a`, `source_b`, `value_b`, `conflict_type`, `working_value`, `resolution_basis`, `open_question`.

### Assumptions_Register
Use for user or inferred assumptions. Include: `assumption_id`, `assumption`, `source_or_owner`, `rationale`, `affected_outputs`, `evidence_label`, `canonical_evidence_category`, `confidence`, `replacement_source_needed`.

### QA_Flags
Use for exceptions. Include: `flag_id`, `severity`, `entity`, `period`, `area`, `issue`, `impact`, `recommended_fix`, `source_id`, `status`.
