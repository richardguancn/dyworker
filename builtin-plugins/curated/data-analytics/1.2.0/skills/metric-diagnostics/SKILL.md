---
name: metric-diagnostics
description: "Diagnose why a metric changed or differs from expectation. Use when the task is to identify likely drivers of a metric movement, anomaly, gap, or discrepancy."
---

# Metric Diagnostics

Use this skill to diagnose why a metric changed or differs from expectation. Reproduce the metric, define the comparison, quantify the movement, validate likely drivers, and state what is verified, likely, unresolved, and useful to do next.

## Overall Instructions

- Before choosing or changing the deliverable, apply [presentation routing](../index/SKILL.md#output-and-presentation). For consequential missing details, use [task intake](../../shared/task-intake.md). Before quantitative claims, apply [analysis quality](../../shared/analysis-quality.md); resolve company-specific meaning through [metric definitions](../../shared/metric-definitions.md) before choosing the controlling source.
- Apply the [shared Data instructions](../../shared/shared-skill-instructions.md) and the shared guidance referenced below. Use instructions already loaded for this task, including by the index or another skill; read only what is missing.

## Dependencies

Before selecting evidence, apply [source selection and dependency resolution](../../shared/source-selection.md) to the categories below.

- Data Warehouse: Authoritative metric history, cohorts, and detail for reproducing and decomposing a change.
- Business Intelligence: Existing reporting views, definitions, and comparison baselines.
- Product Analytics: Behavioral changes, funnels, segments, and experiment evidence.
- Knowledge & Files: Metric methodology, source documentation, and prior investigations.
- Internal Messaging: Incident context and stakeholder hypotheses, including pointers to original measurements.
- Developer Tools: Release changes, instrumentation, and incidents that may explain a movement.

## Related Skills

Use $product-business-analysis when the task asks for a recommendation or tradeoff decision after diagnosing the movement.

Use $analyze-data-quality when dashboard trust, grain, freshness, or source disagreement could affect the metric.

## Workflow guidance

Use [task intake](../../shared/task-intake.md) for proceeding, asking while working, and waiting. The planning steps below guide the analysis; they are not a questionnaire.

## Suggest Automations

This skill may originate `suggest_automation` under the shared [automation offer contract](../../shared/automation-offers.md) only after a verified diagnostic has been delivered, when the same metric, source path, comparison, decomposition, and output will likely recur.

- Eligible: a weekly metric-movement or anomaly review with a stable definition and repeatable driver analysis.
- Ineligible: a one-off incident, open-ended exploration, unresolved source or definition dispute, or diagnostic that still lacks driver validation.
- Example: after completing `Diagnose why weekly active users changed this week`, say `I can make this WAU diagnostic repeatable with the same source checks and decomposition.` Then emit the shared generic `Make this repeatable` launcher.

## Workflow

### 1. Define The Diagnostic Question

Frame the diagnostic so it is clear what changed and what comparison would prove it.

Define:

- what the metric means in business terms
- the time window and comparison that make the change measurable
- the population and grain that determine what counts
- the source that owns the metric definition
- the diagnostic question being answered, for example movement, concentration, or reconciliation

Gather missing business context about what the metric means, what changed around the analysis period, and which explanations are plausible, following the shared [business context](../../shared/metric-definitions.md#business-context) guidance.

### 2. Validate The Metric Definition And Source

Before explaining the movement, confirm that the metric is defined correctly and that the source data can measure it reliably.

Confirm the metric definition, grain, aggregation logic, filters, joins, exclusions, freshness, lineage, and any disagreement between trusted surfaces. Keep this source check focused on issues that could change the answer.

Reuse source authority and relevant reads already verified for this task. Treat unverified context, named data-context skills, and familiar table names as source candidates, not source selection. For broad metric questions with unresolved source selection, gather the missing evidence from available tables, dashboards, metric docs, or other source-of-truth surfaces. When both are available, inspect at least one business-facing or top-line surface and one lower-level source surface; sufficient current-task reads satisfy this step without repeating discovery. Record why the selected source owns the answer in source metadata or supporting notes.

Use $analyze-data-quality when freshness, grain, joins, missingness, schema drift, outliers, unexpected categories, or distribution shifts could affect trust.

Keep SQL, Python, statistical models and decompositions inspectable under the shared [analysis-record policy](../../shared/shared-skill-instructions.md#analysis-records-and-companion-artifacts).

### 3. Establish The Metric Pattern

Before looking for drivers, establish the metric pattern the diagnostic needs to explain. Quantify the metric over the relevant period and scope. If the question includes a comparison, reproduce that comparison.

Do not search for causes until the size, timing, and scope of the pattern are verified or explicitly marked uncertain.

### 4. Choose The Diagnostic Plan

Choose the smallest set of cuts and checks likely to explain the pattern or strengthen confidence.

Choose driver dimensions from the metric's operating logic, business context, and source shape. Prioritize drivers the business usually monitors or can act on, not every field available in the source. If the relevant drivers are unclear, read [current or named context](../../shared/metric-definitions.md#business-context) to understand how the business explains the metric and what changed around the analysis period.

When using a lower-level table, do not limit the driver analysis to fields surfaced by the first query. Recreate or join the business grouping needed to answer the question, such as model family, model superfamily, segment, region, cohort, product taxonomy, or customer hierarchy. If the grouping cannot be reconstructed, say so before simplifying the analysis.

Use the explanation mode that fits the question. Common examples:

- **Metric change**: compare the focal window with a baseline, rank segment contributions, check peer or historical context, and test mix shift versus within-segment movement.
- **Spike, regression, or incident**: pin down onset, peak, recovery,
  distribution shape rather than only averages, affected slices, broad versus localized degradation, and whether traffic or failure behavior changed.
- **Largest contributors or concentration**: define "largest", rank entities,
  compare total share and change, and look for major movers, entrants, and exits.
- **Reconciliation or difference analysis**: align definitions, filters, grain,
  numerator, denominator, and exclusions; quantify the components explaining the gap and state any residual.

### 5. Decompose And Validate Drivers

Quantify the main drivers and validate whether they explain the pattern.

Apply the shared [analysis quality criteria](../../shared/analysis-quality.md) before naming a cause: an accounting decomposition is not a causal explanation. In admission-limited workflows, distinguish offered demand from admitted work.

Size each major driver with the strongest readily available evidence. Show whether it explains the pattern, how large it is relative to the relevant base, trend, or gap, whether it is broad or concentrated, and whether it holds under the right comparison or scope.

Iterate on driver hypotheses until the explanation answers why in a way that is relevant to the business. Follow promising cross-cuts and drill-downs when they could reveal the key explanation, and stop when additional cuts are unlikely to change the conclusion or materially improve confidence.

Interpret driver results in context:

- Use the relevant base, comparison, or share of total to make the driver meaningful.
- For rates, check whether the numerator, denominator, or both explain the change.
- For additive metrics, calculate contribution share when it sharpens the story.
- Separate composition effects from within-segment performance effects when that distinction changes the explanation.
- Prefer mutually exclusive driver buckets when additive contributions need to be interpreted; reconcile the decomposition exactly or size and explain the residual.

Treat measurement issues as possible explanations, not just cleanup details. For example, the pattern may come from logging changes, incomplete recent data, duplicated rows, or a shifted denominator rather than an underlying business change.

Calibrate the explanation to the evidence, and make important uncertainty visible. Use context when it changes interpretation, such as whether the pattern is ordinary, unusual, expected, or tied to a known change.

Pass chart-ready evidence to the selected response mode.

### 6. State Implications And Follow-Up

Lead with the answer to the diagnostic question, then state the practical implications when the evidence supports them.

Follow the selected presentation. In chat, use Visualize directly for a useful chart. Include inspectable sources when scope or processing materially affects the answer.

The answer should make clear:

- the pattern being explained
- the strongest driver explanation and supporting evidence
- why it matters for the business
- how much confidence to place in the explanation
- the implication, next action, or follow-up that matters most

Use $product-business-analysis when the user needs a recommendation or tradeoff decision, not just the diagnostic implication.

Keep implications distinguishable from verified factual reporting so a reader can tell where evidence ends and interpretation begins. Do not claim causality from timing alone; state when an explanation is only a plausible hypothesis.

Gather [business context](../../shared/metric-definitions.md#business-context) when the metric result is clear but interpretation or realistic next actions remain uncertain.

Before sharing, resolve material methodology, calculation, caveat, and source-support issues using those criteria, and carry any remaining uncertainty into the diagnostic conclusion.

Do not treat artifact or report validation as analytical validation. Before handing off, confirm the analysis has the headline metric movement, driver contribution shares or effect sizes, source/window reconciliation, exact executed SQL or query references when queries were used, and caveats that would change interpretation.

Return the diagnostic substance and supporting evidence using the [selected presentation](../index/SKILL.md#output-and-presentation). When that mode is `report`, pass the diagnostic question, quantified explanation, reviewed query identities and scoped evidence, and remaining uncertainty to $build-report; let it choose the report's composition.
