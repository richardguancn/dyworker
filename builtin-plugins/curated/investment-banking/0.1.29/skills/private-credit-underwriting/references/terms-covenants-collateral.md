# Terms, Covenants, Collateral, And Recovery Reference

Use this reference when reviewing a term sheet, credit agreement, collateral package, or stressed-credit recovery path.

## Table Of Contents

- [Structure Discipline](#structure-discipline)
- [Facility Terms Checklist](#facility-terms-checklist)
- [Covenant Review](#covenant-review)
- [Covenant And Structure Point Capture](#covenant-and-structure-point-capture)
- [Collateral Analysis](#collateral-analysis)
- [Recovery And Loss Analysis](#recovery-and-loss-analysis)
- [Sponsor Support](#sponsor-support)
- [Negotiation Issues](#negotiation-issues)

## Structure Discipline

Do not opine on covenant EBITDA or legal covenant interpretation unless the relevant credit agreement, term sheet, or covenant definition is available.

If the primary task is to interpret the covenant package itself, route to `covenant-package-analyzer`. If the covenant point is an input to a credit decision, provide a lender-view proxy, label it clearly, and list exact documents required.

When handing off covenant questions, use `private_credit_underwriting_to_covenant_package_analyzer` from `../../../references/handoff-contracts.md`. When recovery or default analysis becomes central, use `private_credit_underwriting_to_distressed_recovery_waterfall`.

Review debt structure through the lender-protection lens:

- Is the borrower over-levered relative to cash-flow durability?
- Is maturity runway long enough for deleveraging or refinancing?
- Does amortization align with real cash generation?
- Does the revolver create liquidity or mask a working-capital deficit?
- Do covenants detect deterioration before liquidity disappears?
- Does collateral or enterprise value protect the lender if cash-flow repayment fails?

## Facility Terms Checklist

Capture the proposed or existing structure:

- borrower / guarantors / restricted group
- purpose and use of proceeds
- tranche type: first lien, second lien, unitranche, delayed draw, revolver, ABL, mezzanine, PIK, preferred, holdco, asset-backed
- principal amount and currency
- maturity and amortization
- pricing: base rate, spread, floor, PIK, default rate
- fees, OID, call protection, make-whole, prepayment premium
- collateral and lien priority
- guarantees
- permitted debt, liens, investments, acquisitions, dividends, restricted payments
- mandatory prepayments and excess cash flow sweep
- reporting package and frequency
- financial covenants and testing frequency
- equity cure rights, covenant holidays, grower baskets, add-back caps

## Covenant Review

Do not conclude on a covenant without the definition.

For each covenant:

| Field | Required |
|---|---|
| covenant name | yes |
| covenant type | max leverage, min coverage, min liquidity, capex, borrowing base, other |
| governing definition source | yes |
| testing period | yes |
| threshold | yes |
| actual value | yes |
| headroom | yes |
| scenario breach date | if modeled |
| cure / holiday / step-down | if disclosed |
| open definition issues | yes |

Common definition traps:

- add-back caps and sunset periods
- run-rate savings versus actually realized savings
- pro forma acquisitions / dispositions
- cash netting caps
- unrestricted subsidiaries
- EBITDA add-back baskets
- lease treatment
- restructuring and integration cost caps
- cost savings double counted in forecast and EBITDA
- extraordinary / unusual / non-recurring definitions
- equity cure mechanics and cure EBITDA treatment

## Covenant And Structure Point Capture

For each covenant or structure point, capture:

- definition source
- calculation period
- basket / cap / add-back treatment
- threshold
- actual value
- cushion amount and cushion percentage
- first breach date under scenarios
- cure rights, equity cure, holiday, grower component, or step-down if disclosed
- whether the issue is commercial, legal, accounting, or data-driven

Classify covenant issues:

- commercial: economics, covenant tightness, monitoring usefulness, lender control
- legal: drafting, enforceability, interpretation, amendment or waiver mechanics
- accounting: EBITDA, lease, capitalization, pro forma, or add-back treatment
- data-driven: missing financials, stale covenant certificate, unsupported debt balance, missing threshold

## Collateral Analysis

Collateral matters most when cash-flow repayment is uncertain. Review:

- collateral class: AR, inventory, equipment, real estate, IP, stock pledge, cash, securities, enterprise value
- lien priority and perfection
- appraised value and appraisal date
- advance rates and reserves
- eligibility criteria and concentration limits
- AR aging, customer credit quality, dilution, disputes, cross-aging
- inventory turns, obsolescence, location, liquidation value, seasonality
- equipment age, auction value, maintenance, portability
- real estate appraisal basis, environmental risk, lease status
- IP transferability and practical enforcement value
- guarantees and sponsor support

Collateral-specific concerns:

- stale appraisals or field exams
- junior lien position without adequate EV cushion
- AR quality deteriorating as liquidity tightens
- inventory with poor turns, obsolescence, or weak liquidation market
- collateral located outside lender control or restricted jurisdictions
- IP or enterprise value that is difficult to monetize in distress
- no current lien search or incomplete perfection evidence

## Recovery And Loss Analysis

For stressed or distressed credits, frame recovery in layers:

1. cash on hand and revolver availability
2. first-priority collateral value
3. enterprise value under downside EBITDA and multiple
4. administrative / restructuring costs
5. senior claims and priority claims
6. pari passu / junior claims
7. sponsor support or new money
8. expected recovery range and downside loss

Do not overstate enterprise value recovery when the borrower is cash-flow negative, EBITDA is unsupported, or the market multiple is speculative. Use a range and identify the fulcrum risk when applicable.

Recovery outputs should show:

- collateral basis and date
- EV basis and multiple support if used
- debt stack by priority
- estimated costs / leakage before lender recovery
- recovery range, not a single false-precision number
- first-loss driver and what would improve recovery

## Sponsor Support

Assess sponsor support as evidence, not reputation alone:

- equity contribution at close and current equity cushion
- prior funded support in this borrower or comparable situations
- executed equity commitment, keepwell, support agreement, or guarantee
- fund life, available capital, and conflicts if available
- willingness and ability to fund cure, new money, or amendment fees
- alignment with lender protections and exit path

Treat informal willingness to support as an assumption unless legally committed or already funded.

## Negotiation Issues

Escalate these as potential structure changes:

- leverage too high for downside cash generation
- covenant headroom too tight or too loose for monitoring
- no liquidity covenant despite seasonal cash burn
- weak reporting package
- large EBITDA add-back baskets
- unrestricted subsidiary leakage
- dividend / restricted payment flexibility inconsistent with leverage
- weak collateral reporting or appraisal age
- no springing covenant on revolver draw
- maturity wall before expected deleveraging
- poor control over acquisitions, debt, or liens

Frame each issue as: issue, why it matters to repayment or recovery, proposed lender ask, fallback position, and whether it is a closing condition or monitoring item.
