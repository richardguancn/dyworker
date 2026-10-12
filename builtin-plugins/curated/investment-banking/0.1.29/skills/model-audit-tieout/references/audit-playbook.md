# Model Audit Playbook

## Table Of Contents
1. Audit mandate and workflow spine
2. Key outputs and decision drivers
3. Audit modes
4. Model-specific audit focus
5. Audit-indicative diagnostic bridges
6. Decision-readiness posture

## Audit mandate and workflow spine

Establish scope from the user request. If unstated, assume a broad but non-destructive audit covering workbook structure, formulas, sources, assumptions, sensitivities, and decision outputs.

Capture:
- model type: dcf, lbo, 3-statement, comps, earnings update, private credit, distressed recovery, real estate, macro/rates, or mixed.
- decision context: screen, IC memo, credit committee, client deck, earnings note, diligence workplan, board pack, or live transaction.
- materiality threshold: what magnitude of error would change the decision, valuation range, leverage sizing, covenant outcome, or recommendation.
- required output: issue log, model audit memo, source tie-out ledger, fix instructions, rewritten formulas, or full QA pack.

Use this workflow spine for full reviews:
1. Inventory the model and source materials.
2. Identify material outputs and trace them backward to assumptions, formulas, source tabs, and source documents.
3. Apply formula and workbook controls.
4. Tie model assumptions to evidence and label unsupported, stale, or conflicting drivers.
5. Review sensitivity and scenario design against the decision context.
6. Build the issue log with severity, category, location, finding, decision impact, recommended fix, and owner.
7. Produce the requested audit artifact, stopping before workbook remediation unless the user asked for edits.

## Key outputs and decision drivers

For each material output, trace backward to the assumptions, formulas, source tabs, and source documents that drive it.

| Output family | Examples to trace |
|---|---|
| valuation | equity value, enterprise value, per-share value, valuation range, implied multiple, DCF value, comps range |
| returns | IRR, MOIC, cash-on-cash, exit proceeds, deleveraging, sponsor value creation bridge |
| merger / accretion-dilution | consideration, pro forma ownership, financing uses, incremental interest, synergies, EPS bridge, accretion/dilution, leverage |
| credit | leverage, interest coverage, fixed-charge coverage, covenant headroom, liquidity runway, debt capacity, borrowing base, recovery value |
| earnings | revenue, EBITDA, EPS, FCF, KPIs, guidance, consensus delta, bridge items |
| real assets | NOI, DSCR, debt yield, LTV/LTC, cap rate, occupancy, rent roll rollover, reserve needs |
| macro/fixed income | duration, convexity, spread, yield, carry, breakeven, curve exposure, FX sensitivity |

## Audit modes

### Rapid screen
Use only when the user explicitly wants a quick view of model health, red flags, top issues, or readiness for a meeting. Otherwise default to the full audit workflow.

Deliver:
- model purpose and inferred decision context
- health score: green, yellow, red, or not assessable
- top 5 issues by decision impact
- must-fix items before use
- open questions and missing files

### Formula integrity audit
Use when the user asks whether formulas are right, whether a workbook is broken, or whether formulas tie across tabs.

Check:
- formulas copied consistently across rows and periods
- formulas using source/assumption cells rather than embedded constants
- external workbook links and stale links
- hidden or very hidden tabs
- volatile formulas: today, now, rand, offset, indirect, info, cell
- circular references or iterative-calculation dependencies
- balance sheet, cash flow, debt schedule, and covenant checks
- formulas that point to blank cells or unused ranges
- formulas overwritten by hardcoded values inside expected formula regions

### Source tie-out audit
Use when the user asks whether model values tie to filings, cims, vdr files, market data, earnings documents, third-party data, or internal assumptions.

Check:
- each material historical number ties to a named source
- each forecast driver has a source, bridge, or explicit assumption
- stale market data and stale consensus are identified with as-of dates
- seller/management claims are not treated as verified facts
- conflicting sources are escalated rather than silently averaged
- each final output has a source path from source document to model cell to final output

### Scenario and sensitivity review
Use when the user asks whether a model is appropriately stress-tested.

Check:
- base, downside, and upside are coherent cases, not isolated arbitrary toggles
- sensitivity variables reflect the real value/risk drivers
- downside includes plausible negative outcomes for the asset class
- extreme cases do not break formulas or produce impossible outputs
- output ranges are not presented with false precision

### IC-ready QA
Use when the model will support an investment memo, credit committee, client deck, board pack, or transaction decision.

Combine:
- workbook/formula audit
- source tie-out and evidence labels
- assumption critique
- scenario and downside review
- output traceability
- issue log with severity and owners
- decision-readiness posture

## Model-specific audit focus

### DCF / intrinsic value
- historical actuals tie to filings or source documents
- revenue, margin, capex, tax, working capital, and fcf assumptions are explicit
- terminal growth and exit multiple assumptions are defensible and not duplicative
- wacc, cost of equity, beta, risk-free rate, credit spread, and tax assumptions are sourced or clearly assumed
- enterprise-to-equity bridge includes debt, cash, minority interest, preferred, pensions, leases, and other claims where material
- sensitivity tables show the true drivers and do not overstate precision

### Three-statement operating model
- income statement, balance sheet, and cash flow statement link correctly
- working capital, depreciation, capex, debt, taxes, and equity schedules are internally consistent
- balance sheet balances in every period and checks are meaningful
- cash flow statement ties to cash on the balance sheet
- assumptions flow through all statements and do not create hidden plugs

### LBO / sponsor returns
- sources and uses tie to purchase price, fees, rollover, financing, and balance sheet adjustments
- debt schedule includes correct amortization, cash sweep, revolver mechanics, interest, fees, and maturity assumptions
- covenant headroom and liquidity troughs are tested in downside cases
- exit assumptions are explicit and not circularly justified by target returns
- irr/moic ties to sponsor equity invested and exit proceeds
- value creation bridge separates ebitda growth, multiple expansion, deleveraging, cash generation, and fees

### Merger / accretion-dilution
- cash and stock consideration, exchange ratio, implied value, and pro forma ownership tie to transaction disclosure or are visibly labeled assumptions
- financing uses include cash consideration, target debt/refinancing or payoff, fees, required cash retention, and other announced funding needs where applicable
- incremental interest applies to the complete supported funding basis and financing-fee amortization or other excluded items are stated
- synergy amount, realization timing, tax treatment, integration costs, and dis-synergies are explicit; run-rate benefits are not recognized before the stated ramp
- EPS convention is explicit, including purchase accounting, amortization, transaction costs, share-count convention, convertibles/awards, and adjusted-versus-GAAP treatment
- sensitivities inherit corrected funding and synergy logic rather than reusing a broken headline bridge
- mechanical PASS checks explicitly test funding completeness, synergy ramp application, ownership/share-count integrity, and EPS bridge completeness before reliance

### Comps / valuation range
- peer universe is justified and not cherry-picked
- market values, net debt, minority interest, preferred, leases, and other adjustments are current and sourced
- ltm/ntm metrics are calendarized and normalized consistently
- outliers are treated explicitly
- implied valuation range is not presented as more precise than the peer set supports

### QoE / adjusted EBITDA
- adjustments are source-supported and categorized as non-recurring, pro forma, accounting, run-rate, or management add-back
- run-rate and one-time adjustments are separated
- working capital peg logic is supportable
- lender view and sponsor view are not conflated
- adjustments that materially change leverage or valuation are escalated

### Private credit / leveraged finance
- debt capacity, leverage, interest coverage, fixed charge coverage, and liquidity are calculated consistently
- covenants are defined using the actual credit agreement or term sheet definitions
- EBITDA add-backs and baskets are source-supported
- downside case tests debt service, liquidity, revolver usage, refinancing, and covenant breach risk
- collateral, guarantees, priority, and recovery assumptions are visible

### Distressed / restructuring
- debt stack, collateral, guarantees, maturity, priority, liens, and intercreditor mechanics are mapped
- recovery waterfall follows priority and claim assumptions
- plan value, liquidation value, and recovery sensitivities are separated
- DIP and exit financing assumptions are explicit
- fulcrum security and impaired classes are identified with uncertainty

### Real estate / infrastructure / real assets
- NOI, occupancy, rents, rent roll, capex, reserves, taxes, insurance, and leasing costs are sourced
- DSCR, debt yield, LTV/LTC, and cap rate assumptions are current and supportable
- tenant rollover, lease expirations, market rent, and occupancy risk are stress-tested
- construction/project finance models include draw schedule, contingency, completion, and interest reserve logic

### Macro, rates, fixed income, FX, commodities
- prices, yields, curves, spreads, indices, and macro releases have as-of dates
- duration, convexity, carry, roll-down, and spread assumptions are clear
- base/downside/upside cases reflect coherent macro regimes
- stale market data is not mixed with current market commentary
- source conflicts across vendors, central bank data, and market feeds are flagged

## Audit-indicative diagnostic bridges

When a discrete logic or source-scope issue materially affects a headline output, quantify a minimum diagnostic adjustment if the needed input is visible in the supplied model or directly supported by reviewed evidence.

- Keep the source model unchanged unless the user explicitly requests remediation.
- Label each adjusted row or column `audit-indicative`, `diagnostic`, or `minimum identified-error correction`; never imply a rebuilt or fully corrected model.
- Show reported output, diagnostic output, adverse or favorable change, source/model location, calculation treatment, and unresolved exclusions. If the diagnostic corrects only part of a disclosed or benchmark amount, show the incorporated adjustment and residual unresolved gap as separate amounts.
- Use the diagnostic to size the reliability problem, not to claim investment, fairness, committee, or client readiness.
- State material items not included in the diagnostic, such as fees, purchase accounting, integration costs, close-date capitalization, updated forecasts, or dilution treatment.

## Decision-readiness posture

Use one of these labels:

- **ready for decision:** no unresolved critical/high issues, material outputs have source support, assumptions and downside are clearly disclosed.
- **ready with caveats:** usable if caveats are explicitly included in the memo/deck and listed fixes are not decision-changing.
- **not ready:** critical or high issues block use for an ic, lender, client, or trading decision.
- **not assessable:** missing workbook, key tabs, source documents, or outputs prevent reliable review.

Report the audited model's decision-readiness posture separately from the audit pack's completion state. A complete and usable audit workbook may conclude that the underlying model is `not ready` for the requested decision.
