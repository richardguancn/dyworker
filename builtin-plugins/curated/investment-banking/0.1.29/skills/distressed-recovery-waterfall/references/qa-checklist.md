# QA Checklist and Failure Modes

## Table Of Contents

- MD review checklist
- Model checks
- Common failure modes
- Red flags that should change the analysis
- Senior-review questions

## MD review checklist

Before delivering, verify:

- Deck, memo, or QC handoffs use the distressed recovery contracts in `../../../references/handoff-contracts.md` and keep claim class, value case, waterfall type, legal/counsel flags, and source dates separate.

- The client posture is clear.
- The jurisdiction and process stage are clear.
- Source hierarchy and assumption labels are visible.
- Debt stack ties to sources or is clearly assumed.
- Claims register includes non-funded claims.
- Legal entity and guarantor issues are not ignored.
- Collateral pools are separated when material.
- Secured claims are not treated as fully secured without collateral support.
- Deficiency claims are handled or flagged.
- Intercreditor and sacred-right issues are flagged.
- Valuation case is pressure-tested.
- Liquidation floor is included or explicitly not available.
- Waterfall ties mathematically.
- Fulcrum security is identified by scenario.
- Fulcrum sensitivity is shown.
- Trading prices are reconciled where available.
- New money, MIP, warrants, and backstop dilution are included where relevant.
- Plan feasibility is discussed if in-court path is relevant.
- Recommendation is practical and next-step oriented.
- Legal conclusions are flagged for counsel.
- Standalone HTML memoranda use reader-facing evidence labels rather than raw evidence codes or renderer metadata.
- Board/sale-path memoranda surface decision gates before dense waterfall or process-detail tables.
- HTML outputs have been rendered and visually inspected with local headless-browser screenshots of the opening view and a material downstream section; do not rely on in-app Browser navigation for local files.

## Model checks

- Total allocated value equals distributable value.
- Remaining value rolls forward correctly.
- Recovery cannot be negative.
- Recovery cannot exceed claim unless explicitly modeled.
- Same-priority classes share pro rata.
- Secured recoveries do not exceed collateral value absent a negotiated plan allocation.
- Claim totals tie to debt stack and claims register.
- Scenario outputs tie to valuation inputs.
- Liquidation proceeds tie to asset-level values less wind-down costs.
- Ownership totals to 100 percent after dilution.
- MIP, warrants, backstop fees, and rights offering dilution are included in ownership.
- Fulcrum label matches first partially impaired class or explains why practical fulcrum differs.
- Checks are visible to the user.

## Common failure modes

### Treating secured debt as automatically money-good

Correct response: test collateral value, priority, guarantors, and perfection. Split secured and deficiency claims if relevant.

### Ignoring structural subordination

Correct response: map entities and claims. HoldCo debt may recover after OpCo creditors.

### Using one global value pool when collateral differs

Correct response: build collateral-pool waterfalls.

### Ignoring administrative and priority claims

Correct response: include DIP, admin, professional fees, priority tax, employee claims, and wind-down costs.

### Ignoring make-whole or default-interest disputes

Correct response: include toggles and counsel-review flags.

### Ignoring new-money dilution

Correct response: show recoveries before and after rights offering, backstop premium, warrants, and MIP.

### Mistaking mathematical fulcrum for practical control

Correct response: analyze creditor organization, voting power, new-money ability, and legal leverage.

### Giving junior classes value without flagging priority issues

Correct response: label as settlement, gift, or negotiated plan economics and flag counsel review.

### Over-relying on management projections

Correct response: pressure-test EBITDA, capex, working capital, customer attrition, and exit financing.

### Overstating certainty

Correct response: use recovery ranges and show assumptions.

### Presenting partial claim sensitivity as distributable recovery

Correct response: identify the denominator and senior-gate assumptions, label known-funded-GUC-only results as upper-bound sensitivities, and request full allowed-claims and net-proceeds support before board reliance.

## Red flags that should change the analysis

- Near-term liquidity cliff.
- Expiring forbearance.
- Borrowing-base deterioration.
- Unfunded pension or environmental claims.
- Large lease rejection damages.
- Unperfected liens.
- Non-guarantor asset concentration.
- Unrestricted subsidiary assets.
- Existing LME or litigation.
- Disputed make-whole.
- Admin insolvency risk.
- No credible DIP or exit financing.
- Customer or vendor flight.
- Regulated assets or licenses.
- Cross-border assets or claims.
- Concentrated creditor group with blocking position.

## Senior-review questions

Ask yourself:

1. Who owns the company economically?
2. Where does value break in each case?
3. Who can block or delay the plan?
4. Who can fund the solution?
5. What recovery does the market imply?
6. What assumption moves the fulcrum?
7. Which legal issue could change priority or claim size?
8. What would each class argue?
9. What is the least value-destructive executable path?
10. What should the client do this week?
