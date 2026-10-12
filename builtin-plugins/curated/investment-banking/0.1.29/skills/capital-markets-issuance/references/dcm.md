# DCM issuance guidance

Use this reference for investment-grade bonds, high-yield bonds, leveraged loans, bank debt, private credit, private placements, abs/securitization, refinancings, acquisition financing, and debt-capacity issuance views.

## Table Of Contents

- [Senior framing](#senior-framing)
- [Investment-grade bonds](#investment-grade-bonds)
- [High-yield bonds](#high-yield-bonds)
- [Leveraged loans / term loan b](#leveraged-loans--term-loan-b)
- [Bank debt / revolver](#bank-debt--revolver)
- [Private credit](#private-credit)
- [Private placement notes](#private-placement-notes)
- [ABS / securitization](#abs--securitization)
- [DCM sizing logic](#dcm-sizing-logic)
- [DCM pricing logic](#dcm-pricing-logic)
- [DCM investor objections](#dcm-investor-objections)
- [DCM output checklist](#dcm-output-checklist)

## Senior framing
Debt issuance advice must solve the funding need while preserving liquidity, ratings, covenant flexibility, maturity runway, and future market access. The cheapest coupon is not always the best financing.

## Investment-grade bonds
Best for rated issuers with scale, stable cash flow, and broad institutional demand.

Evaluate:
- ratings and outlook;
- tenor demand and curve shape;
- benchmark rates and spreads;
- secondary trading levels and existing curve;
- new issue concession;
- maturity ladder and refinancing runway;
- rating-agency metrics and thresholds;
- use of proceeds and debt-funded m&a implications;
- syndicate feedback and competing calendar.

MD judgment:
- Optimize tenor and maturity ladder, not just coupon.
- A deal that protects ratings may be worth more than marginal pricing tightness.
- Pre-fund opportunistically only if carry cost and investor receptivity are acceptable.

## High-yield bonds
Best for non-investment-grade issuers needing long-dated capital, acquisition financing, or refinancing.

Evaluate:
- rating category and sector appetite;
- secured vs unsecured capacity;
- leverage, coverage, fcf conversion;
- call protection, covenants, restricted payments, debt baskets;
- refinancing risk and maturity wall;
- new issue concession and secondary comparables;
- investor concerns about ebitda add-backs and cyclicality.

MD judgment:
- HY market access is highly selective by quality and use of proceeds.
- The covenant package and collateral often determine clearing level as much as coupon.
- A refinancing that extends runway may be positive even at higher cost if it removes near-term risk.

## Leveraged loans / term loan b
Best for sponsor-backed or leveraged issuers with institutional loan demand, floating-rate tolerance, and sufficient ebitda scale.

Evaluate:
- clo formation and demand;
- spread, floor, oid, and flex terms;
- covenant-lite availability;
- secured leverage capacity;
- lender familiarity;
- collateral and guarantees;
- add-back credibility;
- repricing/refinancing flexibility.

MD judgment:
- Loan execution depends heavily on clo technicals and documentation quality.
- Tight pricing with aggressive docs may not be available for weaker stories.

## Bank debt / revolver
Best for working capital, liquidity backup, relationship lending, or smaller/private issuers.

Evaluate:
- borrowing base, covenants, financial maintenance tests;
- relationship-bank appetite;
- commitment size and usage;
- liquidity adequacy;
- whether bank debt is bridge or permanent capital.

MD judgment:
- Revolvers are liquidity insurance, not always permanent funding.
- Drawing a revolver can create signaling risk if not well explained.

## Private credit
Best when certainty, confidentiality, speed, customized structure, or weak syndicated conditions outweigh higher cost.

Within `capital-markets-issuance`, treat private credit as an issuer financing alternative. If the deliverable becomes a lender approval memo, borrower risk rating, downside loss view, or credit committee recommendation, hand off to `private-credit-underwriting`. If the question turns on exact agreement definitions, basket capacity, leakage, or covenant EBITDA, hand off to `covenant-package-analyzer`.

Structured handoffs use `capital_markets_issuance_to_private_credit_underwriting` or `capital_markets_issuance_to_covenant_package_analyzer` in `../../../references/handoff-contracts.md`. Keep market-clearing assumptions, lender objections, covenant/rating caveats, source dates, and counsel-review flags explicit.

Evaluate:
- all-in yield, fees, oid, call protection;
- covenant intensity;
- lender diligence requirements;
- intercreditor issues;
- speed and certainty;
- future refinancing flexibility;
- sponsor relationship and lender hold size.

MD judgment:
- Private credit is not simply "expensive debt." It can be optimal when execution certainty is paramount.
- Watch for path dependency: call protection, covenants, and control rights can limit strategic flexibility.

## Private placement notes
Best for stable issuers seeking long-tenor capital from insurance or institutional investors.

Evaluate:
- size, tenor, amortization, covenant package;
- pricing versus public bonds;
- investor concentration;
- documentation and make-whole terms;
- suitability for infrastructure, utilities, real assets, insurance-friendly credits.

## ABS / securitization
Best for issuers with financeable asset pools or contractual receivables.

Evaluate:
- collateral performance;
- advance rates;
- ratings and tranche structure;
- excess spread and waterfall;
- servicer quality;
- repeat issuance platform potential.

## DCM sizing logic
Size around:
- refinancing need and maturity wall;
- minimum efficient issuance size;
- gross and net leverage targets;
- rating thresholds;
- covenant capacity and restricted payments;
- interest burden and fcf coverage;
- liquidity target;
- market depth by tenor/security;
- future capital needs and refinancing flexibility.

Output a range:
- minimum refinancing amount;
- base recommended size;
- opportunistic upsize amount;
- maximum advisable debt size before rating/covenant/investor resistance.

## DCM pricing logic
Provide ranges, not false precision.

Fields:
- benchmark rate;
- spread/yield/coupon;
- oid and fees;
- new issue concession;
- secured/unsecured differential;
- tenor premium;
- call protection;
- covenant adjustment;
- market-clearing vs aggressive case.

Language:
- "market-clearing range";
- "requires concession";
- "tight end requires strong book and stable spreads";
- "not financeable on acceptable terms in current market";
- "private credit offers certainty but at higher all-in cost".

## DCM investor objections
Prepare responses to:
- leverage still too high;
- weak fcf conversion;
- cyclicality/downside ebitda;
- use of proceeds, especially dividends or acquisitions;
- rating downgrade risk;
- covenant looseness;
- collateral leakage;
- maturity/refinancing risk;
- sponsor behavior;
- add-back quality;
- sector stress.

## DCM output checklist
A complete DCM view includes:
- capital need and debt capacity;
- recommended instrument/security/tenor;
- size and pricing range;
- pro forma leverage/coverage/maturity ladder;
- rating and covenant impact;
- market window and recent issuance comps;
- investor/lender targeting;
- execution timeline and documentation steps;
- fallback: smaller tranche, secured debt, private credit, bank bridge, equity/hybrid, amend-and-extend, delayed launch.
