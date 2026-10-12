---
name: excel-data-cleaner
description: clean messy tables for ib analyst workflows. use when spreadsheet or csv data needs headers, dates, numbers, categories, dedupe, or formatting fixed before analysis. do not use for financial spreading; use financials-normalizer.
---

# Excel Data Cleaner

> Internal support playbook. Load through `internal-support/policy.md`; this data-cleaning capability is bundled with the visible router rather than exposed as a skill entrypoint.

## Deliverable Intake

When this skill owns a new substantive user-facing artifact, before source gathering, analysis, modeling, or rendering load `../../../../references/deliverable-intake-policy.md` and perform its adaptive `request_user_input` preflight for materially unresolved preferences. When invoked as a downstream support step within an already scoped workflow, inherit resolved preferences and do not re-prompt.

## Plugin Workflow Routing

For broad transaction workflow prompts, read `../../../../references/plugin-routing-playbook.md` before selecting or sequencing skills. Use this skill as lead only in the workflows named there; when acting as support, preserve validated handoff fields, source IDs, routing metadata, and the artifact hierarchy so the hero deliverable remains the banker-facing workbook, HTML report/dashboard, native deck/document, or clear first-read package.

## Purpose

Clean messy tabular data into an analyst-grade, audit-ready Excel output. Act like a veteran data / operations / finance / investing analyst: preserve decision-critical detail, make cleaning choices explicit, and produce a workbook that another professional can trust, inspect, and immediately use.

This skill is dynamic. First infer what the user is trying to accomplish, then adapt the cleaning logic, validation checks, number formats, and workbook presentation to that domain. Explicit user instructions always override inferred defaults unless they would destroy data integrity.

## Core Rules

1. **User intent wins.** Apply the user's requested cleaning rules first. If a request is ambiguous but not blocking, choose the most conservative professional default and log the assumption.
2. **Never silently destroy information.** Do not drop rows, columns, units, currencies, fiscal labels, IDs, notes, or exceptions without recording the action in an audit log. Prefer flagging uncertain records over deleting them.
3. **Preserve raw data.** For workbook deliverables, keep a `raw_source` sheet or equivalent raw backup unless the user explicitly asks for a clean-only output.
4. **Infer the grain before cleaning.** Determine what one row represents: transaction, customer, account, vendor, security, employee, project, date-period, line item, etc. Use that grain to guide de-duplication and validation.
5. **Separate cleaning from analysis.** Clean and validate before creating summaries. Do not invent missing values, assumptions, mappings, or categories without labeling them as inferred.
6. **Make output professional.** Use clean headers, Excel tables, filters, frozen panes, sensible number formats, widths, data dictionary, quality checks, and assumption/audit sheets.
7. **Be domain-aware.** Finance/investing, operations, sales, product, HR, and procurement datasets require different keys, checks, formats, and exceptions. See `references/domain-playbook.md` when domain-specific judgment matters.

## Artifact Hierarchy

Follow `../../../../references/artifact-manifest-standard.md` before returning generated files. The hero deliverable must be a workbook, HTML report/dashboard, native deck/document, generated folder first-read file, or justified chat-only answer. CSV, JSON, Markdown, run logs, manifests, and handoff payloads are support artifacts unless the user explicitly asks for them. Final responses should lead with the hero deliverable, then companion deliverables, then support artifacts in one short sentence if useful.

## Workflow

### 1. Intake and context inference

Identify, or infer from the file/user prompt:

- objective: clean-only, analysis-ready, board/investor-ready, model input, dashboard source, reconciliation, import file, etc.
- domain: finance, investing, FP&A, accounting, ops, sales/revops, product analytics, HR/people, procurement, legal/regulatory, general admin, or mixed.
- grain: what a single row means.
- must-preserve fields: IDs, timestamps, fiscal periods, tickers, account/customer/vendor names, units, currency, source notes, ownership/status fields.
- required output: updated workbook, cleaned table, data dictionary, issues list, formulas, pivots, or import-ready CSV.

Ask a follow-up only when a decision is genuinely destructive or irreversible, such as whether to merge non-identical duplicates, overwrite source files, or impute business-critical missing values.

### 2. Profile before editing

For `.xlsx`, `.xls`, `.csv`, or `.tsv` inputs, run or emulate the profiling pass before cleaning when the file is non-trivial:

```bash
python scripts/profile_tabular_data.py input.xlsx --output profile.json
```

Use the profile to identify header rows, blank bands, merged-looking structures, duplicate rows, duplicate columns, type inconsistencies, missingness, outliers, and likely domain. If scripts are unavailable, perform the same inspection manually with the available spreadsheet/data tools.

### 3. Create a cleaning specification

Before applying major edits, form a compact cleaning specification with:

- inferred domain and grain
- canonical column names
- type conversions and formats
- duplicate policy
- missing-value policy
- category standardization policy
- validations/checks
- assumptions and risks

Keep the spec internal for simple tasks. Show it to the user when the dataset is high-stakes, the requested transformations are broad, or multiple reasonable cleaning choices exist.

### 4. Clean conservatively and auditably

Apply cleaning in this order:

1. structural cleanup: remove blank leading/trailing bands, identify headers, unmerge/fill down grouped labels only when clearly hierarchical, remove fully empty rows/columns.
2. header cleanup: make headers clear, unique, concise, and domain-appropriate; preserve original header mapping in the data dictionary.
3. type cleanup: trim text, normalize empty tokens, parse dates, parse numbers/currencies/percentages, standardize booleans/statuses, and retain units/currencies.
4. entity cleanup: standardize names/categories/stages/statuses; preserve source values if mapping is uncertain.
5. duplicate handling: remove exact duplicates only when safe; flag potential duplicates unless the key is clear.
6. quality checks: missing required fields, invalid dates, negative values where unexpected, totals/subtotals in detail data, mixed units/currencies, broken IDs, outliers, and inconsistent period labels.
7. formatting: apply professional spreadsheet formatting appropriate to the domain.

For deterministic first-pass cleaning, use:

```bash
python scripts/clean_tabular_data.py input.xlsx --output cleaned.xlsx --domain auto --dedupe exact
```

Then review and refine with judgment. The script is a helper, not a substitute for analyst review.

### Script dependency preflight

`--help` and argument parsing must work with only `pandas` installed. Excel workbook reads/writes require `openpyxl`; if it is missing, install locally from this skill directory with `python3 -m pip install -r scripts/requirements.txt`. Until installed, export workbook sheets to CSV or inspect them manually in Excel/Sheets, and preserve raw data plus audit notes.

### 5. Produce the professional output

Default workbook structure:

- `clean_data`: cleaned, analysis-ready table.
- `raw_source`: unmodified source data.
- `data_dictionary`: original names, cleaned names, inferred types, formats, and notes.
- `quality_checks`: issue counts, affected rows/columns, severity, and recommended action.
- `assumptions_audit`: every material assumption and transformation.
- optional `summary`: concise executive summary, only when useful.

Use `references/workbook-output-spec.md` for workbook deliverable standards. Use `references/cleaning-standards.md` for detailed cleaning rules.

## Domain Routing

Infer domain from the user prompt, sheet names, column names, units, and values. Then apply the relevant domain lens:

- **finance / fp&a / accounting:** preserve fiscal periods, entity/cost center/account codes, currency, actual/forecast/budget labels, sign conventions, one-time vs recurring, and reconciliation totals.
- **investing / markets:** preserve tickers, CUSIPs/ISINs, dates, price/return units, basis points vs percentages, security names, portfolio/account IDs, and benchmark labels.
- **operations:** emphasize owners, status, priority, SLAs, locations, dates, throughput, cycle time, capacity, exceptions, and process bottlenecks.
- **sales / revops:** preserve account/contact/opportunity IDs, stages, ARR/MRR/ACV, close dates, territories, reps, CRM source fields, and churn/renewal status.
- **product / analytics:** preserve event/user/account IDs, timestamps/time zones, experiment labels, cohorts, platforms, and metric definitions.
- **hr / people:** preserve employee IDs, effective dates, org hierarchy, location, job level, compensation units, and privacy-sensitive fields.
- **procurement / vendor / budget:** preserve vendor, contract, PO/invoice, renewal, owner, department, recurring vs one-time, tax, currency, and approval status.

Read `references/domain-playbook.md` when domain-specific checks or formatting affect the cleaning choices.

## Professional Output Standards

Use these defaults unless the user provides a template or different preference:

- Sheet names: lowercase with underscores, concise and descriptive.
- Headers: title-like but compact in Excel tables; no ambiguous labels like `amount_2` unless unavoidable and explained.
- Dates: real Excel dates, displayed as `yyyy-mm-dd` unless fiscal/monthly reporting needs `mmm-yy` or `yyyy-mm`.
- Numbers: right-aligned, thousand separators, sensible decimals; percentages as percent values, not strings.
- Currency: retain currency code if multiple currencies exist; avoid formatting all amounts as USD unless supported.
- Tables: use filters, freeze top row, set widths, wrap long text, and keep formulas intact.
- Data dictionary: include original field, cleaned field, inferred type, example, null count, uniqueness, format, and cleaning notes.
- Quality checks: separate fatal, warning, and informational issues.
- Final response: summarize what changed, what was preserved, unresolved data-quality risks, and recommended next steps.

## Resources

- `scripts/profile_tabular_data.py`: profiles CSV/XLSX data, infers headers/types/domain hints, and emits JSON quality diagnostics.
- `scripts/clean_tabular_data.py`: performs conservative first-pass cleaning and writes a cleaned workbook with raw, dictionary, checks, and audit sheets.
- `references/cleaning-standards.md`: detailed professional cleaning rules and decision policies.
- `references/domain-playbook.md`: domain-specific judgment, validations, and formatting conventions.
- `references/workbook-output-spec.md`: output workbook structure and formatting standards.
- `references/examples.md`: concrete examples of how to apply the skill to common messy-data requests.

## Final Response Pattern

When returning results to the user, include:

1. **What I cleaned:** structural fixes, type conversions, de-duplication, category standardization, formatting.
2. **What I preserved:** raw source, IDs, units, fiscal labels, notes, exceptions.
3. **Issues found:** high/medium/low severity data-quality risks.
4. **Assumptions made:** concise list; distinguish user-directed vs inferred assumptions.
5. **Deliverable:** link to the cleaned file or concise cleaned table, depending on the task.

Do not over-explain routine operations. Focus on the choices a senior analyst or reviewer would care about.
## Dashboard Citation Readiness

<!-- GENERATED: dashboard-citation-readiness START -->

For senior, client, committee, board, lender, or external postures, every material number, estimate, date-sensitive fact, sourced claim, assumption, and recommendation must have inline citation support at the point of use before rendering through `dashboard-builder`. Model-derived claims should cite `model_citations_path` records down to workbook/sheet/cell or range where available.

Unknown citation IDs, missing source registers, or uncited material numeric claims are blocking readiness gaps under `../../../../references/dashboard-citation-readiness-policy.md`. Fix them, downgrade the posture to draft/screen-grade, or surface the missing support as explicit source gaps; do not call the output senior/client/committee/board/external-ready while those gaps remain.

<!-- GENERATED: dashboard-citation-readiness END -->

## Dashboard Handoff

When the user asks for an HTML dashboard, HTML report, MD dashboard, cockpit, command center, visual diligence overview, or a more readable version of a memo/report, keep this skill as the analytical owner and add a `dashboard-builder` packaging step. Build an internal source-aware render contract and render through `dashboard-builder` using `dashboard`, `report_only`, or `hybrid` mode. The internal contract is not the user-facing deliverable. Use the generated HTML as the reader-facing report/dashboard and include blocked-output context plus supporting-artifact explanations inside the page.

Do not fork or maintain separate HTML/CSS/JS inside this skill. Do not expose raw JSON or Markdown report files as the default final artifact.

## Deliverable Format Standard

Follow `../../../../references/deliverable-format-policy.md` before creating files. Always identify the hero deliverable first: XLSX workbook, HTML report, HTML dashboard, native deck/document, generated folder, or justified chat-only answer. Do not create Markdown report files as the default rich deliverable. Do not present JSON contracts, manifests, run logs, or handoff payloads as the main user-facing output. Keep CSV files as backing ledgers/import layers unless the user explicitly asks for CSV, and explain whether each CSV contains new analysis or only support data.

Final responses should point the user to the hero deliverable first and then briefly explain any supporting artifacts.
