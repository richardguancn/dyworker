---
name: product-business-analysis
description: "Analyze product or business data to support a decision or recommendation. Use when a decision depends on metric-backed evidence, such as choosing a direction, prioritizing an opportunity, evaluating a change, segmenting users, sizing tradeoffs, or deciding what to do next."
---

# Product And Business Analysis

Use this skill to answer product or business questions with data-backed evidence, context, and a recommendation. Give the audience enough trustworthy evidence, interpretation, and uncertainty framing to choose a practical next action.

## Overall Instructions

- Before choosing or changing the deliverable, apply [presentation routing](../index/SKILL.md#output-and-presentation). For consequential missing details, use [task intake](../../shared/task-intake.md). Before quantitative claims, apply [analysis quality](../../shared/analysis-quality.md); resolve company-specific meaning through [metric definitions](../../shared/metric-definitions.md) before choosing the controlling source.
- Apply the [shared Data instructions](../../shared/shared-skill-instructions.md) and the shared guidance referenced below. Use instructions already loaded for this task, including by the index or another skill; read only what is missing.

## Dependencies

Before selecting evidence, apply [source selection and dependency resolution](../../shared/source-selection.md) to the categories below.

- Data Warehouse: Authoritative business metrics, joined records, and comparison populations.
- Business Intelligence: Governed reporting views and established metric definitions.
- Product Analytics: Funnels, retention, experiments, and behavioral segments.
- Knowledge & Files: Strategy, decision context, supplied datasets, and research.
- Internal Messaging: Operational explanations and pointers to the sources behind reported changes.
- Email: Relevant customer or stakeholder context for interpreting findings and tradeoffs.

## Related Skills

Use $metric-diagnostics when the recommendation depends on explaining a metric movement, anomaly, gap, or discrepancy.

Use [task intake](../../shared/task-intake.md) for proceeding, asking while working, and waiting. The planning steps below guide the analysis; they are not a questionnaire.

## Suggest Automations

This skill may originate `suggest_automation` under the shared [automation offer contract](../../shared/automation-offers.md) only after an evidence-backed decision review has been delivered, when the same business question, source path, analytical cuts, and output will likely recur.

- Eligible: a recurring product-health, retention, adoption, or business-performance review that ends in a decision-ready output.
- Ineligible: a one-time launch or prioritization decision, exploratory sizing work, or a recommendation still missing material evidence or validation.
- Example: after completing `Review paid workspace retention and recommend what to investigate next`, say `I can make this retention review repeatable with the same evidence checks and segment analysis.` Then emit the shared generic `Make this repeatable` launcher.

## Workflow

### 1. Start From The Decision

Identify the decision, audience, and action the analysis should inform before choosing data sources or metrics.

State plainly:

- the question and decision the analysis should inform
- who will use the answer and what they can act on
- the scope and comparison that define a useful answer
- the outcome or behavior that matters for the decision
- any assumptions needed to proceed

Do not let unclear scope turn into broad exploratory work by default.

### 2. Gather Decision-Relevant Context

Resolve relevant definitions and source guidance under the shared [Authoritative metrics and definitions](../../shared/metric-definitions.md) policy and gather missing [business context](../../shared/metric-definitions.md#business-context) before deeper analysis. Use the gathered context to shape the analysis and recommendation.

Keep the context pass proportional to the task. For self-contained prompts or cases where the user already provided enough context, the pass can be brief: confirm the decision frame, definitions, source assumptions, and any obvious gaps before moving on. Do not turn mandatory context gathering into a broad background scan.

Relevant context should clarify:

- intent: what the work was meant to accomplish and why
- definitions: how the work, metric, or source is defined and measured
- timing: what changed around the analysis period that could affect interpretation
- constraints: decisions, caveats, or limitations that affect what action is realistic

### 3. Frame The Analysis

Turn the question into a focused analytical framework.

Define a framework for answering the question with data:

- the specific data questions that would support or change the recommendation
- the comparisons and dimensions to inspect
- the unit of analysis that matches the decision
- the metric definitions and caveats needed to interpret the result

Use the framework to surface plausible hypotheses or interpretations, then turn them into focused data questions. Keep the framework specific enough to avoid broad exploration and support a recommendation.

Use $design-kpis when the success metric, driver metrics, guardrails, or measurement plan need to be defined before the analysis can proceed.

Start by defining what the answer needs to show in plain language. Then choose the data that matches that meaning as closely as possible, including who is counted and what comparison makes the number meaningful. If a field or event captures only part of what the decision cares about, say what it captures and what it leaves out.

### 4. Run Focused Quantitative Analysis

Run enough quantitative analysis to support or reject the framed hypotheses and inform the decision:

- **Follow the framework.** Run the analyses that could change the recommendation first. Track additional data questions that emerge, answer the ones that matter for the decision, and leave lower-impact cuts as follow-up instead of expanding into broad exploration.

- **Use the right comparison.** Interpret results against the relevant baseline, denominator, or comparison point before turning them into a recommendation. For example, do not conclude that one group is the best opportunity just because it has the most total usage. Check whether usage is high because the group is larger, whether the pattern still holds after normalizing by the active base, whether the group is growing or declining, whether the usage reflects the behavior or outcome that matters, and whether business context changes the interpretation.

- **Size the opportunities.** Estimate the magnitude of impact each important opportunity could have. State what is being compared, which metric represents impact, what denominator or population it uses, and whether the data is complete enough to trust. Keep material unknown or unclassified groups visible when they could change the interpretation.

- **Keep quantitative work inspectable.** Retain queries and calculations under the shared [analysis-record policy](../../shared/shared-skill-instructions.md#analysis-records-and-companion-artifacts). Use $analyze-data-quality when source freshness, grain, joins, missingness, schema drift, or unexpected distributions could affect trust.

- **Validate before concluding.** Apply the shared [analysis quality criteria](../../shared/analysis-quality.md) before sharing stakeholder-facing recommendations, high-impact claims, or surprising results. When dashboards and direct queries both exist, reconcile them or explain why they differ.

### 5. Translate Evidence Into Decision Implications

Frame the findings within the broader business context. Do not present quantitative evidence and business context as two unrelated streams.

Interpret the evidence through the decision lenses that best fit the question. Choose lenses that would actually change the recommendation, and skip ones that would add noise or false precision. Common lenses include:

- **Current scale:** Is the opportunity or problem large enough today to matter for the decision?
- **Momentum:** Is the signal growing, shrinking, accelerating, or newly emerging?
- **Breadth:** Is the pattern broad-based, or does it only appear in a narrow corner of the business?
- **Concentration:** Does the conclusion depend on a few large entities, events, or outliers?
- **Intensity:** Is the behavior deep enough per unit to suggest real need, value, or risk?
- **Efficiency:** Does the option create better output, margin, conversion, productivity, or quality for the input required?
- **Addressability:** Can the team realistically act on this option with available product, GTM, operational, policy, or technical levers?
- **Differentiation:** Does this group or use case require a distinct motion, product experience, support model, or message?
- **Substitution:** Is there evidence that behavior, spend, time, or workload could shift from another path?
- **Risk or dependency:** Are there quality, trust, compliance, technical, operational, or data constraints that change the recommendation?
- **Coverage:** Are unknown, missing, or sparsely tagged records large enough to change the answer?

Use these as thinking tools, not a checklist. Explain why the chosen lenses matter for this decision, and mention omitted cuts only when they would plausibly change the interpretation or help explain the result.

Use the measured opportunities to explain which differences matter for the decision and which ones call for different actions. If the business context shows that the initial sizing misses the actionable part of the opportunity, add the focused sizing cut needed to make the recommendation useful.

If evidence conflicts, say so directly and explain which interpretation is better supported. Do not smooth over disagreement between sources.

### 6. State The Recommendation

Return the decision-ready recommendation using the [selected presentation](../index/SKILL.md#output-and-presentation).

Follow the selected presentation. In chat, use Visualize directly for a useful chart. Include inspectable sources when scope or processing materially affects the answer.

Before handoff, make the recommendation explicit:

- what they should believe or do next
- why the evidence supports that recommendation
- which caveats or dependencies matter
- what follow-up analysis would most improve confidence

If evidence is incomplete, label the recommendation as provisional and state what would change confidence. Do not overstate the conclusion just to make the answer feel decisive.

Before sharing, resolve material methodology, calculation, caveat, and source-support issues using those criteria, and carry any remaining uncertainty into the conclusion.

When `report` is selected, pass the analytical question and narrative ingredients to $build-report, not only result tables:

- direct answer and recommendation
- reviewed query identities, scoped evidence, and how to interpret it
- implication for the decision
- unresolved uncertainty and caveats
- recommended follow-up when useful

Let $build-report choose how to present these ingredients; they are not mandatory section names or an outline.
