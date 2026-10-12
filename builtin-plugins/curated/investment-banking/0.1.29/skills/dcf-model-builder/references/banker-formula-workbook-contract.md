# Banker Formula Workbook Contract

Formula mode materializes the bundled workbook at `assets/templates/banker_formula_workbook_template.xlsx`. It preserves existing formulas, tabs, styles, and checks, then writes plan-derived inputs, source notes, scenario controls, and posture warnings.

Run with `python3 scripts/build_banker_formula_workbook.py path/to/plan.json --output-dir output`.

Outputs:
- `banker_formula_workbook.xlsx`
- `banker_formula_workbook_run_log.json`
- `manifest.json`

The workbook is the human deliverable. The run log and manifest are agent-facing support artifacts. The run log must include workbook mode, artifact level, template path, output paths, partial-context warning, missing inputs, warnings, hard failures, inspection results, and formula-mode limitations.

Inspection expectations: required sheets present, formulas preserved, style records present, and no external links. The formula log must not overwrite deterministic `run_log.json`.

The first-read workbook surface must show calculation integrity separately from decision readiness. Formula preservation, recalculation, or tie-out checks may be `OK` while source posture remains `OPEN` or `screen-grade`; do not collapse those states into a single green overall status.

Record the exact template path and plugin version used for formula-workbook materialization. If the run log points to a different installed plugin version than the skill invoked for the run, surface the provenance mismatch and rerun from the intended active version before delivery.

Record formula-error scan evidence in the run log as an explicit result or match count, including a zero-result where no errors are detected; do not rely on transient console output as the only evidence.

Do not claim this mode rebuilds every formula, evaluates Excel formulas in Python, or creates arbitrary workbook architecture. Use deterministic mode for controlled computed outputs; use formula mode when the user needs a live Excel shell.
