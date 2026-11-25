# Optional report patterns

Use these as starting ideas, not required structures. Combine or omit parts according to the question and available evidence. The [public component examples](../../../output_formats/html/examples/compositions/README.md) show how to implement the pieces in the shared runtime.

| Reporting job | Useful composition | Common mistake |
| --- | --- | --- |
| One-metric brief | Answer, compatible comparison, one useful visual or exact values, material limitation | Inflating a narrow answer with forecasts or recommendations |
| [Investigative report](investigative-report.md) | One opening summary connecting the original question, current answer, confidence, and next action; deeper evidence organized around hypotheses; discriminating next tests | Answering a convenient sub-question, listing disconnected metrics, or treating uncertainty as unfinished generation |
| Operating review | Current state, meaningful changes, selected drivers/segments, risks and feasible actions | Turning the sample's metric/source list into a quota |
| Experiment readout | Decision, design/population, effect and uncertainty, guardrails, interpretation | Calling an inconclusive result a win or inferring causality from observational data |
| Forecast/scenario | Observed baseline, labeled projections, assumptions, sensitivity, decision range | Drawing future values as if they were observed |
| Technical/data-quality assessment | Scope, test/method, affected data, findings, limitations, reproducible evidence | Hiding the method when it is the reason for the report |
| Opportunity/segment analysis | Relevant segments, comparable denominators, size/tradeoffs, evidence-backed prioritization | Ranking segments using incompatible populations |

The [substantial adoption/retention example](../../../output_formats/html/examples/compositions/reports/adoption-retention/README.md) is one operating-review composition. Its executive/technical variants and charts are available to borrow selectively; its business story does not define a valid report.

## Operating reviews

Distinguish the latest-period comparison, longer-term trajectory, and changes in population mix. If the report makes a central claim about a longer trend, show that period in a readable trend visual; a latest-period bar chart and a historical table hidden in source details cannot establish the pattern visually. A chart can support several related findings when its population and period cover them. Do not add charts for incidental figures or exact lookup alone.

When revising, reconcile every affected headline, chart, table, and recommendation. Preserve useful historical context while removing superseded conclusions. Prioritize actions using the magnitude of the problem, affected population, and available capacity, not a percentage gap alone.

## Experiment decisions

Show the decision-relevant effect and its interval against the no-effect boundary and any prespecified margin. Arm-rate bars alone cannot show whether an estimated lift is established; an effect/interval plot or equally readable uncertainty visual should make that distinction visible. Apply the same care to a guardrail when its uncertainty determines whether the launch condition passes.

Connect the ship-or-hold decision to the actual joint decision rule. Keep final eligible outcomes separate from immature snapshots, and distinguish an exploratory subgroup from an established basis for a narrower rollout. State the next check that could change the decision without claiming that an inconclusive result proves no effect.
