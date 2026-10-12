# IB Sensitivity Taxonomy

Use this reference when choosing drivers, outputs, and breakpoints for transaction scenarios. Keep `SKILL.md` lean; load this file only when the user needs detailed sensitivity design.

## Table Of Contents

- [Sensitivity Types](#sensitivity-types)
- [Transaction Driver Buckets](#transaction-driver-buckets)
  - [Valuation](#valuation)
  - [Debt Capacity](#debt-capacity)
  - [Covenant Headroom](#covenant-headroom)
  - [Financing Terms](#financing-terms)
  - [Merger Model](#merger-model)
  - [Downside and Breakage](#downside-and-breakage)
  - [Returns](#returns)
  - [Restructuring and Recovery](#restructuring-and-recovery)
- [Flow-Through Ladder](#flow-through-ladder)
- [Provenance Labels](#provenance-labels)
- [Common Failure Modes](#common-failure-modes)

## Sensitivity Types

| Type | Purpose | Use when | Output |
|---|---|---|---|
| Scenario analysis | Coherent deal cases | Multiple assumptions move together | case narrative, driver overlay, output comparison |
| Sensitivity analysis | Local elasticity or valuation range | One or two variables drive the question | one-way or two-way table, selected range |
| Stress test | Downside survivability | Financing, liquidity, covenant, or recovery risk matters | first breach, liquidity trough, cushion, trigger |
| Target backsolve | Solve for required assumption path | Target metric is fixed | required driver path and feasibility label |
| Breakpoint analysis | Find the threshold where recommendation changes | Deal team needs a go/no-go trigger | threshold, action, owner, timing |

## Transaction Driver Buckets

### Valuation

Drivers:
- Revenue, EBITDA, EBIT, FCF, growth, margin, WACC, terminal growth, terminal multiple, trading multiple, precedent multiple, selected range, SOTP component values, share price, premium, net debt, minority interests, cash, debt-like items, FX.

Common tables:
- EV from EBITDA x multiple.
- Equity value and value per share from EV, net debt, and diluted shares.
- DCF value from WACC x terminal growth.
- Offer price from unaffected share price x premium.
- SOTP component value by segment multiple or DCF value.

Breakpoints:
- Reserve price floor.
- Maximum offer price supportable from valuation evidence.
- Minimum valuation needed for board support.
- Multiple contraction that invalidates the selected range.

### Debt Capacity

Drivers:
- EBITDA basis, leverage cap, debt tranche mix, amortization, cash sweep, cash interest, PIK interest, base rate, spread, fees, OID, maturity, minimum cash, revolver availability, debt service, capex, working capital, cash taxes.

Common tables:
- Debt capacity from EBITDA x leverage cap.
- Leverage by EBITDA haircut and debt quantum.
- Interest coverage by rate and debt level.
- Minimum liquidity by operating miss and financing cost.

Breakpoints:
- Maximum debt before coverage fails.
- Minimum EBITDA before leverage exceeds lender tolerance.
- Debt quantum that creates liquidity breach.
- Rate/spread level that makes debt service unacceptable.

### Covenant Headroom

Drivers:
- Covenant EBITDA, net debt, gross debt, first-lien debt, secured debt, fixed charges, cash interest, capex, minimum liquidity, revolver draw, basket usage, cure rights, test date, covenant threshold.

Common tables:
- Cushion by EBITDA haircut and debt level.
- Interest coverage by rate move and EBITDA miss.
- Minimum liquidity by revolver draw and operating case.
- First breach period by downside severity.

Breakpoints:
- First covenant breach period.
- Minimum EBITDA before covenant breach.
- Maximum debt before headroom is exhausted.
- Required cure amount or amendment need.

### Financing Terms

Drivers:
- Issuance size, use of proceeds, SOFR/base rate, spread, coupon, OID, upfront fees, commitment fees, call protection, tenor, maturity, amortization, equity price, share count, dilution, ratings, investor demand, market window.

Common tables:
- Cost of debt by base rate and spread.
- Net proceeds by OID and fees.
- Dilution by share price and issuance size.
- Refinancing economics by maturity date and market terms.

Breakpoints:
- Maximum coupon/spread before economics fail.
- Minimum share price before dilution becomes unacceptable.
- OID/fee level that reduces proceeds below need.
- Market-window trigger for delay or accelerated launch.

### Merger Model

Drivers:
- Offer price, premium, exchange ratio, cash/stock mix, financing mix, synergies, dis-synergies, integration costs, tax rate, purchase accounting, amortization, share count, standalone EPS, pro forma EPS, ownership, leverage.

Common tables:
- Accretion/dilution by premium and synergies.
- Pro forma ownership by cash/stock mix and exchange ratio.
- Pro forma leverage by financing mix and EBITDA case.
- Synergy breakeven to achieve target EPS impact.

Breakpoints:
- Synergy level required for accretion.
- Maximum premium before dilution is unacceptable.
- Financing mix before leverage exceeds target.
- Ownership floor for buyer or seller shareholders.

### Downside and Breakage

Drivers:
- Revenue haircut, EBITDA margin compression, working capital outflow, capex step-up, delayed synergies, higher rates, refinancing unavailable, exit multiple contraction, customer loss, commodity shock, regulatory delay, liquidity trough.

Common tables:
- Liquidity by revenue decline and margin compression.
- Covenant headroom by EBITDA miss and rate move.
- IRR/MOIC by downside EBITDA and exit multiple.
- First breakage by case: liquidity, covenant, financing, valuation, accretion, recovery.

Breakpoints:
- Cash runs below minimum.
- Revolver exceeds commitment.
- Covenant breach.
- Refinancing wall cannot be addressed.
- Equity return falls below hurdle.
- Recommendation changes.

### Returns

Drivers:
- Purchase price, entry multiple, debt quantum, debt mix, sponsor equity, management rollover, fees, EBITDA growth, margin, capex, working capital, taxes, cash sweep, dividend recap, exit year, exit multiple, exit debt, management dilution.

Common tables:
- IRR/MOIC by entry multiple and exit multiple.
- IRR/MOIC by leverage and exit multiple.
- Maximum purchase price at target IRR.
- Exit multiple required to protect downside return.
- Value creation bridge by EBITDA growth, deleveraging, multiple change, add-ons, dividends, fees, and dilution.

Breakpoints:
- Maximum purchase price at target IRR/MOIC.
- Minimum exit multiple to return capital.
- EBITDA path required for target return.
- Dividend recap timing that increases risk beyond tolerance.

### Restructuring and Recovery

Drivers:
- Enterprise value, plan value, liquidation value, collateral value, collateral haircut, claim amount, accrued interest, administrative claims, priority, deficiency claims, reinstatement, exit financing, rights offering, backstop fees.

Common tables:
- Recovery by class across EV and claims.
- Secured recovery by collateral value and haircut.
- Fulcrum security by plan value.
- Plan value required for class impairment or unimpaired status.

Breakpoints:
- Fulcrum security shifts.
- Class recovery falls below negotiating threshold.
- Collateral coverage breaks.
- Plan value no longer supports proposed treatment.

## Flow-Through Ladder

For every material sensitivity, state:

1. Driver changed.
2. Model line or transaction assumption affected.
3. Output impact.
4. First threshold or breakpoint affected.
5. Deal action or recommendation implied.

## Provenance Labels

Use these labels consistently:

- `source_file`
- `market_data`
- `model_derived`
- `seller_claim`
- `management_claim`
- `sponsor_assumption`
- `lender_case`
- `banker_assumption`
- `market_proxy`
- `illustrative_placeholder`

## Common Failure Modes

- Scenario labels do not match assumptions actually changed.
- Scenario switches alter presentation labels but not formulas.
- Cases use different EBITDA, debt, share-count, currency, or sign conventions.
- Liquidity and covenant risk are hidden behind EBITDA-only sensitivity.
- Financing terms are stale or not dated.
- Covenant EBITDA is presented without covenant definitions.
- Target backsolve is mathematically solved but not financeable or executable.
- Downside case lacks a first-breach or first-break analysis.
