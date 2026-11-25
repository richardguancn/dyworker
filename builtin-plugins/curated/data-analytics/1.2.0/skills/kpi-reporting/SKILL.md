---
name: kpi-reporting
description: "Prepare KPI readouts, scorecards, WBR/MBR/QBR updates, and executive summaries from quantitative business or product metrics; use when the task is to report status, compare against targets, explain validated drivers, and state operating implications."
---

# KPI Reporting

Use this skill to turn business or product metrics into decision-ready operating readouts for leaders and teams. The job is to define the KPI contract, report status against the right comparison and target, include validated driver context, and state the operating implication clearly.

## Overall Instructions

- Before choosing or changing the deliverable, apply [presentation routing](../index/SKILL.md#output-and-presentation). For consequential missing details, use [task intake](../../shared/task-intake.md). Before quantitative claims, apply [analysis quality](../../shared/analysis-quality.md); resolve company-specific meaning through [metric definitions](../../shared/metric-definitions.md) before choosing the controlling source.
- Apply the [shared Data instructions](../../shared/shared-skill-instructions.md) and the shared guidance referenced below. Use instructions already loaded for this task, including by the index or another skill; read only what is missing.

## Dependencies

Before selecting evidence, apply [source selection and dependency resolution](../../shared/source-selection.md) to the categories below.

- Data Warehouse: Authoritative actuals, denominators, and period or segment comparisons.
- Business Intelligence: Standard scorecards, governed reporting views, and metric definitions.
- Product Analytics: Product usage, funnel, retention, and experiment measures.
- Knowledge & Files: Targets, ownership, supplied records, and operating plans.
- Internal Messaging: Initiative commentary, operational changes, and links to supporting evidence.

## Workflow guidance

Use [task intake](../../shared/task-intake.md) for proceeding, asking while working, and waiting. The planning steps below guide the analysis; they are not a questionnaire.

This skill owns the KPI readout: what should be reported, how metrics should be interpreted, whether driver context is validated, and what operating takeaway follows. It does not own metric-system design, new driver investigation, or final artifact polish.

Use $metric-diagnostics when the readout needs fresh driver investigation, then return here to package the validated finding.

## Suggest Automations

This skill may originate `suggest_automation` under the shared [automation offer contract](../../shared/automation-offers.md) only after a validated KPI readout has been delivered, when the same KPI contract, source path, comparison, driver review, and output will likely recur.

- Eligible: a weekly ARR, WBR, MBR, or QBR readout that was analyzed, explained, and delivered.
- Ineligible: a one-time value or status lookup, a template or mockup, or a readout still missing actuals, definitions, validation, or delivery.
- Example: after completing `Analyze ChatGPT ARR week over week and explain why it changed`, say `I can make this ARR readout repeatable with the same source checks and driver review.` Then emit the shared generic `Make this repeatable` launcher.

## Workflow

### 1. Establish The Readout Purpose

Understand who the readout is for, what conversation it supports, and what is being reported before drafting. Anchor the update in the period being evaluated, the comparison or target that makes performance interpretable, and the freshness cutoff.

Recover this context from the request, prior reporting, and available sources. For an unspecified reporting period, use the latest complete period in the supplied data unless context indicates otherwise; state the choice. Do not ask about routine readout preferences.

### 2. Define The Metric Framework

Decide which metrics belong in the readout and what role each one plays before pulling numbers. If the framework already exists, verify it against the available context and use it. If it is missing or weak, use $design-kpis before reporting.

Start with the primary KPI, then add the smallest set of supporting metrics needed to explain status. Supporting metrics can explain movement, guard against harmful tradeoffs, or show whether performance is pacing as expected.

Lead with the metric that matters most to the audience. Do not add every available cut or comparison; include the metrics and slices decision-makers actually use, plus any that materially explain this update.

When the primary KPI is top-line, composite, or otherwise not directly actionable, define its driver decomposition before interpreting it. Use an existing metric tree when available. Otherwise identify the smallest useful set of component drivers, such as numerator and denominator, volume and rate, mix, funnel stages, segments, cohorts, or operational inputs. Do not invent a causal hierarchy when source definitions do not support one.

### 3. Lock Metric Definitions And Sources

Establish the KPI definition, source, time window, reporting cutoff, comparison period, and any target or pacing expectation from available evidence before interpreting performance. Never invent an authoritative target or pacing basis. Ask only if the missing basis is essential to the requested conclusion and cannot be recovered; otherwise report supported comparisons and the limitation. Use $analyze-data-quality when source quality issues could change the reported metrics.

Start with supplied data or the fewest authoritative sources needed for actuals, definitions, and comparison periods. Expand to business context or other sources for material gaps or conflicts, not to cover every source lane. Do not infer from a sparse prompt that source-backed actuals are unavailable.

If a core definition remains ambiguous after bounded source checks and would change the requested conclusion, ask the critical question before making dependent precise claims. When a metric definition changed, show comparable restated history when available; otherwise call out the break clearly.

### 4. Pull The Topline Actuals

Do not draft or render a WBR, MBR, scorecard, or KPI update from placeholders. Read core actuals from supplied or authoritative connected data first. If actuals are blocked or insufficient, say what source or access is needed unless the user explicitly asked for a template or mockup. For report or dashboard mode, show a useful reviewed-actuals view through the selected build workflow, then continue the requested driver and context analysis in that same Page or app. Report destination and rendering follow $build-report. Do not present unfinished analysis as complete.

Reproduce the topline actual before explaining movement or driver context.

For each headline KPI, include the current value, the absolute and relative change versus the comparison period, and a short interpretation.

Call out anything that makes the current value hard to compare with the prior period before interpreting the movement, such as a tracking change, data backfill, partial outage, or missing day.

### 5. Put The Numbers In Context

Compare actuals against the context that makes performance interpretable. When a target, plan, pacing model, benchmark, historical range, or relevant peer group is defined, identify it and compare performance against it before judging status.

If the goal has a deadline, show whether it is on pace to hit the target by the end of the period. Use the provided pacing definition when available. If none is defined or found, use a defensible calculated fallback when possible, label it as calculated, and explain the method. Ask only if an unresolved business rule is essential to judge pacing correctly; otherwise state the limitation without blocking the supported readout.

When useful, include absolute and percent variance to target and a red/yellow/green status. Make clear what comparison or pacing basis the status label uses.

### 6. Explain Validated Drivers

KPI updates need driver context, but driver claims must be validated before they are presented as explanations. A plausible story is not enough.

When the readout needs to explain drivers, use $metric-diagnostics to identify and validate them. If trusted reporting or prior analysis already validates the drivers, use that evidence instead of re-running the diagnostic.

### 7. Add Business Context And Operating Implications

After identifying the likely drivers, gather [business context](../../shared/metric-definitions.md#business-context) that helps explain what happened and what it means for the readout. Let the driver analysis guide what context to look for, and connect context to the metric only when evidence supports the link.

Translate the evidence, driver analysis, and business context into the operating implication for the business. State whether the movement is concerning and what next step or action is warranted. When a supported plan and pacing basis exist, assess whether the main KPI is on track, at risk, or ahead of plan; otherwise give supported historical comparisons without inventing a plan status. Recommend action only when the evidence supports it; otherwise name the next validation step.

### 8. Validate The Readout

After the analysis is assembled and before shaping the final readout, apply the shared [analysis quality criteria](../../shared/analysis-quality.md) to check whether the numbers, methodology, caveats, and evidence support the claimed status, drivers, and implications. Resolve material issues before sharing; carry remaining limitations into the readout.

### 9. Deliver The Readout

Return the validated KPI readout using the [selected presentation](../index/SKILL.md#output-and-presentation).

Follow the selected presentation. In chat, use Visualize directly for a useful chart. Include inspectable sources when scope or processing materially affects the answer.

Before handoff, make the readout explicit:

- headline status and operating implication
- actuals and supported comparison periods, with targets and pacing basis when available
- validated drivers and unresolved uncertainty
- audience, cadence, and requested delivery surface when known
- chart-ready evidence for the selected response mode

When `report` is selected, pass the actual question, reviewed query identities and scoped KPI evidence, material caveats, and known audience or cadence to $build-report as they become available. Use `references/report-templates.md` when an established recurring format helps; its examples are not a required report outline. Let $build-report own the destination, composition, and rendering, with `$visualize-data` guidance when needed. Inline charts or Sources use [inline component delivery](../visualize-data/SKILL.md); ordinary prose and Markdown tables need no delivery skill.

For explicit document, deck, or PDF requests, follow $build-report's format and export policy using the validated KPI analysis. It routes evidence or an existing Page to the requested format's authoring plugin and preserves the existing conversion workflow for HTML/Sites apps. If multiple formats are requested, reuse the reviewed data, findings, and source evidence across outputs.

## Standards

### Metric Standards

- Never present a KPI as precise when its definition, source, time window, or comparison basis is unclear.
- Make calculation logic, inclusion or exclusion rules, grain, and time treatment explicit when they affect interpretation.
- Reconcile totals and compare against prior reporting when possible.
- Do not compare periods, cuts, or targets that are not definitionally compatible. Call out definition changes, backfills, denominator shifts, or calendar effects when they affect the movement.

### Status And Pacing Standards

- Include the headline takeaway, current actual, relevant comparison, target or pacing context, driver summary, and implication unless the user asks for a narrower readout.
- Put actuals next to the target, plan, benchmark, or baseline when available so the reader can judge performance immediately.
- If a target is time-bound, show whether current performance is on pace using the provided pacing definition or a clearly stated calculated fallback.
- Keep recurring metric sections consistent across runs. If a requested section is missing because data, definitions, or validation are unavailable, explain the omission briefly.
- Use traffic-signal status only when it helps prioritize action. Pair color with text and state the basis for the status.
- Round numbers consistently, label units, and surface caveats when they change interpretation.

### Driver Standards

- Quantify drivers whenever the evidence supports it; do not use descriptive prose as a substitute for sizing the effect.
- Report the few drivers, contributors, or known non-drivers that matter for interpreting the KPI movement.
- For top-line KPI movement, structure validated drivers as a compact decomposition: top-line actual, component drivers, largest contributors or non-drivers, and residual or unresolved movement. Use an additive bridge only when the components reconcile cleanly; otherwise explain the relationship and uncertainty.
- Separate validated drivers from business context or hypotheses.
- Do not elevate business events into causes unless the timing, affected population, and measured change support the link.
- State whether the movement is broad-based or concentrated when that changes the operating implication.
- If driver evidence remains unresolved, name the uncertainty or diagnostic follow-up instead of inventing an explanation.

### Presentation Standards

- Write for executives and operators who skim: lead with the answer, then the evidence.
- Use business-readable numbers and compact formats such as `123k (+8% w/w, +19% m/m)`.
- Replace generic adjectives like `strong`, `healthy`, or `soft` with the metric evidence that justifies them.
- Keep caveats close to the claim they affect, and omit caveats that do not change interpretation.
- Follow the selected response mode's visual requirements.
