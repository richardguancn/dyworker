# Investment Banking Integration Reference

Use this reference when covenant analysis feeds other Investment Banking skills.

## Table Of Contents

- Default Investment Banking sequence
- Boundary reminders
- Upstream from capital-markets-issuance
- Upstream from private-credit-underwriting
- Handoff to financials-normalizer
- Handoff to private-credit-underwriting
- Handoff to lbo-model-build
- Handoff to three-statement-model-builder
- Handoff to model-audit-tieout
- Handoff to ib-deck-qc

## Default Investment Banking sequence

1. `financial-source-of-truth`
   - classify document versions and source tiers
   - label facts, assumptions, management claims, and inferences
   - resolve conflicts between summaries, filings, amendments, and models

2. `covenant-package-analyzer`
   - map definitions, covenants, baskets, leakage, collateral, guarantors, reporting, and defaults
   - compute or frame headroom
   - produce negotiation flags and data requests

3. `financials-normalizer`
   - test borrower / sponsor / seller adjusted EBITDA against source support
   - produce normalized EBITDA and lender-after-haircut EBITDA inputs where support exists
   - identify add-backs that may be covenant-eligible versus lender-creditable

4. `private-credit-underwriting`
   - convert covenant findings into credit approval, structure, pricing, protections, risk rating, and monitoring package

5. `lbo-model-build` or `three-statement-model-builder`
   - model covenant thresholds, liquidity, first-breach timing, debt paydown, cash sweeps, and downside cases

6. `model-audit-tieout`
   - audit covenant calculators, compliance models, and LBO / debt schedule outputs

7. `ib-deck-qc`
   - ensure final committee materials preserve definitions, headroom, as-of dates, caveats, and source footnotes

## Boundary reminders

- `covenant-package-analyzer` owns document-first covenant definitions, baskets, leakage, restricted payments, debt/lien capacity, amendments, waivers, and covenant EBITDA mechanics.
- `private-credit-underwriting` owns the borrower-level proceed / decline recommendation, lender case, downside, risk rating, collateral/recovery recommendation, and credit committee memo.
- `capital-markets-issuance` owns issuer-side financing strategy, instrument choice, market window, launch timing, investor targeting, and use-of-proceeds advice.
- If the user explicitly invokes this skill, keep it as lead and label adjacent-skill topics as inputs, caveats, or downstream handoffs.

## Upstream from capital-markets-issuance

Consume `capital_markets_issuance_to_covenant_package_analyzer` from `../../../references/handoff-contracts.md` when issuer financing advice creates covenant capacity, basket, lien, guarantee, amendment, waiver, or consent questions. Treat `covenant_capacity_assumption` as a question to test, not a conclusion.

## Upstream from private-credit-underwriting

Consume `private_credit_underwriting_to_covenant_package_analyzer` from `../../../references/handoff-contracts.md` when a credit memo, terms review, or lender case raises covenant definitions, threshold, headroom, reporting, collateral, leakage, or lender-protection issues. Preserve `selected_ebitda_basis`, `lender_after_haircut_ebitda`, `covenant_ebitda_proxy`, `headroom_or_proxy_headroom`, and `first_breach_or_breakpoint` as separate fields.

## Handoff to financials-normalizer

Pass:
- exact EBITDA definition
- add-back categories
- caps, time limits, and certifications
- pro forma adjustment language
- non-duplication language
- lender haircut concerns
- covenant EBITDA vs QoE EBITDA differences
- open support needed

Do not ask normalization to interpret the agreement. Ask it to test source support for the EBITDA items the agreement permits.

## Handoff to private-credit-underwriting

Pass:
- covenant package strength
- financial covenant headroom
- first-breach concerns
- EBITDA definition risks
- basket and leakage map
- collateral and guarantor gaps
- reporting obligations
- events of default
- amendment / waiver control concerns
- recommended lender protections

## Handoff to lbo-model-build

Pass:
- debt tranches and terms
- cash sweep / ECF sweep
- covenant thresholds by period
- EBITDA and net debt definitions
- cure mechanics
- revolver and minimum liquidity constraints
- debt incurrence / incremental limits
- first-breach stress assumptions

## Handoff to three-statement-model-builder

Pass:
- covenant formulas and periods
- model metrics needed: EBITDA, debt, cash, interest, FCCR, liquidity, capex, NWC
- reporting cadence
- scenario requirements
- forecast gaps that block covenant headroom

## Handoff to model-audit-tieout

Pass:
- covenant calculator workbook
- source document references
- definitions to tie
- high-risk formula areas
- thresholds and test periods
- known caveats

## Handoff to ib-deck-qc

Pass:
- headline covenant terms
- latest test date and as-of date
- exact ratio definitions
- headroom and cushion
- caveats that must accompany numbers
- source references and document dates
