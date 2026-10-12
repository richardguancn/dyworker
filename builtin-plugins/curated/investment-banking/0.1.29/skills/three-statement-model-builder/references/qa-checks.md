# QA Checks

Hard failures: invalid plan, missing source basis, unbalanced historical balance sheet, missing scenarios, broken workbook write, missing run log, failed formula-template inspection, or unresolved mechanical tie-out breaks.

Warnings: placeholders, stale sources, analyst-estimate-heavy forecast, unsupported margin expansion, unexplained working-capital improvement, capex below maintenance needs, liquidity stress, missing debt capacity or covenant evidence, covenant pressure, detached control-workbook citation ledgers, or weak scenario design.

Status logic: hard failures force `not-decision-ready`; material placeholders usually cap status at `screen-grade`; clean mechanics with review items can be `senior-review-ready`; decision-grade requires current sources and no material caveats.

Senior review should ask what drives growth, where cash is consumed, what breaks first in downside, whether EBITDA converts to cash, and which assumptions need diligence.

First-read status QA:
- Confirm the first visible tab reports both explicitly labeled status fields: `Calculation integrity` and `Decision readiness`.
- Do not display an unqualified overall `OK` when material forecast assumptions, liquidity support, debt availability or covenant definitions remain unresolved.
- If debt documents are not provided, confirm debt draws, cash sweeps, minimum-cash mechanics and any liquidity or covenant discussion are labeled illustrative and decision readiness is no higher than `screen-grade`.
- Search every visible status block for `Model status`, `Overall`, `QA posture`, `Calculation integrity`, and `Decision readiness`; replace any generic `OK` reliance conclusion with separate calculation-integrity and decision-readiness rows whose posture agrees with the first-read summary.

Workbook evidence QA:
- Confirm `model_citations.json` records for headline revenue, EBITDA, FCF, ending cash, ending debt and net leverage reference the exact workbook delivered to the user, not a separate control export or earlier variant.
- Confirm headline citation values reconcile to the first-read and relevant statement/scenario tabs before using them in a memo, deck or optional HTML companion.
- Record formula-error scan evidence as an explicit result or match count in the run log.
- Check balance sheet, cash tie and debt roll-forward under each material displayed scenario and for the forecast periods used in headline conclusions.
