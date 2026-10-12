# Output Specification

All generated paths are relative to the selected `--output-dir`; when omitted, scripts default to `./output` from the caller's current working directory. Do not generate artifacts into the skill package unless the user explicitly passes that path.

Deterministic mode writes `model.xlsx`, `plan.json`, `run_log.json`, and `manifest.json`. It writes legacy `report.md` only when `--write-report-md` is explicitly requested. Formula mode writes `banker_formula_workbook.xlsx`, `banker_formula_workbook_run_log.json`, and `manifest.json` without overwriting deterministic logs.

The workbook is the hero human deliverable. `manifest.json`, run logs, normalized plans, and any legacy Markdown reports are support artifacts unless the user explicitly asks for them.

The first visible workbook tab must be `Cover`, `Executive Summary`, or `Dashboard` and follow `../../../references/workbook-first-tab-standard.md`: valuation range, WACC/growth, revenue, EBITDA, FCF, terminal value, sensitivity outputs, source confidence, risks, next steps, and model map. Its first-read status block must show two explicitly labeled fields: `Calculation integrity` and `Decision readiness`; passing formula/control tie-outs must not be presented as an overall `OK` when material source or judgment items remain open.

For public-company strategic alternatives or market-reference screens, the first visible tab should also show current trading, implied premium or discount, terminal value as a percent of EV, the material EV-to-equity bridge choices, and what would change the conclusion. If the DCF indicates a material premium or discount to current trading, include a compact `Market-Implied Expectations` controlled numeric reverse-DCF view. It must solve for at least one operating or valuation assumption that reconciles current trading with the DCF while clearly identifying the held-constant base assumptions: hold base WACC and terminal growth constant while solving for operating performance, or hold base operating assumptions constant while solving for WACC or terminal growth. A narrative comparison with a composite scenario alone does not satisfy this requirement.

Use one scenario order consistently across the workbook and cover note, ordinarily `Downside`, `Base`, `Upside`. When presenting a quoted sensitivity range or dollar spread, say whether it is a base-centered control range or the full displayed sensitivity spread.

Workbook modes:
- `deterministic_export`: code-computed values workbook from `scripts/run_pipeline.py`.
- `banker_formula_workbook`: shipped formula template materialized by `scripts/build_banker_formula_workbook.py`; not an arbitrary formula-generation engine.

`model.xlsx` sheets:
- `Summary`: scenario EV, equity value, per-share value, WACC/cost of equity, terminal value, PV of FCF, and TV percent of EV.
- `Model`: long-format rows with section, line item, scenario, period, value, units, evidence label, source id, and notes.
- `Sensitivities`: WACC/terminal growth, WACC/exit multiple, and revenue-growth/EBIT-margin cases.
- `Checks`, `Assumptions`, and `Run Log`: QA results, source basis, assumptions, paths, and status.

Formula workbook required sheets: Cover, Executive Summary, Control Panel, Historical Financials, Revenue Build, Margin Cost Build, Working Capital, Capex D&A, Tax Schedule, Unlevered FCF, WACC, Terminal Value, DCF Valuation, Sensitivities, Checks, Source Notes. Inspection must confirm sheets, preserved formulas/styles, and no external links.

`run_log.json` must include `model_status`, `workbook_mode`, `source_basis`, `hard_failures`, `warnings`, `assumptions`, `checks`, and `p0_handoff`. Store each formula-error scan result as an explicit result or match count, rather than referring only to console output. If hard failures exist, status must be `not-decision-ready`.

Allowed statuses: `decision-grade`, `senior-review-ready`, `screen-grade`, `not-decision-ready`, `blocked`. Use `blocked` only before a run log exists.

`p0_handoff` should include selected valuation range, downside/base/upside values, WACC and terminal assumptions, key drivers, caveats, model status, and artifact paths.

Any chat cover note or explicitly requested standalone HTML companion should cover status, valuation range, scenario table, DCF bridge, WACC/terminal assumptions, sensitivities, calculation integrity, decision readiness, source caveats, and generated artifacts. When HTML is explicitly requested, follow `../../../references/html-artifact-standard.md`, cite workbook-derived claims through exact `model_citations` records where available, and do not create a dashboard render contract.
