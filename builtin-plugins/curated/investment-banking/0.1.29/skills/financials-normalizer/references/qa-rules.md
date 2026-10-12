# QA rules

Use these checks before any normalized financials are handed to modeling, memo, deck, credit, diligence, FP&A, or earnings skills.

## Required QA outputs

Create `QA_Flags` with: `flag_id`, `severity`, `entity`, `period`, `area`, `issue`, `impact`, `recommended_fix`, `source_id`, and `status`.

Severity:
- `blocker`: cannot use downstream until resolved.
- `high`: materially affects valuation, credit, IC memo, earnings interpretation, covenant analysis, or board/CFO reporting.
- `medium`: should be reviewed before senior/client/committee use.
- `low`: documentation, labeling, or immaterial cleanup.

## Source checks

- Every material value has a source ID and source location.
- Every source ID exists in `Source_Index`.
- Every source has source date, period coverage, and source type.
- User, management, provider, calculated, adjusted, estimated, and inferred values are separately labeled.
- Conflicting source values are retained in `Conflict_Log`.
- Stale or preliminary values are flagged but not automatically discarded.

## Period checks

- Fiscal year-end is identified or marked unknown.
- Annual, quarter, month, YTD, LTM/TTM, budget, forecast, estimate, and pro forma periods are labeled distinctly.
- Period end dates align with fiscal labels.
- Stub periods are not mixed with full periods without disclosure.
- Restated values supersede prior values when restatement status is clear.

## Scale, unit, and currency checks

- Currency and units are identified for every value.
- Source units and normalized units are preserved.
- Factor-of-1,000 / 1,000,000 differences are flagged.
- Per-share, percentage, bps, count, and dollar values are not mixed.
- FX conversions include rate, date, and source.

## Income statement checks

- Revenue - COGS ties to gross profit when all values are available.
- Gross profit - operating expenses ties to operating income when all values are available.
- Pretax income - tax expense ties to net income when all values are available.
- EPS directionally ties to net income and share counts when available.
- Non-GAAP values are not treated as GAAP facts.
- Discontinued operations, minority interest, preferred dividends, and non-operating items are isolated when material.

## Balance sheet checks

- Total assets tie to total liabilities plus equity when available.
- Current assets and current liabilities tie to component sums when available.
- Ending cash ties to cash-flow statement ending cash when available.
- Debt, leases, preferred stock, and noncontrolling interest are not hidden inside generic liabilities/equity without notes.

## Cash flow checks

- CFO + CFI + CFF + FX effect ties to net change in cash when available.
- Beginning cash + net change ties to ending cash when available.
- Capex sign is explicit.
- FCF formula is explicit and not assumed to match company definition.
- Working-capital cash-flow signs preserve source convention unless clearly converted and documented.

## KPI and segment checks

- KPI definitions are captured or marked missing.
- Segment totals tie to consolidated totals when source provides reconciliations.
- Company-defined metrics are labeled company-defined.
- Sector metrics include units and definition: ARR, NRR, RPO, GMV, AUM, NIM, loss ratio, NOI, production, reserves, bookings, backlog, cohort data, and similar.

## Downstream readiness

Mark readiness as `ready`, `partial`, or `not_ready` for relevant downstream skills.

- Valuation/DCF: revenue, margins/EBIT/EBITDA, tax, D&A, capex, working capital, cash, debt, shares, and forecast basis.
- LBO/sponsor returns: historicals, EBITDA, capex, working capital, cash/debt, tax, and forecast drivers.
- QoE: financials, trial balance/detail, management adjustments, add-back support, customer/vendor concentration, and NWC support.
- Earnings: reported financials, guidance/KPIs, transcript/source commentary if requested, and consensus if available.
- Private credit: historicals, debt schedule, liquidity, collateral, covenants, and downside drivers.
- FP&A: actuals, budget/forecast, account/cost center mappings, department owners, and refresh timestamp.

## Financing and Take-Private Treatment Checks

When normalized outputs support acquisition financing, leverage, or take-private work:

- Separate reported statements, company-disclosed adjustments, management projections, derived screening metrics, and accepted financing metrics.
- Require a readable `EBITDA_Treatment_Matrix` or equivalent bridge section that identifies company treatment, preliminary financing treatment, cash/non-cash status, recurrence or run-rate risk, double-count risk, required support, and readiness for each material adjustment.
- Do not treat calculated YTD, projected, company-adjusted, or proxy-defined EBITDA as accepted LTM financing EBITDA without lender/QoE support and the applicable definition.
- Require a readable `Net_Debt_Treatment_Matrix` or equivalent bridge section that identifies cash-only baseline inclusion, candidate treatment, accepted treatment, required support, and readiness for each material debt-like or cash-like item.
- Do not include, exclude, or net leases, legal liabilities, securitization debt, derivatives, restricted cash, investments, pensions, preferred equity, or financing commitments without documenting the applicable treatment and remaining diligence.
- Label projected EBITDA prominently as management-projected or forecast and label financing commitments as context only unless opening capitalization or funds-flow support is established.

## Workbook Readability and First-Read QA

For substantive workbook outputs:

- Require a polished first visible tab following `../../../references/workbook-first-tab-standard.md` with decision question, source/period posture, key normalized outputs, open diligence, and a model-map or next-step view.
- For financing-use workbooks, show `Reported statement integrity`, `EBITDA readiness`, `Net debt readiness`, and `Financing model handoff` separately on the first visible tab.
- Permit statement tie-outs to pass while EBITDA, net debt, or financing-model readiness remains `partial`, `open`, `blocked`, or `not_ready`.
- Render and inspect the first-read tab, material treatment views, reported statement summaries, and checks tab at normal zoom before delivery.
- Preserve long-form staging and full audit ledgers, but do not require their full-sheet renders to serve as reader-facing pages; provide compact decision-facing views for material adjustment, debt-perimeter, conflict, and diligence findings.
