# Banker Formula Workbook Contract

Formula mode materializes `assets/templates/banker_formula_workbook_template.xlsx`. It preserves formulas, tabs, styles, and checks, then writes plan-derived inputs, source labels, warning posture, and scenario controls.

Run with `python3 scripts/build_banker_formula_workbook.py path/to/plan.json --output-dir output`.

Outputs:
- `banker_formula_workbook.xlsx`
- `banker_formula_workbook_run_log.json`
- `model_citations.json`
- `manifest.json`

The workbook is the human deliverable. The run log, model-citation ledger, and manifest are agent-facing support artifacts. The run log must include workbook mode, artifact level, template path, output paths, partial-context warning, missing inputs, warnings, hard failures, inspection results, formula-mode limitations, and `model_citations_path`.

The first-read workbook surface and the `Checks` sheet must show `Calculation integrity` separately from `Decision readiness`. Formula preservation, formula-error scans or statement tie-outs may be `OK` while source posture remains `OPEN` or `screen-grade`; do not collapse those states into one overall green status or retain an `Overall: OK` row on another visible tab.

`model_citations.json` must be generated against `banker_formula_workbook.xlsx` itself and must reconcile headline revenue, EBITDA, FCF, ending cash, ending debt and leverage outputs used outside the workbook. If an agent restyles, renames or replaces the human-deliverable workbook, regenerate and verify a citation ledger against the delivered file; do not attach the ledger from a deterministic-control workbook or an earlier formula-workbook variant.

The template materializer's initial `model_citations.json` may identify workbook sections before formulas have been recalculated. Treat that ledger as an outline only: map the headline output cells after recalculation before describing the workbook as senior-review-ready or reusing values outside the workbook.

Record formula-error scan evidence in the run log as an explicit result or match count, including a zero-result where no errors are detected; do not rely on transient console output as the only evidence.

Do not claim formula mode rebuilds every formula, evaluates Excel formulas in Python, or creates arbitrary workbook architecture. Use deterministic mode for controlled computed outputs; use formula mode when the user needs a live Excel shell.
