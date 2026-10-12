# Module And Asset-Class Rules

## Table Of Contents

- [Module Selection](#module-selection)
- [Corporate](#corporate)
- [Banks And Lenders](#banks-and-lenders)
- [Insurance](#insurance)
- [Asset Managers And Exchanges](#asset-managers-and-exchanges)
- [REITs And Real Assets](#reits-and-real-assets)
- [Distressed Or Stressed Companies](#distressed-or-stressed-companies)
- [Private-Company Target](#private-company-target)

## Module Selection

Choose the module before building the table. The module controls which numerator/denominator pairs are meaningful, which peers belong, and which QA checks matter.

- `corporate`: standard industrial, software, consumer, healthcare services, energy services, business services, and similar issuer comps.
- `bank_or_lender`: banks, bank holding companies, specialty lenders, thrifts, and deposit-funded financial institutions.
- `insurance`: P&C, life, brokerage, reinsurance, and specialty insurers.
- `asset_manager_or_exchange`: asset managers, exchanges, trading platforms, data providers, and fee/volume-driven market infrastructure.
- `reit_or_real_assets`: equity REITs and real-asset vehicles where FFO/AFFO/NAV matter.
- `distressed_or_stressed`: issuers where liquidity, debt trading levels, impairment, or recovery value drives valuation.
- `private_company_target`: public comps used to infer a valuation range for a private target.

## Corporate

Use EV-based and equity-based multiples as appropriate:

- `EV/LTM Revenue`
- `EV/NTM Revenue`
- `EV/LTM EBITDA`
- `EV/NTM EBITDA`
- `EV/LTM EBIT`
- `EV/NTM EBIT`
- `P/E`
- `P/FCF`, `FCF yield`, or sector-specific metrics when support exists

Keep reported, adjusted, consensus, company-defined, and inferred denominators separate. Do not overwrite reported metrics with adjusted ones.

## Banks And Lenders

Do not use EV-based multiples by default. Use:

- `P/TBV`
- `P/B`
- `P/E`
- ROE, ROTCE, ROA
- NIM
- CET1 or relevant capital ratio
- deposit mix
- credit losses, NPLs, reserves, and asset sensitivity where available

Flag whether book value is tangible, common, or total equity. For lenders, connect valuation to credit quality, duration, funding mix, charge-offs, and capital adequacy rather than forcing generic corporate EV logic.

## Insurance

Use:

- `P/B`
- `P/E`
- ROE
- combined ratio
- reserve adequacy
- book-value growth

Label life, P&C, brokerage, and reinsurance differences. Do not force a single multiple across fundamentally different insurance models.

## Asset Managers And Exchanges

Use:

- `P/E`
- `EV/EBITDA`
- AUM, flows, fee rate, and revenue yield where available
- volume, clearing, transaction, or data revenue metrics for exchanges
- margin and operating leverage

Separate market beta, flows, fee-rate changes, trading volumes, data revenue mix, and operating leverage when explaining premiums or discounts.

## REITs And Real Assets

Use:

- `P/FFO`
- `P/AFFO`
- NAV premium/discount
- implied cap rate
- occupancy
- same-store NOI
- leverage
- property-type read-through

For REITs, treat the module as a specialized public-equity comp sheet, not a generic corporate trading comps screen.

### REIT Denominator Hierarchy

1. Recurring Core / adjusted FFO per share as the primary equity multiple denominator.
2. Cleaner ex-item Core FFO when promote income, casualty / business-interruption proceeds, lease termination income, large disposition items, or other non-recurring items distort recurring FFO.
3. Reported NAREIT FFO only when no cleaner recurring FFO metric is available. Label it as reported.
4. AFFO / CAD as a secondary cross-check when disclosed or cleanly derivable. Do not make AFFO availability determine peer inclusion.
5. EV/EBITDAre, NAV premium/discount, and implied cap rate as cross-checks when relevant.

### REIT Peer Preservation

Do not exclude a very close REIT peer only because one secondary field is missing. Include the peer in the core table with `N/A`, `N/M`, or a clearly labeled derived value if:

- it is economically one of the closest public peers;
- the primary FFO-style denominator is available; and
- the missing value is not central to the user's requested decision.

Only exclude a close peer if the primary valuation denominator or pricing data cannot be sourced. List the exact missing blocker.

### REIT Table

For REIT requests, the core table should usually include:

| Ticker | Peer role | Price / as-of | FFO denominator used | P/FFO | AFFO or CAD denominator | P/AFFO or P/CAD | Leverage | Occupancy basis | Normalized read-through |
|---|---|---:|---|---:|---|---:|---|---|---|

Prefer a complete table for the closest 4-8 peers over a long table with many missing fields.

## Distressed Or Stressed Companies

Do not let normal trading comps imply false precision. Flag:

- capital-structure impairment;
- liquidity and going-concern issues;
- debt trading levels;
- whether equity value is option value;
- whether EV is effectively owned by creditors;
- whether recovery value matters more than trading multiples.

Route to `distressed-recovery-waterfall` when recovery value or claim priority is the real task.

## Private-Company Target

Use public comps only to infer a valuation range. Target financials from CIM, banker deck, management accounts, or management materials are `seller_claim` or `management_claim` unless verified.

Route to `cim-teardown`, `financials-normalizer`, or `three-statement-model-builder` when the target denominator is not reliable.
