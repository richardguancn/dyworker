# Integrity Controls

Required mechanical checks: balance sheet balance, cash tie, retained earnings rollforward, working capital rollforward, PP&E rollforward, debt rollforward, tax reasonableness, and scenario consistency. Run balance-sheet, cash and debt roll-forward checks for each material displayed scenario and the forecast periods used in headline conclusions.

Formula mode checks: required sheets present, formulas preserved, styles present, no external links, and separate formula run log.

Severity: hard failures block decision use; warnings require visible caveats; informational checks support review. Calculation integrity and decision readiness are distinct statuses: passing mechanical checks must not turn unsupported operating, debt, liquidity or covenant assumptions into an overall `OK`. Status reconciliation is required across the summary, checks, cover, and any other visible status surface.

Pressure tests should cover revenue, margin, working capital, capex, debt/liquidity, and scenario switching. If downside improves cash or leverage without an explanation, investigate assumptions.

Sign-off requires no unresolved hard failures, visible source posture, balanced statements, an explicit calculation-integrity status and decision-readiness status, formula-error scan results in the run log, and `model_citations.json` mapped to the exact delivered workbook. If the delivered workbook differs from a deterministic control export, the control ledger is support-only until the hero workbook receives its own reconciled citation ledger.
