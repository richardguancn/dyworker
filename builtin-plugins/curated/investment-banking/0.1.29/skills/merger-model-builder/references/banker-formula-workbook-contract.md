# Banker Formula Workbook Map

Use only for live Excel merger/accretion/ownership workbook requests.

```bash
python3 scripts/build_banker_formula_workbook.py assets/plan_template.json --output-dir output
```

It preserves the bundled template, patches supported Control Panel inputs, and checks sheets/formulas/styles/no external links. It writes `banker_formula_workbook.xlsx` as the human deliverable plus `banker_formula_workbook_run_log.json` and `manifest.json` as agent-facing support artifacts. It does not generate every formula, evaluate Excel formulas, or edit user workbooks.
