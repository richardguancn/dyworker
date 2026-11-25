---
name: build-report
description: "Build polished analytical reports for executive, product, business, or technical audiences. Use when the task needs a durable narrative answer supported by inspectable evidence."
---

# Build a report

Use this skill when the user requests a report or [presentation routing](../index/SKILL.md#output-and-presentation) selects a report. Explicit output choices take precedence. With no explicit format, three or more independent analytical questions need an inline summary plus a report; otherwise answer inline. Deliver the selected report the reader can open, with a short answer and a link in chat. Keep a report's evidence and charts in the report unless the chat answer also needs its own visual.

## Read together

Choose the destination once: explicit request first, then the selected template's format, then the existing artifact's format and identity. A selected presentation template produces a presentation. For a new report with no selected format, default to a private personal Page when creation is supported and authorized; otherwise use HTML and explain why. Explicit HTML goes straight to the report starter.

For a standalone HTML or hosted HTML report, continue directly with the [HTML report workflow](../../output_formats/html/report.md). That workflow owns the report's writing, composition, evidence, preparation and verification. Stop reading this skill here for HTML; the report principles and rendering instructions below apply to the other destinations.

Open the applicable files together, reusing any already read:

| For this request | Read in the same batch |
| --- | --- |
| Report from reviewed files or query results | [Analysis quality](../../shared/analysis-quality.md), [Data writing](../../shared/data-writing.md), and **one** execution guide: [HTML report](../../output_formats/html/report.md) or [Page report](../../output_formats/space_page/report.md), or the explicitly requested format below. |
| Investigate a change or its cause | Add [investigative reports](docs/investigative-report.md). If analysis remains to be done, use the appropriate analytical skill, such as [metric diagnostics](../metric-diagnostics/SKILL.md). |
| Selected template or existing report | Include the selected template or current artifact source and [template contract](../../shared/output-and-template-handling.md#template-handling). |
| Need to choose or implement a chart | For a [native Page chart](../visualize-data/docs/rendering/page-chart-fragment.md), follow the installed Visualize workflow. For an HTML report, use [Data’s React bindings](../visualize-data/docs/react/app-charts.md). For exports, use the requested format’s native figures. |

For missing evidence use [source selection](../../shared/source-selection.md); for a disputed company metric use [metric definitions](../../shared/metric-definitions.md). A complete supplied packet needs neither discovery pass. Consult [task intake](../../shared/task-intake.md) only when missing information would materially change the work. Use the [destination policy](../../shared/output-and-template-handling.md#output-format-selection) for a conflict, conversion or unavailable explicit format.

## Report content

Identify the reader's question, decision, period, baseline and population from the request and evidence. Keep the selected sample's identity and definitions; label synthetic data. Work from reviewed results, preserving source identity and calculation. When revising, reuse the existing evidence and analysis unless the requested change calls them into question.

### Report principles

1. **Executive Summary.** For a report with several findings, comparisons or visuals, put a visible **Executive Summary** immediately after the title and compact byline. It should stand on its own: answer the reader's question directly, state why it matters, and connect the strongest findings to their decisive numbers or comparisons and implications. Usually use 2–4 concise takeaways or short paragraphs, starting with the main finding or decision. Include a recommendation when useful and qualify a claim where uncertainty changes the answer. These are connected prose, not separate mandatory Question, Answer, Recommendation, Data and Caveats labels or a quota. Do not duplicate the summary in a subtitle, unlabeled lede, KPI strip or nearby restatement; the body expands the story with evidence. A short, one-answer report can open more briefly. An explicit template controls its headings, order, prose or list format, and styling; apply the default opening only when the template leaves it unspecified. See the [synthetic worked example](docs/specifications/executive-report.md#synthetic-worked-example).
2. **Title and findings.** Name the concrete subject or strongest supported finding, such as the API launch being assessed. Preserve a requested title. If the reader's question is implicit, put it in a short opening sentence or subtitle before the summary. Keep the preparation date and known author in a compact byline; put the evidence period and cutoff with the findings or Sources. Use headings that state what the evidence supports. Develop the findings, with recommendations and caveats where they help the reader; include only sections that contribute to the question. Lead with concise methodological context only when the method itself is the question or a methodological caveat changes the answer. Otherwise keep dense methodology, source, freshness, provenance and reproducibility details in Sources, a later methods section or progressive disclosure.
3. **Comparison and interpretation.** Check metric definitions, units, periods, grain, counts and denominators. Pool counts before computing rates. Reconcile group contributions with the overall change; distinguish changes within groups from changes in their mix. For a funnel, follow the [same eligible cohort through its ordered stages](../visualize-data/docs/charts/funnel.md#conversion-cohorts) and identify the transition that changed most. For a why question, test plausible explanations with numbers; distinguish what was measured, what it supports, and what remains unknown. Missing is not zero, and association alone does not establish cause.
4. **Evidence in the body.** Place a useful chart beside the finding it supports: the decision metric, relevant populations, periods, units, denominators and nearby numbered source. Keep different units in separate panels. Show weights behind pooled comparisons, or uncertainty and a decision threshold when material. Use a table for exact lookup, denominators, segments or actions when it adds information. An explicit text-only or table-only request controls. Keep useful detail when shortening; move secondary evidence and qualifications to an appendix instead of dropping them.
5. **Sources.** Number sources in order of first use. Cite the first material claim in a group of related findings. That citation covers nearby prose, bullets, and arithmetic from the same evidence. Cite again when the source, population, or period changes, or when a later section needs its own link to stand alone. Put the population, period and unit where readers need them; keep detailed data, calculations, queries and reproducibility information in sources. The Page starter includes their native structure; use [Sources](docs/report-sources.md) for HTML source detail. Keep each chart or table connected to its source. Never substitute invented records, formulas, owners, targets or recommendations. Keep evidence limitations separate from delivery status.

### Choose useful next steps

Include a recommendation when the evidence supports a real decision. A proposed test should say what comparison, outcome or guardrail would distinguish the explanations. Put decision-directed work in the report; offer optional changes to the report in chat. Omit an action when neither result would change a useful choice. Use an existing issue or supported report task link where appropriate. Opening a task is not execution; changing or sharing an artifact requires the user's authority.

## Rendering

### HTML or Sites

Follow the [HTML report guide](../../output_formats/html/report.md): prepare the reviewed snapshot, edit the returned body, then run the finish command to check, export and reopen the HTML at desktop and phone widths. The starter supplies narrative components, chart bindings, citations and source controls. Deliver the returned artifact through the selected local or Sites path. Revise existing sites from their saved source and pinned chart assets.

### Page

Use the [Page report starter](../../output_formats/space_page/report.md) for the native body, private destination, source children and citation links. Use native blocks for the narrative and [a Visualize chart embedded directly in the Page](../visualize-data/docs/rendering/page-chart-fragment.md) in the report and its source Page, with a source link beneath the report chart. Check the saved content and references, then open the main Page and deliver. Assume standard components render; routine authoring does not wait for browser checks. Follow the Page guide for custom charts, requested visual review or reported failures.

### Other explicit formats

For Markdown, save a real `.md` file. Keep reviewed chart images beside it and use relative image links; read back the file and links. For a new document, presentation or other explicit format, use its authoring workflow directly. To convert an existing report, use [document](../convert-to-doc/SKILL.md), [slides](../convert-to-slides/SKILL.md) or [PDF](../report-to-pdf/SKILL.md) as requested. Preserve the findings, sources, chosen template and saved identity. If an explicit destination cannot be used, retain the draft and name the blocker before substituting a different format.

### Refresh an existing report

Edit the same artifact in place and preserve unrelated content, edits, sharing and source context. Reconcile affected evidence, calculations and period labels; set the evidence cutoff only from supported data. Use the [Page revision workflow](docs/spaces-report.md#revise-and-refresh) or [HTML refresh workflow](../../output_formats/html/docs/refresh.md#refresh-a-published-dashboard-or-report). Use [scheduling](../schedule-refresh-jobs/SKILL.md) for an actual recurring refresh request.

## Verify and hand off

### Report completion and uncertainty

Show the selected surface's progress state while work is underway; remove it upon completion. An unresolved cause belongs in confidence and caveats. For genuinely unfinished work, say what is missing. Check the final title, Executive Summary, chart and table values, their populations and sources, and any recommendation against the same current evidence. Inspect changed material and the actual output, including the selected template's opening, layout and section order. Recheck only the affected content and interactions after an edit.

Before the final response, request [rendered native opening](../../shared/output-and-template-handling.md#opening-and-report-handoff) of the finished standalone HTML or Page report when available; return to the main report after inspecting a source. In chat, answer briefly with the decisive comparison, link the verified artifact using the [host's link guidance](../../shared/shared-skill-instructions.md#links-in-the-conversation), and give a material caveat or useful next step when warranted. A screenshot, QA preview or chat summary does not complete a requested report.

If the user asks to share a summary of the report, use the [sharing workflow](../share-artifact-summary/SKILL.md).
