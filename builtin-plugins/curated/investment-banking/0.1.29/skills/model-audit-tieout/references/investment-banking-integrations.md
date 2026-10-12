# Investment Banking Skill Integrations

## Table Of Contents
1. Role of model-audit-tieout
2. Integration rules
3. Recommended Investment Banking workflow examples

## Role of model-audit-tieout

This skill is the quality-control and review layer for existing financial models. It should not replace model-builder skills. It should help decide whether a model is usable, what breaks, what does not tie, and what must be fixed before the output is used in an investment, credit, client, or committee decision.

## Integration rules

### financial-source-of-truth
Use for source hierarchy, stale-data standards, citation format, evidence labels, assumption/fact separation, and source conflicts.

Typical handoff:
1. model-audit-tieout identifies key model drivers and unsupported or conflicting values.
2. financial-source-of-truth establishes the controlling source and evidence posture.
3. model-audit-tieout updates the issue log and tie-out ledger.

### excel-data-cleaner
Use before audit when the workbook or data extract is too messy to review reliably.

Trigger examples:
- source tabs have merged, duplicated, or ambiguous headers
- row grain is unclear
- imported data has mixed date/number formats
- category labels are inconsistent
- raw exports need normalization before tie-out

### three-statement-model-builder
Use after audit when an integrated operating model needs to be rebuilt, extended, or corrected.

Audit focus before handoff:
- balance sheet and cash flow checks
- working capital, debt, capex, and tax logic
- forecast driver support
- scenario design

### dcf-model-builder
Use after audit when a valuation model needs to be built or remediated.

Audit focus before handoff:
- source-supported historicals
- forecast assumption support
- wacc and terminal value logic
- ev-to-equity bridge
- valuation sensitivity table integrity

### comps-valuation
Use when the model audit finds issues in peer selection, market data, valuation multiples, calendarization, or implied valuation ranges.

Audit focus:
- peer rationale
- market cap, enterprise value, net debt, shares, and currency
- ltm/ntm metric source and normalization
- outlier treatment
- valuation range precision

### cim-teardown
Use when source tie-out reveals seller claims, unsupported cim assertions, or diligence gaps.

Audit focus:
- claims embedded in model inputs
- add-backs and pro forma adjustments
- revenue pipeline, backlog, churn, margin, capex, and working capital claims
- gating diligence requests

If the model consumed a CIM teardown `model_input_handoff`, audit it against `cim_teardown_to_model_builder` in `../../../references/handoff-contracts.md`. Each seller-derived input used in the model should preserve `source_pointer`, `native_evidence_label`, `canonical_evidence_category`, `recommended_model_treatment`, `case_mapping`, and any `model_blocker_flag`; flag any model input that ignores an `exclude`, `blocker`, `placeholder`, or `sensitivity only` treatment.

### financials-normalizer
Use when adjusted ebitda, run-rate adjustments, revenue recognition, working capital support, or lender/sponsor EBITDA definitions drive the model.

Audit focus:
- support for add-backs
- normalized EBITDA bridge
- sponsor vs lender view
- adjustment sensitivity in leverage, valuation, and returns

### lbo-model-build
Use after audit when an LBO model or sponsor returns package needs to be rebuilt or corrected.

Audit focus:
- sources and uses
- debt schedule
- cash sweep and revolver mechanics
- covenant headroom
- sponsor returns
- exit and deleveraging sensitivities

### memo-builder
Use after audit to turn findings into a decision memo or IC section.

Audit output to pass forward:
- readiness posture
- unresolved critical/high issues
- key source-supported findings
- assumptions requiring sensitivity
- decision-impact caveats
- open diligence asks

### public-company model update support
Use when the model supports public-company, investor-day, guidance, or post-reporting analysis inside an IB workflow.

Audit focus:
- consensus and guidance as-of dates
- quarter/period alignment
- reported vs adjusted metrics
- KPI definitions
- model update bridge
- transcript/source support

### scenario-sensitivity-generator and capital-markets-issuance
Use when a market, macro, regulatory, geopolitical, rate, commodity, or policy shock changes model assumptions, financing windows, debt capacity, valuation cases, or downside scenarios.

Audit focus:
- current market data and as-of dates
- scenario coherence
- second-order effects
- exposure mapping
- stale assumptions after the event

### private-credit-underwriting
Use when the model supports debt sizing, credit approval, lender memo, covenant review, refinancing, or downside liquidity analysis.

Audit focus:
- EBITDA definition and add-backs
- debt capacity and leverage
- interest coverage and fixed charge coverage
- covenants and baskets
- liquidity runway and revolver use
- collateral and recovery assumptions

### ib-deck-qc
Use when model outputs appear in a deck, report, memo, board pack, or client deliverable.

Audit focus before handoff:
- model output values to deck values
- units, periods, currency, and rounding
- footnotes and source citations
- chart labels and narrative consistency

## Recommended Investment Banking workflow examples

### PE deal model review
1. cim-teardown identifies seller claims and diligence asks.
2. financial-source-of-truth labels evidence and source hierarchy.
3. financials-normalizer tests adjusted EBITDA and NWC support.
4. model-audit-tieout reviews the LBO or operating model.
5. lbo-model-build remediates if a rebuilt model is needed.
6. memo-builder synthesizes the decision.

### Public equity valuation review
1. financial-source-of-truth validates filings, market data, consensus, and transcript support.
2. model-audit-tieout audits 3-statement, DCF, and comps model outputs.
3. dcf-model-builder or comps-valuation remediates if needed.
4. memo-builder uses only decision-ready outputs.

### Private credit committee review
1. financial-source-of-truth establishes source hierarchy for borrower data, qoe, credit docs, and lender materials.
2. model-audit-tieout audits debt schedule, covenant, liquidity, and downside calculations.
3. private-credit-underwriting prepares the credit memo.
4. ib-deck-qc reconciles the credit committee deck to the model.
