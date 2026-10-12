---
name: financials-normalizer
description: convert messy deal financials into model-ready statements, kpi schedules, source maps, and qa flags. use when an ib workflow needs spreading, normalization, or reconciliation. do not use for generic spreadsheet cleanup; use excel-data-cleaner.
---

# Financials Normalizer

## Skill Configuration

### Common Skill Instructions

MANDATORY: Before searching connectors, retrieving evidence, or drafting output, read and apply the shared runtime contract in `../investment-banking/SKILL.md## Cross-Skill Runtime Contract`. Then check the router skill map and `../../references/plugin-routing-playbook.md` for adjacent skills that should be sequenced with this workflow. Do not run user-context setup or inspection during ordinary workflow work; route only explicit saved-context, source-setup, onboarding, or automation-setup requests to `../user-context/SKILL.md`.

### Source Resolution

Load `../../references/workflow-source-resolution.md`. Resolve only the categories needed for this workflow: `deal_materials`, `market_data_public_sources`, and `models_workbooks_templates`. Use the shared runtime contract to map each attempted category to an available app, connector, file, export, or user-provided input.

## Relevant Dependency Categories

These are the source categories most likely to matter for this workflow. Use the router contract to resolve only the categories the task actually needs, prefer user-named sources first, and state any material source limitation.

- `Models, Workbooks & Templates`
- `Deal Materials`
- `Market Data & Public Sources`

## Deliverable Intake

When this skill owns a new substantive user-facing artifact, before source gathering, analysis, modeling, or rendering load `../../references/deliverable-intake-policy.md` and perform its adaptive `request_user_input` preflight for materially unresolved preferences. When invoked as a downstream support step within an already scoped workflow, inherit resolved preferences and do not re-prompt.

## Plugin Workflow Routing

For broad transaction workflow prompts, read `../../references/plugin-routing-playbook.md` before selecting or sequencing skills. Use this skill as lead only in the workflows named there; when acting as support, preserve validated handoff fields, source IDs, routing metadata, and the artifact hierarchy so the hero deliverable remains the banker-facing workbook or an explicitly requested standalone HTML normalization summary, native deck/document, or clear first-read package.

## Purpose
Turn messy source financials into auditable, model-ready normalized financial statements, KPI schedules, mappings, source citations, assumptions, conflicts, and QA flags for downstream finance skills.

This is a shared-core skill. Use it before valuation, LBO, transaction modeling, credit underwriting, memo, and deck workflows whenever the source financials are raw, fragmented, inconsistent, stale, or not tied out.

## Output Depth

Default to `extended_analysis`: produce or describe the full normalized package, source index, mapping logic, conflicts, assumptions, QA flags, source/evidence posture, and downstream readiness whenever financials will feed a model, memo, credit view, deck, or valuation. Use a shorter chat summary only when the user explicitly asks for it, the source context is too thin and the right answer is a source checklist/schema, or the main deliverable is already a workbook/package and chat is only a cover note. Read `../../references/output-depth-policy.md` before shortening.

## Artifact Hierarchy

Follow `../../references/artifact-manifest-standard.md` before returning generated files. For substantive normalization work, the normal hero deliverable is a polished banker-readable workbook with an insight-led first visible tab. Create a standalone HTML normalization summary only when the user explicitly requests HTML or a narrative companion; the workbook and supporting ledgers remain the normalized source of truth. CSV, JSON, Markdown, run logs, manifests, and handoff payloads are support artifacts unless the user explicitly asks for them. Final responses should lead with the hero deliverable, then companion deliverables, then support artifacts in one short sentence if useful.

## Non-negotiables
- Preserve source materials. Never delete, overwrite, hide, rename, or destructively transform raw tabs/files unless the user explicitly requests it.
- Prefer sources in this order: user-provided context/files, callable connected routes and internal-source exports, then public web sources for public-company or public-market data, then clearly labeled user/assistant assumptions.
- Never invent missing financials. Leave unavailable values blank or mark `missing_required_source`; explain what source is needed.
- Treat values as facts only when directly supported by evidence. Label derived values, standardized provider values, management adjustments, analyst adjustments, user assumptions, and inferred assumptions separately.
- Keep every normalized value traceable to `source_id`, `source_name`, `source_location`, `retrieved_at`, period, units, currency, and evidence label whenever available.
- If sources conflict, retain both values in `Conflict_Log`; do not silently choose one unless hierarchy and context make the decision clear.
- If freshness is uncertain, flag it. Clean stale data remains stale.
- If working in a workbook, write normalized outputs to new tabs or a new workbook and preserve raw/source tabs.

## Adaptive intake

### No context
1. Identify any target implied by the request: entity, ticker, borrower, portfolio company, business unit, period, statement type, or downstream use case.
2. Search callable connected routes or user-provided internal-source exports first when available.
3. For public companies, fall back to the latest primary filings, earnings releases, and company materials before secondary providers.
4. If the target or period is still unknown, ask for only the minimum blocking item. If the user wants a blank template, create the normalized schema and source checklist without values.

### Partial context
1. Use provided context as the working scope.
2. Fill non-blocking gaps from callable connected routes, user-provided exports, or public primary sources when appropriate.
3. Mark all filled values with source type, evidence label, confidence, and retrieval date.
4. Continue if missing information does not block normalization; otherwise ask only for the blocking source or assumption.

### Full context/files
1. Treat supplied files as the source package.
2. Build a source index before extraction.
3. Normalize into new outputs, never the raw materials.
4. Reconcile and QA before handing off to downstream skills.

## Workflow

### 1. Classify the normalization job
Classify the user’s context because the target schema and source hierarchy vary:
- **investment banking / private markets:** CIMs, VDR exports, QoE reports, management models, historical financials, revenue/KPI packs, debt, NWC, add-backs.
- **public markets:** filings, earnings releases, transcripts, investor decks, consensus, guidance, KPIs, segment data, share count, net debt.
- **private credit / lending:** borrower financials, collateral schedules, bank statements, EBITDA add-backs, covenant inputs, liquidity, debt schedule.
- **corporate finance / fp&a / accounting:** ERP/GL actuals, subledgers, planning exports, cost centers, departments, headcount, forecast versions, close status.

### 2. Build the source index
Create `Source_Index` before extracting values. Include: `source_id`, `source_name`, `source_type`, `owner_or_provider`, `period_covered`, `as_of_date`, `retrieved_at`, `file_tab_page_url_or_location`, `source_rank`, `freshness_status`, and `notes`.

Consult `references/source-protocol.md` for source hierarchy, stale-data thresholds, conflict handling, and citation format.

### 3. Extract to long-form staging
Extract values into `Normalized_Financials_Long` first, even if final statements are wide. Required columns:
`entity`, `source_id`, `statement`, `line_item_original`, `line_item_standard`, `line_item_id`, `period_end`, `period_label`, `period_type`, `currency`, `units`, `source_value`, `normalized_value`, `normalization_method`, `source_location`, `evidence_label`, `canonical_evidence_category`, `confidence`, `normalization_note`.

Consult `references/normalization-schema.md` and `references/line-item-taxonomy.md` for canonical statements, KPI schedules, sign conventions, and mapping rules.

### 4. Normalize periods, scale, currency, signs, and labels
- Periods: standardize to `YYYY-MM-DD` period-end dates and label annual, quarterly, monthly, LTM, YTD, forecast, budget, pro forma, or scenario.
- Units: preserve original units; normalize to the user’s requested unit or default to `$mm` for institutional finance outputs.
- Currency: preserve source currency unless conversion is requested or necessary; if converted, cite FX rate source and date.
- Signs: preserve `source_value`; use `normalized_value` and `normalization_method` to avoid losing source sign context.
- Labels: preserve exact source labels next to standardized labels.
- Adjustments: keep reported, adjusted, pro forma, management-adjusted, analyst-adjusted, provider-standardized, and estimated values separate.

### 5. Reconcile and QA
Run the QA rules in `references/qa-rules.md` before returning outputs. At minimum check:
- subtotal and roll-forward tie-outs
- balance sheet balance
- cash flow bridge where possible
- units/currency consistency
- duplicate periods and duplicate line items
- missing required sources
- stale or preliminary sources
- conflicting values across sources
- sign convention anomalies
- unsupported non-GAAP or KPI definitions

Use `scripts/normalize_extracted_financials.py` when extracted financial rows are available as CSV/JSON and deterministic unit, percent, bps, evidence, and companion-log handling would help. Use `scripts/validate_normalized_financials.py` when a normalized CSV exists and deterministic schema checks would help; add `--require-package` when validating the full output package. For workbook inputs, first extract the relevant tab/range with spreadsheet tools into a table or CSV; do not let scripts destructively modify workbooks.

### 6. Produce the normalized package
Default spreadsheet/workbook outputs:
1. `Executive_Summary` or `Cover` first-read tab
2. `Source_Index`
3. `Normalized_Financials_Long`
4. `Normalized_IS`
5. `Normalized_BS`
6. `Normalized_CF`
7. `KPI_Schedule`
8. `Adjustments_Log`
9. `Conflict_Log`
10. `Assumptions_Register`
11. `QA_Flags`
12. `Mapping_Dictionary`
13. `Checks`

For financing, leverage, or take-private use cases, also create readable decision-facing `EBITDA_Treatment_Matrix` and `Net_Debt_Treatment_Matrix` views, whether as named tabs or clearly bounded sections on the first-read/bridge tabs. These are review surfaces; `Normalized_Financials_Long`, source maps, and complete logs remain audit ledgers and need not function as presentation tabs.

The first visible tab must state the decision question, period and units, source posture, material normalized outputs, highest-priority open diligence items, and downstream readiness. In financing use cases, label a forecast denominator as `Management-Projected EBITDA` rather than accepted EBITDA, label committed financing as context only unless opening capitalization is established, and show separate `Reported statement integrity`, `EBITDA readiness`, `Net debt readiness`, and `Financing model handoff` statuses. Preserve those qualifiers in headline KPI strips and summary tables; use labels such as `Management-Projected FY2025E Adj. EBITDA` and `Committed Buyer Debt (Context Only)` rather than abbreviations that could imply accepted financing metrics or opening net debt.

Render and visually inspect the first-read tab, material treatment matrices or bridge tabs, normalized statements, and checks tab before delivery. Keep decision-facing tabs legible at normal zoom with wrapped text and bounded column widths. Detailed source, mapping, adjustment, conflict, and long-form staging ledgers may be compact audit tabs, but do not treat an unreadable full-sheet ledger render as reader-facing polish.

For chat-only tasks, still default to an extended normalization readout with the most material normalized tables, QA findings, conflict/assumption treatment, source posture, and downstream readiness. If evidence is insufficient, return a source request checklist, proposed schema, known context, missing-data table, and recommended next action.

## Sub-agent decomposition

For complex medium/large requests, use sub-agents where available; otherwise emulate the split as named workstreams. Suggested lanes: source extraction, line-item mapping, conflict resolution, reconciliation, and downstream-readiness QA. Keep this skill as the lead: reconcile conflicts, source labels, assumptions, open items, final QA, and the user-facing answer.


## Evidence labels
Use these exact native labels in `financials-normalizer` outputs. Preserve them exactly in `evidence_label` even when a downstream skill also needs a shared/canonical evidence category. For downstream handoffs, map them through `references/evidence-label-crosswalk.md` and the shared taxonomy at `../../references/evidence-label-taxonomy.md` when that shared file is available.
- `fact_source_reported`: directly sourced from a primary source or connected system.
- `fact_provider_standardized`: sourced from a trusted provider-standardized dataset.
- `derived_calculation`: calculated from sourced inputs.
- `management_adjusted`: company or management-defined adjusted metric.
- `analyst_adjusted`: user/assistant normalized or adjusted value.
- `assumption_user_provided`: assumption supplied by the user.
- `assumption_inferred`: inferred from context; disclose and use low confidence unless confirmed.
- `estimate_consensus`: consensus, Street estimate, or provider forecast.
- `missing_required_source`: required value unavailable.

When handing normalized data to another skill, include both:
- `evidence_label`: the exact native label above.
- `canonical_evidence_category`: the mapped shared-taxonomy category from `references/evidence-label-crosswalk.md`.

Do not overwrite native labels to fit another skill's accepted labels. If a downstream validator only accepts canonical categories, add a companion field or handoff note rather than mutating the normalizer output.

## Confidence labels
Use `high`, `medium`, or `low`:
- `high`: primary source or connected system; current period; clear label, units, and period.
- `medium`: credible secondary/provider source or clear source with minor mapping ambiguity.
- `low`: inferred mapping, stale/preliminary source, unclear period/units, OCR-heavy extraction, or source conflict.

## Downstream handoffs
- Use `financial-source-of-truth` when available for enterprise source routing, access controls, hierarchy, and citation discipline.
- Use `excel-data-cleaner` first when the spreadsheet layout itself blocks extraction: broken headers, merged cells, multi-table tabs, blank rows, malformed dates, or export artifacts.
- Use `model-audit-tieout` after normalized data is inserted into an existing or generated model.
- Use `scenario-sensitivity-generator` only after a clean base case exists.
- Hand off to `memo-builder`, `private-credit-underwriting`, `covenant-package-analyzer`, `comps-valuation`, `dcf-model-builder`, `lbo-model-build`, `merger-model-builder`, `three-statement-model-builder`, `pitch-deck-builder`, or `ib-deck-qc` only after material QA flags are disclosed.

Consult `references/integration-guide.md` for plugin-specific handoffs.

## Final response format
When returning results, use:
1. **What I normalized**: entity, sources, periods, units, currency, scope.
2. **Outputs created**: tables/tabs/files produced.
3. **Material QA findings**: tie-out breaks, stale data, missing values, conflicts, sign/unit issues.
4. **Fact vs assumption summary**: what is source-reported, derived, adjusted, estimated, or assumed.
5. **Recommended next step**: downstream skill or missing source needed.

Keep the response finance-grade and practical. Do not bury the user in generic accounting explanations.

## References
- `references/source-protocol.md`: evidence hierarchy, stale-data checks, citations, source conflicts, and assumption/fact labels.
- `references/normalization-schema.md`: canonical output schema, periods, signs, scales, and evidence labels.
- `references/evidence-label-crosswalk.md`: native-to-shared evidence taxonomy mapping and downstream handoff contract.
- `../../references/evidence-label-taxonomy.md`: shared evidence-label taxonomy when available; use it as the canonical target while preserving this skill's native labels.
- `references/line-item-taxonomy.md`: starter financial statement and KPI mapping rules.
- `references/qa-rules.md`: reconciliation tests, materiality thresholds, and red flags.
- `references/integration-guide.md`: how this skill composes with the other launch skills.
- `../../references/output-depth-policy.md`: read when deciding whether a concise normalization summary is justified; default to `extended_analysis`.
- `../../references/workbook-first-tab-standard.md`: required first-read workbook decision view.
- `../../references/html-artifact-standard.md`: optional standalone HTML companion and visual QA standard.

## Workbook Evidence Readiness

The workbook is the primary human deliverable and the normalized ledgers are its evidence layer. For senior, client, committee, board, lender, or external postures, every material reported amount, disclosed adjustment, derived metric, proposed EBITDA treatment, proposed net-debt treatment, and readiness conclusion must be traceable to readable source notes and the underlying ledger record or workbook cell/range where available.

Unknown source IDs, unlocated material values, unsupported add-back or debt-perimeter treatments, missing definition support, or unresolved blocker flags are blocking readiness gaps. Fix them, cap the posture at preliminary/partial, or surface them explicitly; do not call normalized outputs financing-model-ready, lender-ready, senior-ready, or external-ready while they remain.

For financing use cases, disclosed adjustments remain separate from accepted EBITDA treatment and debt-like/cash-like candidates remain separate from accepted net debt treatment until the required definition or diligence support is available. A reported statement tie-out may be `OK` while EBITDA readiness, net debt readiness, or financing model handoff remains `PARTIAL`, `OPEN`, or `BLOCKED`.

## Optional HTML Companion

When the user explicitly requests an HTML report or visual normalization summary, keep this skill as the analytical owner and produce a polished standalone HTML companion following `../../references/html-artifact-standard.md`. Do not route an ordinary normalization package through `dashboard-builder`, create a dashboard render contract, or substitute a visual wrapper for the model-ready workbook and audit ledgers.

In that HTML companion, keep reported facts, management-adjusted metrics, analyst treatment decisions, and readiness limitations visibly distinct. Render and visually inspect local HTML with local headless-browser screenshots, not the in-app Browser plugin, before delivery. Do not expose raw JSON, Markdown files, or full audit ledgers as the default final artifact.

## Deliverable Format Standard

Follow `../../references/deliverable-format-policy.md` before creating files. Always identify the hero deliverable first: normally the XLSX normalization workbook; an explicitly requested standalone HTML normalization summary; native deck/document; generated folder; or justified chat-only answer. Do not create Markdown report files as the default rich deliverable. Do not present JSON contracts, manifests, run logs, audit-ledger CSVs, or handoff payloads as the main user-facing output. Keep CSV files as backing ledgers/import layers unless the user explicitly asks for CSV, and explain whether each CSV contains new analysis or only support data.

Final responses should point the user to the hero deliverable first and then briefly explain any supporting artifacts.
