# Output Templates and QA

## Sensitivity basis and readiness

For a substantive sensitivity workbook, show the following on the first-read tab and carry the same basis into the final response:

| field | required content |
|---|---|
| sensitivity basis | `supplied model`, `corrected scenario-ready base`, `audit-indicative diagnostic overlay`, or `not suitable for sensitivity reliance` |
| embedded corrections or adjustments | any corrections or diagnostic mechanics included before sensitivities are applied |
| excluded unresolved items | material issues outside the displayed sensitivity analysis |
| calculation integrity | whether base-cell tie-outs, formula checks, and backsolves passed |
| decision readiness | screen-grade, internal-review-ready, not ready for reliance, or blocked, with reason |

For merger-model EPS work, do not say the case breaks in the source model when the analysis is based on a corrected scenario-ready or audit-indicative baseline. State the selected basis before describing the breakpoint.

## Deal trigger metrics and contingency actions

For downside, financing, covenant, lender, sponsor-return, merger, or restructuring scenarios, always include:

| trigger | threshold | monitoring cadence | likely cause | deal action | owner | decision deadline |
|---|---:|---|---|---|---|---|

Default trigger categories:
- purchase price or offer price ceiling;
- reserve price or valuation floor;
- entry multiple or exit multiple threshold;
- EBITDA, revenue, margin, or synergy shortfall;
- sponsor IRR or MOIC floor;
- leverage, coverage, or covenant cushion threshold;
- minimum liquidity, revolver draw, or cash trough;
- spread, coupon, OID, fees, or refinancing cost threshold;
- share price, dilution, proceeds, or issuance-size threshold;
- EPS accretion/dilution, ownership, or pro forma leverage threshold;
- ratings, investor-demand, regulatory, or market-window trigger;
- plan value, collateral value, claim recovery, or fulcrum-security shift.

Do not stop at "downside case is worse." Identify what the deal team would watch and what decision it would make.

## Deal action register

| action | trigger | expected deal impact | owner | timing | reversibility | dependencies | risks |
|---|---|---:|---|---|---|---|---|

Use this when scenario outputs imply actions such as bid-price change, reserve-price reset, financing-structure change, covenant ask, lender protection, diligence request, synergy validation, market-window delay, client recommendation change, or restructuring negotiation point.

## Scenario QA checklist

Before finalizing, confirm:
- scenario labels match the actual assumptions used;
- each case changes the intended drivers only;
- scenario changes flow through the calculation engine, not only presentation labels;
- the stated sensitivity basis matches the baseline actually used;
- embedded corrections and excluded unresolved items are visible on the first-read tab;
- historical periods are not affected unless explicitly modeling pro forma history;
- base, upside, downside, lender, sponsor, and stress cases use the same accounting and sign conventions;
- output comparisons are versus the correct base case and model version;
- sensitivity tables point to real driver cells, not copied outputs;
- target backsolves do not use hidden plugs or impossible combinations of levers;
- valuation, liquidity, leverage, covenant, accretion/dilution, returns, proceeds, and recovery effects are visible when relevant;
- source dates and as-of dates are disclosed where they affect outputs;
- EBITDA, earnings, share count, net debt, and covenant bases are consistent or caveated;
- thresholds, cliffs, financing windows, and non-linear behavior are identified;
- deal actions are linked to controllable or negotiable drivers;
- every material caveat or missing assumption is listed.

## Investment Banking handoff outputs

When handing off to another skill, include:
- scenario overlay table;
- case summary outputs;
- sensitivity table or tornado ranking;
- target-backsolve result and feasibility label;
- trigger metrics and deal actions;
- source, model, and as-of-date caveats;
- model-readiness caveats;
- workbook-QA requirement if Excel was changed or delivered;
- deck or memo caveats that must travel with the output.

For deterministic starter artifacts, use the skill-root-relative script [`scripts/materialize_sensitivity_pack.py`](../scripts/materialize_sensitivity_pack.py). It emits a workbook-first scaffold plus overlay, case summary, sensitivity, trigger, action, target-backsolve, and manifest support files described above.
