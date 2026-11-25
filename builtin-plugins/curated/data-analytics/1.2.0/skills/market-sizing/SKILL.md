---
name: market-sizing
description: "Estimate market, segment, or opportunity size with transparent assumptions and uncertainty. Use for TAM/SAM/SOM, sizing scenarios, or comparing the scale of possible opportunities."
---

# Market Sizing

Use this skill to produce a defensible estimate of a market or opportunity from connected context, public sources, transparent assumptions, and auditable calculations. The job is to define the market, choose a sound sizing method, distinguish evidence from assumptions, test sensitivity, and state what would most improve confidence.

## Overall Instructions

- Before choosing or changing the deliverable, apply [presentation routing](../index/SKILL.md#output-and-presentation). For consequential missing details, use [task intake](../../shared/task-intake.md). Before quantitative claims, apply [analysis quality](../../shared/analysis-quality.md); resolve company-specific meaning through [metric definitions](../../shared/metric-definitions.md) before choosing the controlling source.
- Apply the [shared Data instructions](../../shared/shared-skill-instructions.md) and the shared guidance referenced below. Use instructions already loaded for this task, including by the index or another skill; read only what is missing.

## Dependencies

Before selecting evidence, apply [source selection and dependency resolution](../../shared/source-selection.md) to the categories below.

- Knowledge & Files: Market research, source publications, assumptions, and supplied sizing models.
- Data Warehouse: Company-specific customer, revenue, adoption, and segment inputs.
- Business Intelligence: Governed segment reports and existing market or business benchmarks.
- Product Analytics: Usage and adoption evidence for estimating reachable segments and opportunity.

## Related Skills

Pass chart-ready evidence to the selected response mode.

Use [task intake](../../shared/task-intake.md) for proceeding, asking while working, and waiting. The planning steps below guide the analysis; they are not a questionnaire.

## Workflow

### 1. Frame The Market Or Opportunity

Define the market or opportunity boundary before estimating:

- What is being sized, for example a product category, workflow, problem, use case, or category of activity.
- Where and when it applies, for example geography, segment scope, time horizon, or market maturity.
- Who or what counts as part of the market, for example the relevant population, unit of demand, transaction type, or included activity.
- How the opportunity is measured, for example spend, revenue, volume, value created, or another unit that fits the question.
- What kind of sizing answer the user needs, for example TAM/SAM/SOM, market entry, expansion upside, spend pool, revenue pool, population count, or unit volume.

### 2. Choose A Starting Sizing Approach And Inputs

Pick the simplest sound sizing approach for the question, then sketch the calculation chain and the major inputs the estimate will depend on.

A top-down model works when reliable aggregate market data exists; a bottom-up model works when the market can be built from observable units and assumptions; a value-based model works when the estimate should start from the value created rather than a published market total. Use a mixed approach only when cross-checking would materially improve confidence. If more than one approach fits, briefly explain which one you trust most and why.

Expect the first approach to change if source checks show that another model would be more defensible.

### 3. Gather Sources For The Inputs

Choose sources based on the inputs the estimate depends on most.

Start with user-named sources when provided. Then use the strongest available evidence for each major input from the starting approach. Use `~~structured_data` when an input should come from the user's data warehouse or another structured data source. Use context lanes such as `~~company_docs`, `~~team_communication`, or `~~dashboards_or_bi` when an input needs business meaning, source-of-truth guidance, or assumptions that are not captured in structured data alone. When an input depends on the outside market, use public sources for benchmarks, population estimates, comparable markets, or proxy assumptions.

When the right source of truth, business meaning, or assumption set is unclear, follow the shared [Authoritative metrics and definitions](../../shared/metric-definitions.md) and [business context](../../shared/metric-definitions.md#business-context) guidance.

If the strongest source is unavailable or thin, continue with a transparent proxy assumption only when the estimate is still useful. Label the gap and explain how it affects confidence.

### 4. Separate Facts From Assumptions

Keep sourced facts, inferred estimates, and judgment calls distinct in the model. When exact data is unavailable, use a defensible proxy, explain why it is reasonable, and note the confidence level. Ground assumptions in evidence about how the market actually behaves, what can realistically change, and what determines the size of the opportunity.

### 5. Build The Model

Make the model easy to inspect and adjust.

The model should make these elements easy to audit or revise:

- market definition and measurement unit
- assumptions and source context
- calculation chain and derived values
- base case, material ranges, and sensitivity logic
- validation priorities

For each major input, make the source path visible: structured data, context lane, public source, user-provided input, or proxy assumption.

Keep derived values traceable to formulas or code rather than hardcoded outputs.

Keep formulas, inputs, intermediate calculations and sensitivity logic inspectable under the shared [analysis-record policy](../../shared/shared-skill-instructions.md#analysis-records-and-companion-artifacts).

Use the `$Spreadsheets` skill when the user requests a spreadsheet, workbook or Google Sheets deliverable.

### 6. Test Sensitivity

Identify the assumptions that move the estimate most.

Show how the estimate changes when those assumptions move up or down. Prefer simple, decision-useful sensitivity analysis over exhaustive scenario sprawl.

Use ranges when uncertainty is material. Do not hide uncertainty behind a single point estimate when the inputs are thin.

Test a downside that could change the recommendation. For pricing or migration, incremental revenue may be negative: separate the signed change from the existing price, additional spend, and displaced revenue instead of forcing every monetary input or output to be nonnegative. Keep displaced revenue as a subtraction even when the price change is negative. If the evidence raises discounting or cannibalization, carry that possibility through the model, control bounds and chart axes; a low but still profitable preset does not test a loss scenario. Label the assumptions and check that downside, zero population and reset agree across the report and tool.

### 7. State The Estimate And Validation Priorities

Return the estimate, method, key assumptions, uncertainty, and next validation priorities using the [selected presentation](../index/SKILL.md#output-and-presentation).

Follow the selected presentation. In chat, use Visualize directly for a useful chart. Include inspectable sources when scope or processing materially affects the answer.

Before handoff, make the market-sizing conclusion explicit:

- market definition and measurement unit
- estimate or range
- method and calculation chain
- key assumptions and source support
- main uncertainty drivers and sensitivity takeaways
- validation priorities and practical interpretation for the user's decision

If source coverage is thin, say which major inputs rely on proxy assumptions and what source would most improve them.

Before sharing, apply the shared [analysis quality criteria](../../shared/analysis-quality.md) to methodology, calculations, assumptions, caveats, and source support within this workflow.

Pass sensitivity, scenario, funnel, or market-breakdown visual intent and supporting evidence to the selected response mode.
