# QA Checks

Hard failures: invalid plan, missing required source basis, WACC <= terminal growth, missing scenarios, missing bridge/share count for per-share value, failed workbook write, missing run log, or broken formula-template inspection.

Warnings: placeholders, stale market data, analyst-estimate-heavy forecast, unsupported terminal multiple/growth, high terminal-value concentration, stale bridge items, unexplained negative FCF, or mismatched method and company type.

Senior red flags: value depends mostly on terminal assumptions, downside is not meaningfully worse than base, ROIC/reinvestment story is inconsistent, or source labels do not match the confidence claimed.

Hard failures force `not-decision-ready`. Warnings require visible caveats and usually cap status at `screen-grade` or `senior-review-ready`.

First-read status QA:
- Confirm the first visible tab reports both explicitly labeled status fields: `Calculation integrity` and `Decision readiness`.
- Do not display an unqualified overall `OK` when a source/readiness check is `OPEN`, when material forecast/WACC/terminal assumptions are analyst estimates, or when a material bridge item remains unresolved.
- Make high terminal-value concentration visible on the first tab rather than leaving it only in a model row or run log.
- For public-company pitch work, when a material valuation divergence exists, check that the market-implied view shows a controlled numeric reverse-DCF solution, the assumption solved for, and the base assumptions held constant; a composite scenario comparison alone is insufficient.
- Check that headline enterprise value, equity value, per-share value, premium/discount, and market-implied solved-assumption citation records contain their complete material dependency set, including operating, WACC, terminal-value, bridge, share-count, and market-reference dependencies where applicable.
- Check that the run log records formula-error scan results as an explicit result or match count rather than referring only to console output.
- Confirm scenario ordering is consistent and any quoted sensitivity spread is labeled as a control range or full displayed sensitivity spread.
