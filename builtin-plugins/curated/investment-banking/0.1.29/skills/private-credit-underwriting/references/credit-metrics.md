# Credit Metrics And Downside Reference

Use this reference when calculating ratios, debt capacity, downside metrics, and script outputs.

## Table Of Contents

- [EBITDA Bases](#ebitda-bases)
- [Credit Analysis Standards](#credit-analysis-standards)
- [Core Ratio Formulas](#core-ratio-formulas)
- [Default Metrics](#default-metrics)
- [Debt Capacity Logic](#debt-capacity-logic)
- [Covenant Headroom](#covenant-headroom)
- [Downside Cases](#downside-cases)
- [Warning Signs](#warning-signs)
- [Metrics Script](#metrics-script)

## EBITDA Bases

Always label the basis:

| Metric | Meaning | Use |
|---|---|---|
| reported EBITDA | source reported or calculated before adjustments | starting point |
| adjusted EBITDA | company or management adjustment basis | management view; needs support |
| normalized EBITDA | recurring earnings after supportable QoE and run-rate items | underwriting view when supported |
| lender EBITDA | normalized EBITDA after lender haircuts and exclusions | debt sizing / lender case |
| lender-after-haircut EBITDA | lender EBITDA after explicit disallowances, haircuts, and credit judgment | conservative debt-sizing basis |
| covenant EBITDA | EBITDA as defined in the legal agreement | covenant compliance only when definition is available |
| cash EBITDA / FCF | cash-flow reality after working capital, capex, cash taxes, and interest | repayment capacity |

## Credit Analysis Standards

Always separate:

- reported EBITDA
- adjusted EBITDA
- normalized EBITDA
- lender-after-haircut EBITDA
- covenant EBITDA, only when the governing definition is available
- cash EBITDA / free cash flow, when cash conversion matters

For ratios, show numerator, denominator, period, and source. Do not present a ratio without the basis.

If a ratio is negative, has a zero denominator, or is not meaningful, show `N/M` and explain why.

## Core Ratio Formulas

Use consistent numerator and denominator definitions.

- `gross leverage = total debt / selected EBITDA`
- `net leverage = (total debt - unrestricted cash) / selected EBITDA`
- `senior secured leverage = senior secured debt / selected EBITDA`
- `interest coverage = selected EBITDA / cash interest expense`
- `fixed charge coverage = (selected EBITDA - cash taxes - maintenance capex) / (cash interest + scheduled amortization + required cash debt service)`
- `debt service coverage = cash flow available for debt service / required debt service`
- `fcf conversion = free cash flow / selected EBITDA`
- `liquidity = unrestricted cash + revolver availability + committed delayed-draw capacity, if available`
- `liquidity cushion = liquidity - minimum required liquidity`

## Default Metrics

Compute these where data supports them:

- revenue growth
- EBITDA margin
- adjusted EBITDA margin
- free cash flow conversion
- gross leverage
- net leverage
- senior secured leverage
- interest coverage
- fixed-charge coverage
- debt service coverage
- liquidity: cash plus revolver availability
- covenant headroom
- minimum liquidity cushion
- debt maturity runway
- capex intensity
- working-capital drag
- borrowing-base availability, if asset-based

## Debt Capacity Logic

Debt capacity is the minimum of several constraints:

1. leverage limit supported by borrower quality and market context
2. fixed-charge / interest-coverage limit
3. liquidity and revolver availability through seasonal trough
4. covenant headroom after downside stress
5. borrowing-base or collateral limit, if relevant
6. maturity / refinancing risk
7. sponsor support and equity cushion
8. enterprise-value / recovery protection

Do not size debt from base-case EBITDA alone. When constraints conflict, use the more conservative answer for lender recommendation and explain which constraint binds.

For acquisition-financing screens using only target-company public data, do not call a target-only calculation supportable debt, acquisition-financing capacity, or a recommended hold. Label it an `illustrative standalone cash-interest screening ceiling` and state the combined-borrower limitation. If displayed, accompany it with at least one cash-flow downside dimension, such as an unlevered FCF haircut, and at least one interest-rate or minimum-coverage-threshold view where those assumptions drive the result. Varying debt alone at fixed rate and coverage does not establish downside support.

For a debt-sizing table, show:

| Constraint | Supportable debt | Basis | Binding? | Caveat |
|---|---:|---|---|---|
| leverage | | selected EBITDA and multiple | | |
| interest coverage | | EBITDA / cash interest | | |
| fixed charge | | FCF after capex/taxes | | |
| liquidity trough | | cash + revolver availability | | |
| covenant headroom | | governing definition or proxy | | |
| collateral / borrowing base | | advance rate and eligibility | | |
| recovery / EV cushion | | downside EV or liquidation range | | |

## Covenant Headroom

Do not opine on covenant EBITDA unless the governing definition is available. If the covenant point is an underwriting input and the definition is unavailable, label the calculation as a lender-view proxy.

For max leverage covenants:

- `headroom = threshold - actual`
- `headroom_pct = headroom / threshold`
- lower actual is better

For min coverage or liquidity covenants:

- `headroom = actual - threshold`
- `headroom_pct = headroom / threshold`
- higher actual is better

Show the first period where headroom becomes negative.

## Downside Cases

At minimum, build or describe:

- base case
- lender case
- downside case
- severe downside or break case when borrower is highly levered, cyclical, or stressed

Stress outputs:

- EBITDA
- FCF
- liquidity trough
- covenant headroom
- cash interest coverage
- fixed-charge coverage
- revolver draw
- debt paydown / debt increase
- refinancing need
- enterprise value cushion, if available

Name the first breakpoint: covenant breach, liquidity shortfall, borrowing-base squeeze, customer loss, margin compression, capex catch-up, maturity wall, or recovery impairment.

## Warning Signs

Flag as high severity:

- leverage depends on add-backs that are not tied out
- interest coverage below lender comfort without pricing / amortization relief
- covenant headroom disappears under a modest downside
- liquidity trough occurs before seasonal cash recovery
- borrowing-base availability falls as EBITDA stress appears
- capex is underfunded relative to maintenance needs
- FCF conversion is structurally weak
- no sponsor support despite aggressive leverage
- maturity wall before credible deleveraging
- collateral value is stale or junior lien position is unclear

## Metrics Script

The skill-root-relative script [`scripts/calculate_credit_metrics.py`](../scripts/calculate_credit_metrics.py) is a first-pass calculator. It accepts:

From the skill root:

```bash
python3 scripts/calculate_credit_metrics.py --financials borrower_financials.csv --terms debt_terms.json --outdir credit_out
```

It writes:

- `credit_metrics.csv`
- `covenant_headroom.csv`
- `warnings.csv`
- `credit_metrics_report.html`

Always review the output for source quality, EBITDA basis, missing data, denominator issues, covenant definition limitations, and whether the script selected the right EBITDA basis for the underwriting question.
