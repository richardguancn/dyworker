# Investment Banking Integration Reference

Use this reference when the private credit underwriting workflow depends on or feeds other Investment Banking skills.

## Table Of Contents

- [Default Investment Banking Sequence For A Live Deal](#default-investment-banking-sequence-for-a-live-deal)
- [Handoffs From Upstream Skills](#handoffs-from-upstream-skills)
- [Downstream Handoffs](#downstream-handoffs)
- [Boundary Reminders](#boundary-reminders)

## Default Investment Banking Sequence For A Live Deal

1. `financial-source-of-truth`
   - classify sources, dates, and fact / claim labels
   - identify source conflicts and stale data

2. `cim-teardown`
   - extract seller claims, management claims, red flags, and evidence asks
   - identify diligence items that affect credit decision

3. `excel-data-cleaner`
   - clean management accounts, TB, GL, covenant schedules, AR/AP aging, borrowing base, and KPI exports

4. `financials-normalizer`
   - build or validate EBITDA bridge, normalized EBITDA, lender-after-haircut view, and NWC support

5. `three-statement-model-builder`
   - build or update borrower operating model and lender case

6. `private-credit-underwriting`
   - synthesize borrower, terms, covenants, collateral, downside, risk rating, recommendation, and conditions
   - lead only when the output is lender decisioning or credit committee synthesis

7. `model-audit-tieout`
   - independently review workbook formulas, source tie-outs, and sensitivity logic before committee use

8. `ib-deck-qc`
   - check final memo, committee pack, lender deck, and repeated metrics before circulation

## Handoffs From Upstream Skills

### From `capital-markets-issuance`

When issuer financing context feeds borrower-level credit decisioning, consume `capital_markets_issuance_to_private_credit_underwriting` from `../../../references/handoff-contracts.md`.

Use market-clearing views as inputs only. Re-underwrite borrower risk, lender case, collateral, downside, conditions, and recommendation before making a credit conclusion.

### From `financial-source-of-truth`

Expect:

- source inventory
- evidence labels
- source hierarchy
- stale-data flags
- source conflicts
- assumptions and open items

Use these to set memo posture and evidence limitations.

### From `cim-teardown`

Expect:

- claims ledger
- evidence asks
- red flags
- management / seller claims
- underwriting quick math
- workplan

Map claims into credit risks, mitigants, and diligence conditions.

### From `financials-normalizer`

Expect:

- reported EBITDA
- adjusted EBITDA
- normalized EBITDA
- lender-after-haircut EBITDA
- NWC peg / screen
- adjustment support status
- lender treatment and haircut rationale

Use lender-after-haircut EBITDA for debt sizing unless the user explicitly requests management case.

### From `three-statement-model-builder`

Expect:

- base / lender / downside cases
- cash flow forecast
- debt and liquidity outputs
- covenant headroom
- source and assumption labels
- checks status

Use these outputs to assess repayment and stress protection.

### From `comps-valuation`

Expect:

- valuation range
- peer multiple support
- EV cushion
- market context
- peer set caveats

Use comps as recovery / valuation cushion context, not as the primary source of repayment.

## Downstream Handoffs

### To `covenant-package-analyzer`

Pass `private_credit_underwriting_to_covenant_package_analyzer` from `../../../references/handoff-contracts.md` when the credit view raises document-definition, basket, headroom, reporting, amendment, waiver, or lender-protection questions.

### To `distressed-recovery-waterfall`

Pass `private_credit_underwriting_to_distressed_recovery_waterfall` from `../../../references/handoff-contracts.md` when watchlist triggers, default/amendment risk, lien priority, recoveries, or first-loss drivers become central.

### To `memo-builder`

Pass:

- recommendation
- investment / credit thesis
- risk rating
- metrics table
- downside and first-break analysis
- conditions and monitoring plan

### To `model-audit-tieout`

Pass:

- workbook or model output
- covenant definitions
- ratio definitions
- sensitivity drivers
- source inventory
- checks status and known limitations

### To `ib-deck-qc`

Pass:

- final metric table
- sources and as-of dates
- EBITDA basis definitions
- covenant thresholds and headroom
- scenario names and outputs
- open caveats

## Boundary Reminders

- `capital-markets-issuance` owns issuer-side financing strategy, instrument choice, market window, launch timing, investor targeting, and use-of-proceeds advice.
- `private-credit-underwriting` owns borrower-level credit recommendation, lender case, downside, risk rating, conditions, collateral/recovery read-through, and committee memo.
- `covenant-package-analyzer` owns document-first covenant definitions, baskets, leakage, restricted payments, debt/lien capacity, amendments, waivers, and covenant EBITDA mechanics.
- If the user explicitly invokes this skill, keep it as lead and label adjacent-skill topics as inputs, caveats, or downstream handoffs.
