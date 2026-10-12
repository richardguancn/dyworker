# Dashboard Map: Excel Data Cleaner

Use `dashboard-builder` when the cleaning output should become a data-quality dashboard for model or diligence readiness.

## Decision Question

Is the workbook/data extract clean enough to use, and what issues block analysis?

## Recommended Sections

1. Overview: `metric_strip`, `verdict`, `flags`.
2. Data Quality: `source_readiness`, `wide_table`.
3. Transformations: `timeline`, `table`.
4. Exceptions: `flags`, `action_register`.
5. Output Readiness: `source_readiness`.

## Top KPIs

- Rows processed
- Columns mapped
- Exceptions found
- Critical errors
- Manual review count
- Output readiness

## Required Sources

- Original workbook or CSV
- Cleaning/mapping rules
- Output file manifest
- Exception log
- User-provided target schema
