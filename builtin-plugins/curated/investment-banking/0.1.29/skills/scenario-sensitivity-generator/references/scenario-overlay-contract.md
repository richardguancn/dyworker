# Scenario Overlay Contract

When transaction scenarios need to feed a workbook or another skill, produce a scenario overlay table with these fields.

| field | purpose |
|---|---|
| transaction_version | model version, as-of date, model file, committee case, client case, lender case, or market-data snapshot |
| sensitivity_basis | `supplied model`, `corrected scenario-ready base`, `audit-indicative diagnostic overlay`, or `not suitable for sensitivity reliance` |
| embedded_corrections_or_adjustments | corrections or diagnostic adjustments already incorporated in the selected baseline, or `none identified` |
| excluded_unresolved_items | material unresolved items not incorporated in displayed sensitivity outputs |
| case | base, upside, downside, stress, lender case, sponsor case, management case, market case, restructuring case, etc. |
| model_module | valuation, comps, DCF, LBO, merger, operating forecast, debt schedule, covenant, financing, recovery waterfall, sensitivity exhibit |
| transaction_driver | exact driver being changed |
| baseline_value | current source-model value |
| scenario_value | proposed case value |
| delta_type | absolute, percentage change, bps change, replacement, timing shift, ramp, floor, cap |
| start_period | first affected period, if applicable |
| end_period | last affected period, if applicable |
| deal_rationale | why the change belongs in the transaction case |
| controllability | controllable, partially controllable, external market, document-driven, legal/process-driven, or mechanical |
| deal_owner | coverage, M&A, LevFin, ECM, DCM, restructuring, sponsor, lender, client, legal, tax, accounting, diligence, or model owner |
| review_status | proposed, reviewed, approved, rejected, expired, or not model-validated |
| expiry_review_date | date, market-window checkpoint, committee date, or model-refresh cycle when assumption must be revisited |
| output_impact | enterprise value, equity value, value per share, premium, IRR, MOIC, accretion/dilution, proceeds, dilution, debt capacity, leverage, coverage, covenant cushion, liquidity, recovery, or fulcrum |
| caveat | limitation, missing source, as-of-date mismatch, unsupported claim, or execution risk |

## Handoff rules

- Use one row per changed driver per scenario.
- State the sensitivity basis consistently in the first-read tab, scenario overlay, and final response.
- Do not present a corrected scenario-ready base or audit-indicative diagnostic overlay as the unmodified source model.
- If the baseline is `not suitable for sensitivity reliance`, do not display unsupported decision outputs as a base case; state the blocker or use an expressly labeled diagnostic overlay.
- Do not hide formula changes inside transaction cases.
- Keep historical periods locked unless explicitly modeling pro forma history.
- Keep source, market, and model as-of dates visible when they affect outputs.
- Use the overlay as the source of truth for downstream model updates.
- If the overlay contains placeholders, label them and keep the case status as not model-validated.
