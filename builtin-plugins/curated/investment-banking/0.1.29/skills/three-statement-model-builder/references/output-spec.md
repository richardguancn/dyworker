# Output Specification

All generated paths are relative to the selected `--output-dir`; when omitted, scripts default to `./output` from the caller's current working directory. Do not generate artifacts into the skill package unless the user explicitly passes that path.

Deterministic mode writes `model.xlsx`, `plan.json`, `run_log.json`, `model_citations.json`, and `manifest.json`. It writes legacy `report.md` only when `--write-report-md` is explicitly requested. Formula mode writes `banker_formula_workbook.xlsx`, `banker_formula_workbook_run_log.json`, `model_citations.json`, and `manifest.json` without overwriting deterministic logs.

The workbook is the hero human deliverable. `manifest.json`, run logs, normalized plans, model-citation ledgers, and any legacy Markdown reports are support artifacts unless the user explicitly asks for them. A citation ledger must point to the exact workbook returned as the hero deliverable; a separate control export may not supply the cited numbers for a renamed, restyled, or substituted workbook unless the two are explicitly reconciled.

The first visible workbook tab must be `Cover`, `Executive Summary`, or `Dashboard` and follow `../../../references/workbook-first-tab-standard.md`: company/forecast status, key operating metrics, scenario outputs, liquidity/covenants, source confidence, risks, next steps, and model map. Its first-read status block must show two explicitly labeled fields: `Calculation integrity` and `Decision readiness`; passing formula/control tie-outs must not be presented as an overall `OK` when material forecast, liquidity, covenant, working-capital or capex evidence remains open. The same distinction must be used on the `Checks` sheet and any other visible status block; generic `Model status` or `Overall` rows must not read `OK` while decision readiness is limited.

For an initial strategic alternatives or public-source operating screen, the first visible tab should show the key volume and price/mix trajectory where relevant, margin bridge, FCF and leverage or liquidity trajectory, and downside drivers. If debt documents or covenant definitions are unavailable, mark debt draws, cash sweeps, covenant headroom and minimum cash constructs as illustrative and cap decision readiness at `screen-grade`.

Workbook modes:
- `deterministic_export`: code-computed IS/BS/CF export from `scripts/run_pipeline.py`.
- `banker_formula_workbook`: shipped formula template materialized by `scripts/build_banker_formula_workbook.py`; not an arbitrary formula-generation engine.

`model.xlsx` sheets: `Summary`, `Model`, `Sensitivities`, `Checks`, `Assumptions`, `Sources`, and `Run_Log`.

`Model` rows should include scenario, statement, section, line item, period, value, unit, evidence label, source id, formula basis, and notes. Required statement groups include IS, BS, CF, debt, working capital, PP&E, covenants/liquidity, and checks.

Formula workbook required sheets: Cover, Executive Summary, Control Panel, Historical Financials, Revenue Build, Expense Build, Income Statement, Working Capital, PP&E D&A, Debt Interest, Tax, Balance Sheet, Cash Flow Statement, Scenarios, Checks, Source Notes. Inspection must confirm sheets, formulas, styles, and no external links.

`run_log.json` must include model status, workbook mode, artifact level, source basis, hard failures, warnings, assumptions, checks, `model_citations_path`, and `p0_handoff`. Store each formula-error scan result as an explicit result or match count, and identify the exact hero workbook to which `model_citations_path` applies. If hard failures exist, status must be `not-decision-ready`.

Allowed statuses: `decision-grade`, `senior-review-ready`, `screen-grade`, `not-decision-ready`, `blocked`.

Any chat cover note or explicitly requested standalone HTML companion should include status, scenario summary, operating read-through, cash conversion, liquidity/covenants, QA, source caveats, and artifact paths. When HTML is explicitly requested, follow `../../../references/html-artifact-standard.md`, cite workbook-derived claims through exact hero-workbook `model_citations` records where available, and do not create a dashboard render contract.
