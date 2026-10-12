# Baskets and Leakage Taxonomy

Use this reference when analyzing EBITDA definitions, baskets, leakage, priming risk, and lender negotiation flags.

## Table Of Contents

- EBITDA definition risk taxonomy
- Basket mechanics
- Leakage paths
- Negotiation flag library
- Credit memo phrasing

## EBITDA definition risk taxonomy

### Common EBITDA expansion items

Flag items that increase covenant EBITDA beyond lender-underwritten EBITDA:
- run-rate cost savings
- synergies
- pro forma acquisitions and dispositions
- restructuring charges
- integration costs
- transaction costs
- start-up costs
- severance
- litigation / settlements
- non-cash charges
- unusual, extraordinary, non-recurring, or exceptional items
- losses from discontinued operations
- add-backs for lost revenue or expected savings
- management fees
- sponsor fees
- public company costs
- business interruption proceeds
- currency or hedging adjustments
- add-backs for failed initiatives

### Key controls to extract

For every meaningful add-back category, identify:
- dollar cap
- percentage cap of EBITDA
- time limit after event or acquisition
- requirement that action be taken or committed
- audit or officer certification requirement
- third-party verification requirement
- whether add-backs are net of actual benefits realized
- whether duplicative add-backs are prohibited
- whether repeated costs are excluded
- whether projected savings must be reasonably identifiable and factually supportable

### Red flags

| Red flag | Why it matters |
|---|---|
| uncapped run-rate savings | can inflate leverage capacity and covenant compliance |
| broad unusual / non-recurring language | may allow recurring costs to be added back |
| no look-forward / look-back limit | expands add-back period |
| no cap on restructuring or integration | encourages aggressive normalization |
| no anti-duplication language | same benefit may be counted twice |
| pro forma acquisitions without QoE support | purchased EBITDA can inflate debt capacity |
| cost savings not required to be implemented | speculative EBITDA enters covenant math |
| unrestricted cash netting without cap | leverage may appear better than creditor recovery economics |

## Basket mechanics

### Basket types

| Basket type | How it works | Analyst concern |
|---|---|---|
| Fixed basket | fixed dollar capacity | may be large relative to EBITDA or collateral |
| Grower basket | greater of fixed dollar and percentage of EBITDA/assets | grows as EBITDA increases; can expand with add-backs |
| Ratio basket | unlimited if pro forma leverage or coverage test is met | relies heavily on EBITDA definition and pro forma debt treatment |
| Builder basket / Available Amount | builds from retained excess cash flow, CNI, equity proceeds, returns, declined proceeds | can fund RPs, investments, or junior debt prepayments |
| Starter basket | immediate opening capacity | leakage on day one |
| Free-and-clear basket | capacity not counted against ratio debt or lien tests | can stack with other baskets |
| Reclassification right | permits later reclassifying usage to another basket | obscures usage and replenishes capacity |
| Contribution debt | debt capacity based on equity contributions | can convert equity proceeds into debt capacity |
| Incremental equivalent debt | debt outside the credit agreement using incremental basket | may sit pari passu, junior, or structurally senior |

### Capacity questions

For each basket, ask:
- What action does it permit?
- What entity can use it: borrower, guarantor, non-guarantor, unrestricted subsidiary?
- Is it fixed, grower, ratio-based, or builder-based?
- Can it be reclassified?
- Can it be stacked with other baskets?
- Is prior usage known?
- Does usage require no default, pro forma compliance, or a leverage condition?
- Does the basket permit liens, debt, investments, restricted payments, asset transfers, or junior debt payments?

## Leakage paths

### Value leakage

Flag provisions that allow value to leave the credit group:
- investments in unrestricted subsidiaries
- investments in non-guarantor subsidiaries
- dividends or restricted payments
- asset sales with reinvestment rights and no paydown
- IP transfers to non-guarantors or unrestricted subsidiaries
- affiliate transactions / sponsor fees
- tax distributions beyond actual tax need
- junior debt prepayments
- sale-leasebacks
- receivables facilities
- factoring or securitization

### Priority leakage / priming

Flag provisions that allow debt to prime or structurally outrank lenders:
- incremental first-lien debt
- ratio debt secured pari passu or senior through non-guarantors
- ABL superpriority or FILO features
- debtor-in-possession financing permissions
- non-pro rata uptier amendment mechanics
- unrestricted subsidiary debt secured by transferred assets
- excluded subsidiaries incurring debt against valuable assets
- collateral release or guarantee release triggers

### Collateral leakage

Flag:
- excluded assets with high value
- broad excluded subsidiaries
- material IP not pledged or transferable
- deposit accounts not controlled
- real estate excluded by threshold
- foreign pledge limits too broad
- automatic release on investment-grade event or asset sale
- collateral not required for future material subsidiaries

## Negotiation flag library

Use these as starting asks; tailor to the document and deal leverage.

| Issue | Lender ask | Fallback |
|---|---|---|
| Uncapped EBITDA add-backs | cap at percentage of EBITDA and require factual support | subcap only for run-rate savings/synergies |
| Broad non-recurring add-backs | define categories and exclude recurring costs | require officer certification and no duplication |
| Large grower baskets | reduce grower percentage or limit to restricted group | require pro forma no default and leverage test |
| Unrestricted subsidiary leakage | cap investments and restrict material IP transfers | require value leakage reporting and springing guaranty on re-designation |
| Incremental pari passu debt | add leverage condition, MFN, maturity, amortization, and use-of-proceeds limits | limit free-and-clear amount and require pro forma compliance |
| Junior debt payments | restrict to de minimis basket and no default | allow only with leverage test and no covenant breach |
| Weak reporting | add monthly financials, covenant certificate, lender calls, budget, and notices | add reporting while leverage exceeds threshold |
| Springing covenant too loose | lower springing threshold or add minimum liquidity | add reporting trigger before covenant springs |
| Equity cure too generous | limit frequency, amount, and EBITDA treatment | allow cure as debt paydown, not EBITDA add-back |

## Credit memo phrasing

Good findings tie the legal text to economics:
- Weak: "The EBITDA definition is broad."
- Strong: "Run-rate savings are uncapped and can be included on a pro forma basis, so debt capacity and covenant compliance may be materially higher than QoE-supported lender EBITDA. Request a cap and officer certification tied to actions taken."
