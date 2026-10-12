# Covenant Analysis Playbook

Use this reference for the clause-by-clause workflow.

## Table Of Contents

- 0. Request classification
- 1. Document and capital structure map
- 2. Definitions that control the economics
- 3. Financial covenant review
- 4. Negative covenant review
- 5. Reporting and events of default
- 6. Collateral and guarantor coverage
- 7. Amendments and voting
- 8. Output discipline

## 0. Request classification

Classify the request before analyzing so the output lands at the right level of depth:

| Request type | Trigger | Main output |
|---|---|---|
| `term_sheet_screen` | term sheet, commitment paper, proposed financing terms | key terms, missing definitions, negotiation flags, headroom inputs needed |
| `credit_agreement_teardown` | full credit agreement or indenture | covenant map, definitions, baskets, leakage, events of default, reporting, collateral |
| `amendment_or_waiver_review` | amendment, consent, waiver, covenant reset | before/after economics, relaxed protections, hidden concessions, next tests |
| `covenant_headroom` | covenant certificate, ratios, model output, compliance question | actual vs threshold, cushion, first breach risk, data needs |
| `ebitda_definition_review` | EBITDA, Consolidated Net Income, add-back, pro forma, cost savings | lender EBITDA risk, add-back quality, cap/control flags, QoE handoff |
| `basket_capacity_review` | debt, liens, RPs, investments, asset sales, incremental facilities | capacity map, leakage paths, blocked vs permitted actions |
| `negotiation_playbook` | lender/sponsor asks, markup prep, structure changes | priority asks, fallback positions, lender protections, business rationale |

## 1. Document and capital structure map

Start every review by mapping:
- borrower / issuer
- parent, subsidiaries, guarantors, non-guarantors
- restricted vs unrestricted subsidiaries
- facility type: revolver, TLB, DDTL, unitranche, second lien, notes, mezzanine, preferred, ABL, private placement
- administrative agent, collateral agent, lenders, trustee, noteholders
- liens: first lien, second lien, pari passu, unsecured, structurally senior, structurally subordinated
- maturity, amortization, mandatory prepayments, cash sweep, excess cash flow sweep
- collateral package and excluded assets
- intercreditor or subordination agreement
- amendments, waivers, side letters, fee letters, and post-closing deliverables

## 2. Definitions that control the economics

Extract and summarize:

| Definition | Why it matters |
|---|---|
| Consolidated EBITDA | drives leverage, baskets, covenant compliance, incremental debt, RP/investment flexibility |
| Consolidated Net Income | starting point for EBITDA and builder basket |
| Consolidated Total Debt / Funded Debt / Secured Debt | numerator for leverage tests |
| First Lien Debt / Senior Secured Debt | controls secured leverage and first-lien capacity |
| Cash / unrestricted cash / net debt | determines whether debt can be netted and whether cash netting is capped |
| Fixed Charges / Interest Expense | controls coverage ratio and restricted payment tests |
| Pro Forma Basis | determines whether acquisitions, dispositions, cost savings, and debt incurrence are included |
| Available Amount / Builder Basket | controls restricted payments, investments, and sometimes debt prepayment capacity |
| Permitted Acquisition | controls acquisition capacity, conditions, and pro forma compliance |
| Restricted Subsidiary / Unrestricted Subsidiary | controls covenant perimeter and leakage risk |
| Excluded Subsidiary / Excluded Asset | controls collateral and guarantor coverage |

## 3. Financial covenant review

For every financial covenant, extract:
- covenant name
- ratio type: max total leverage, max net leverage, max first-lien leverage, max secured leverage, min interest coverage, min fixed charge coverage, min liquidity, borrowing base, loan-to-value
- test frequency and first test date
- threshold by period
- actual ratio or required input
- EBITDA definition used
- debt definition used
- cash netting and cash cap
- springing trigger, if any
- cure rights and cure frequency
- equity cure treatment: EBITDA add-back, debt paydown, cash retention, numerator/denominator treatment
- grace periods
- exceptions or holidays
- consequences of breach

Headroom convention:
- For maximum ratios: `headroom = threshold - actual`; positive is good.
- For minimum ratios: `headroom = actual - threshold`; positive is good.
- For minimum liquidity: `headroom = actual liquidity - required liquidity`; positive is good.

## 4. Negative covenant review

Analyze each covenant from the viewpoint of what value can leave the credit group or what debt can prime the lender.

### Debt covenant

Check:
- general debt basket
- incremental facilities and accordion
- ratio debt
- acquisition debt / permitted acquisition debt
- refinancing debt
- intercompany debt
- capital leases / purchase money debt
- securitization or receivables facilities
- debt at non-guarantors / foreign subs
- uncapped debt secured by junior liens or structurally senior entities
- MFN protections and sunsets
- reclassification ability
- liens permitted to secure each debt type

### Liens covenant

Check:
- general liens basket
- purchase-money liens
- liens securing incremental or ratio debt
- liens on non-guarantor assets
- receivables / securitization liens
- cash collateral / deposit account liens
- existing liens schedule
- junior lien and pari passu lien capacity
- lien reclassification

### Restricted payments covenant

Check:
- general RP basket
- builder basket / available amount
- starter basket
- tax distributions
- management equity repurchases
- dividends after IPO or listing
- ratio-based RP basket
- unlimited RPs if pro forma leverage met
- whether retained ECF, CNI, returns on investments, equity proceeds, declined proceeds, and contribution debt feed capacity

### Investments covenant

Check:
- general investments basket
- acquisitions / permitted acquisitions
- investments in unrestricted subsidiaries
- investments in non-loan parties
- intercompany investments
- joint ventures
- minority investments
- IP or asset transfers
- investments funded by available amount
- ratio-based investments
- reclassification

### Asset sales covenant

Check:
- permitted dispositions
- non-ordinary-course asset sales
- sale-leasebacks
- reinvestment period
- mandatory prepayment triggers
- excluded proceeds
- non-cash consideration limits
- transfer to unrestricted subs or JVs
- IP transfers
- collateral release mechanics

### Junior debt prepayment covenant

Check:
- prepayments of subordinated, junior lien, unsecured, or holdco debt
- debt-for-debt exchanges
- refinancing permissions
- available amount usage
- ratio-based permissions
- amendments to junior debt terms

### Affiliate transactions covenant

Check:
- management fees
- sponsor fees
- transition services
- tax sharing
- intercompany services
- ordinary-course exceptions
- fairness opinion or board approval thresholds

## 5. Reporting and events of default

Extract:
- monthly / quarterly / annual financial statements
- covenant certificates
- budgets
- borrowing-base certificates
- management calls
- field exams
- appraisal updates
- notice requirements
- default / event of default triggers
- cross-default or cross-acceleration thresholds
- judgment thresholds
- ERISA, tax, environmental, sanctions, anti-corruption, regulatory defaults
- material adverse effect provisions
- bankruptcy and insolvency triggers

## 6. Collateral and guarantor coverage

Review:
- all-asset pledge vs specified collateral
- excluded assets
- excluded subsidiaries
- foreign subsidiary pledge limits
- CFC / FSHCO or tax-driven limitations
- material subsidiary thresholds
- deposit account control agreements
- IP collateral and transfers
- real estate mortgages
- stock pledges and ownership caps
- post-closing deliverables
- collateral release on permitted dispositions, ratio tests, or investment-grade events

## 7. Amendments and voting

Flag sacred rights and voting thresholds for:
- principal amount and maturity
- interest rate and fees
- pro rata sharing
- payment priority
- collateral release
- guarantee release
- covenant changes
- EBITDA definition changes
- assignment restrictions
- open-market purchases / Dutch auctions
- non-pro rata priming or uptier risk

## 8. Output discipline

For each finding, distinguish:
- document fact
- financial calculation
- analyst interpretation
- legal question for counsel
- negotiation ask
- model handoff

Do not say a covenant is weak simply because it is borrower-friendly. Explain how value, collateral, priority, cash flow, or control could be affected.
