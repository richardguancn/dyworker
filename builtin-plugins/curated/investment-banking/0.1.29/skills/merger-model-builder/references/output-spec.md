# Output Spec Map

Deterministic export writes to the selected `--output-dir` (default `./output` from the caller's current working directory): `model.xlsx`, `plan.json`, `run_log.json`, and `manifest.json`. It writes legacy `report.md` only when `--write-report-md` is explicitly requested. Formula mode writes `banker_formula_workbook.xlsx`, its own log, and `manifest.json`. For a public-source `adjusted_eps_screen`, a formula-driven banker workbook may be limited to supported adjusted-EPS metrics rather than inserting unsupported PPA or GAAP inputs.

The workbook is the hero human deliverable. `manifest.json`, run logs, normalized plans, and any legacy Markdown report are support artifacts unless explicitly requested.

The first visible workbook tab must be `Cover`, `Executive Summary`, or `Dashboard` and follow `../../../references/workbook-first-tab-standard.md`: accretion/dilution, pro forma ownership, synergies, financing mix where modeled, EPS bridge, breakpoints, source/caveat status, risks, next steps, and model map. It must separately label `Calculation integrity` and `Decision readiness`.

Sheets: summary, assumptions, missing inputs, standalone, sources/uses, PPA, financing, synergies, PF income, accretion/dilution, ownership, sensitivity, checks. Partial-context outputs show the exact screen-grade warning before metrics; an `adjusted_eps_screen` states that GAAP accretion/dilution is not presented without complete support and distinguishes disclosed gross/net synergies, disclosed or clearly labeled implied cost-to-achieve, and model-derived after-tax benefit.
