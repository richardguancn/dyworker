---
name: style-guide-adapter
description: adapt ib materials to a firm, client, or precedent style guide. use when the user asks to apply tone, format, naming, wording, or presentation conventions. do not use to create analysis or verify numbers.
---

# Style Guide Adapter

> Internal support playbook. Load through `internal-support/policy.md`; this style capability is bundled with the visible router rather than exposed as a skill entrypoint.

## Deliverable Intake

When this skill owns a new substantive user-facing artifact, before source gathering, analysis, modeling, or rendering load `../../../../references/deliverable-intake-policy.md` and perform its adaptive `request_user_input` preflight for materially unresolved preferences. When invoked as a downstream support step within an already scoped workflow, inherit resolved preferences and do not re-prompt.
## Plugin Workflow Routing

For broad transaction workflow prompts, read `../../../../references/plugin-routing-playbook.md` before selecting or sequencing skills. Use this skill as lead only in the workflows named there; when acting as support, preserve validated handoff fields, source IDs, routing metadata, and the artifact hierarchy so the hero deliverable remains the banker-facing workbook, HTML report/dashboard, native deck/document, or clear first-read package.

## Artifact Hierarchy

Follow `../../../../references/artifact-manifest-standard.md` before returning generated files. The hero deliverable must be a workbook, HTML report/dashboard, native deck/document, generated folder first-read file, or justified chat-only answer. CSV, JSON, Markdown, run logs, manifests, and handoff payloads are support artifacts unless the user explicitly asks for them. Final responses should lead with the hero deliverable, then companion deliverables, then support artifacts in one short sentence if useful.

## Overview

Adapt finance artifacts to the target institution's visual, structural, and writing style using explicit style sources first and inferred precedent patterns second. Treat style adaptation as non-destructive by default: preserve facts, numbers, formulas, citations, and source links unless the user explicitly asks to change them.

This is a shared-core skill. It can be used on its own or composed with builder/QC skills such as `pitch-deck-builder`, `comps-valuation`, `dcf-model-builder`, `memo-builder`, `ib-deck-qc`, `financial-source-of-truth`, and spreadsheet/modeling skills.

## Core decision tree

1. **Identify the artifact and mode**
   - **extract style**: build a style profile from precedents, templates, examples, or instructions.
   - **apply style**: restyle an existing deck, memo, report, spreadsheet, model, or draft.
   - **create in style**: produce a new artifact using the target style profile.
   - **style QC**: compare an artifact against a target style and list fixes.
2. **Gather style sources** using the hierarchy below. If sources are missing, proceed with a conservative finance-default style and list what would improve fidelity.
3. **Build a style profile** covering visual system, layout grammar, writing voice, exhibit conventions, citation/footnote norms, and artifact-specific rules.
4. **Apply only style-safe changes by default.** Do not delete, overwrite, or materially change content, data, formulas, source links, speaker notes, hidden sheets, comments, tracked changes, or version history unless explicitly requested.
5. **Run style QC** and provide a change log, unresolved ambiguities, and confidence level.

## Source hierarchy

Use the highest-quality applicable source. For any content, number, market data, or factual claim, delegate to `financial-source-of-truth` rules rather than treating style precedents as factual evidence.
For detailed source and non-deletion rules, use [references/source-and-safety.md](references/source-and-safety.md).

1. **User's explicit instructions in the current task**.
2. **Official style guide / brand book / writing guide / compliance template** supplied by the user or available in connected apps.
3. **Approved template or master file**: PowerPoint template, Word template, spreadsheet template, memo shell, model shell, or institutional boilerplate.
4. **Current artifact being edited**: existing master slides, named styles, workbook themes, defined names, chart templates, footnote patterns, and repeated internal conventions.
5. **Final / sent / approved precedents** from the same institution, client, team, deal type, committee, or publication series.
6. **Draft or adjacent precedents** from the same institution or similar artifact type.
7. **User-provided description of desired style**.
8. **Public website / brand materials / web search** only when no private style source exists or the user asks for public-brand matching.
9. **Generic institutional finance conventions** only as a fallback.

Resolve conflicts as follows: explicit user instruction beats all; official guide beats precedent; current client style beats generic firm style; final approved precedents beat drafts; repeated patterns beat one-off quirks; recent examples beat stale examples when they are equally authoritative.

## Stale-style and conflict checks

Before applying a style, check whether sources are likely current:

- Prefer files named or labeled current, latest, final, approved, sent, board-ready, client-ready, vfinal, or template.
- Treat files named draft, old, archive, deprecated, backup, prior-year, or sample as lower-confidence unless the user says otherwise.
- Use document content, metadata, and user context to assess freshness; do not rely only on file modified date.
- If two sources conflict materially, state the conflict and use the highest-priority source. Do not blend incompatible styles unless asked.
- If only one weak sample exists, label extracted rules as inferred, not definitive.

## Fact, assumption, and inference labeling

Use these labels in summaries, change logs, and style profiles when relevant:

- **style fact**: directly observed from a guide, template, or repeated precedent pattern.
- **style inference**: inferred from limited examples or repeated but undocumented behavior.
- **style assumption**: chosen because no style source was available.
- **content fact**: sourced number, quote, date, metric, or claim.
- **content assumption**: unsourced or user-supplied assumption used in the artifact.

Do not label everything. Label only rules or assumptions that affect meaningful style, compliance, or interpretation.

## Style profile structure

Create or update a style profile before applying changes. Use the detailed extraction guidance in [references/style-extraction-playbook.md](references/style-extraction-playbook.md). Include only fields that are supported by sources or useful for the task.

Minimum style profile:

- **source basis**: files, links, pages/slides/tabs, or user instructions used; source priority and confidence.
- **visual system**: colors, fonts, typography hierarchy, spacing, grid, margins, logo/branding, icons, imagery, and accessibility constraints.
- **layout grammar**: title style, subtitle/kicker style, page/slide structure, section dividers, exhibit placement, chart/table positioning, callout boxes, footers, page numbers, confidential labels, and appendix conventions.
- **exhibit conventions**: chart types, table style, unit placement, decimal precision, period labeling, currency conventions, negative numbers, variance colors, footnote/source placement, and annotation density.
- **writing voice**: sentence length, tone, level of assertiveness, headline style, so-what structure, bullet grammar, tense, jargon tolerance, and caveat style.
- **artifact-specific rules**: deck, memo, spreadsheet/model, research note, IC memo, credit memo, or board-pack requirements.
- **do-not-change rules**: content, data, formulas, citations, hidden tabs, notes, comments, tracked changes, source links, or legal/compliance language that must remain intact.

## Structured Handoff Packages

When another Investment Banking skill consumes style context, export structured packages using `../../../../references/handoff-contracts.md`:

- `style_profile_package` follows `style_guide_adapter_style_profile`.
- `style_change_log_package` follows `style_guide_adapter_change_log`.

Always include `visual_review_status`, `data_formula_source_integrity_status`, `non_client_ready_reasons`, `downstream_qc_required`, and `circulation_caveats` when applicable. Style provenance supports style choices only; it must not become evidence for business facts, metrics, valuation, covenant conclusions, or recommendations.

## Non-destructive editing rules

- Work on a copy unless the environment provides explicit safe edit/versioning behavior.
- Preserve all formulas, linked data, named ranges, cell comments, hidden sheets, footnotes, citations, speaker notes, alt text, tracked changes, embedded objects, and source URLs unless explicitly asked to modify them.
- Do not delete slides, sections, rows, columns, sheets, notes, comments, exhibits, citations, or appendix content unless the user explicitly asks.
- Do not overwrite firm/client templates, masters, or original precedents. Use them as references or create a derived copy.
- Keep the same factual content unless asked to rewrite. When tightening language, preserve meaning and mark substantive edits separately from style edits.
- If a requested style change would reduce readability, accessibility, auditability, or factual clarity, flag the tradeoff and apply the safer variant.

## Artifact-specific routing

Use artifact-specific tools/skills where appropriate:

- **PowerPoint / slides**: preserve master slides, layout IDs, notes, charts, embedded Excel links, footers, logos, and page numbers. Prefer native theme/layout changes over manual per-shape hacks when possible. See [references/artifact-application-rules.md](references/artifact-application-rules.md).
- **Word / memos / reports**: preserve styles, headings, bookmarks, comments, tracked changes, footnotes/endnotes, citations, tables of contents, and cross-references.
- **Excel / Sheets / models**: preserve formulas, formats tied to model semantics, named ranges, validations, comments, hidden tabs, grouping, and source tabs. Never hardcode formulas or paste values over formulas for style reasons.
- **Text-only outputs**: adapt voice, structure, headings, bullets, caveats, and source presentation without inventing visual styling.

For uploaded Office files, optionally run `scripts/extract_office_style.py` to extract theme colors, fonts, style names, slide counts, and workbook/document style metadata before deeper visual review.

## Applying writing style

When the task involves prose, use [references/writing-style-adaptation.md](references/writing-style-adaptation.md). Preserve meaning and evidence posture.

Common finance writing defaults when no stronger style is available:

- Use title headlines with a clear so-what, not generic labels.
- Lead with the implication, then supporting data.
- Prefer concise bullets and parallel structure.
- Use active voice and avoid marketing adjectives unless the source language uses them.
- Separate facts, assumptions, management claims, and analyst judgment.
- Keep caveats crisp and decision-useful.

## Output requirements

Choose the format that matches the user request. For complete templates, use [references/output-templates.md](references/output-templates.md).

Always provide, at minimum:

1. **What was used**: style sources and confidence.
2. **What changed**: concise change log separating visual/layout edits from writing/content edits.
3. **What was preserved**: data, formulas, citations, source links, notes, comments, hidden sheets, or other sensitive elements.
4. **Open issues**: missing sources, conflicts, stale-style concerns, or style assumptions.
5. **Next best input** if fidelity is limited: template, final approved example, brand guide, master deck, memo precedent, or client-specific sample.

If delivering an edited artifact, also provide the output file and a short QA summary. If only advising, provide a style profile, recommended edits, and sample before/after transformations.

## Quality bar

Before finalizing, verify:

- Style choices are traceable to the selected source hierarchy.
- The artifact still says the same thing unless substantive edits were requested.
- Numbers, signs, units, footnotes, formulas, and source citations were not altered accidentally.
- The output is internally consistent across pages/slides/tabs: titles, fonts, colors, spacing, chart/table treatment, footers, and source lines.
- Style assumptions are visible and reasonable.
- The result looks/sounds like the target institution without copying confidential text beyond what the user supplied or has access to.
## Validated Handoffs

<!-- GENERATED: validated-handoffs START -->

Producer contracts:
- `style_guide_adapter_style_profile` -> `downstream drafting/QC skills`. Schema: `../../schemas/style_guide_adapter_style_profile.schema.json`. Validate with `../../scripts/validate_handoff_payload.py style_guide_adapter_style_profile handoffs/style_guide_adapter_style_profile.json` before another skill imports it.
- `style_guide_adapter_change_log` -> `downstream drafting/QC skills`. Schema: `../../schemas/style_guide_adapter_change_log.schema.json`. Validate with `../../scripts/validate_handoff_payload.py style_guide_adapter_change_log handoffs/style_guide_adapter_change_log.json` before another skill imports it.

Use `../../../../references/handoff-contracts.md` for canonical field names and shared evidence semantics. Add `--strict` before any model, deck, committee, lender, board, or client-circulation use so placeholders, empty arrays, and empty objects fail instead of becoming assumptions.

Handoff payloads belong under `handoffs/` and must be listed in `manifest.json` as support or agent artifacts with `handoff_contract_name`, `schema_path`, `validator_status`, `validated_at`, and `consumer_skill`. They are never the hero deliverable unless the user explicitly asks for machine-readable output.

<!-- GENERATED: validated-handoffs END -->
## Dashboard Citation Readiness

<!-- GENERATED: dashboard-citation-readiness START -->

For senior, client, committee, board, lender, or external postures, every material number, estimate, date-sensitive fact, sourced claim, assumption, and recommendation must have inline citation support at the point of use before rendering through `dashboard-builder`. Model-derived claims should cite `model_citations_path` records down to workbook/sheet/cell or range where available.

Unknown citation IDs, missing source registers, or uncited material numeric claims are blocking readiness gaps under `../../../../references/dashboard-citation-readiness-policy.md`. Fix them, downgrade the posture to draft/screen-grade, or surface the missing support as explicit source gaps; do not call the output senior/client/committee/board/external-ready while those gaps remain.

<!-- GENERATED: dashboard-citation-readiness END -->

## Dashboard Handoff

When the user asks for an HTML dashboard, HTML report, MD dashboard, cockpit, command center, visual diligence overview, or a more readable version of a memo/report, keep this skill as the analytical owner and add a `dashboard-builder` packaging step. Build an internal source-aware render contract and render through `dashboard-builder` using `dashboard`, `report_only`, or `hybrid` mode. The internal contract is not the user-facing deliverable. Use the generated HTML as the reader-facing report/dashboard and include blocked-output context plus supporting-artifact explanations inside the page.

Do not fork or maintain separate HTML/CSS/JS inside this skill. Do not expose raw JSON or Markdown report files as the default final artifact.

## Deliverable Format Standard

Follow `../../../../references/deliverable-format-policy.md` before creating files. Always identify the hero deliverable first: XLSX workbook, HTML report, HTML dashboard, native deck/document, generated folder, or justified chat-only answer. Do not create Markdown report files as the default rich deliverable. Do not present JSON contracts, manifests, run logs, or handoff payloads as the main user-facing output. Keep CSV files as backing ledgers/import layers unless the user explicitly asks for CSV, and explain whether each CSV contains new analysis or only support data.

Final responses should point the user to the hero deliverable first and then briefly explain any supporting artifacts.


## Runtime Artifact Path

Default deterministic helpers: `scripts/build_style_profile.py` and `scripts/build_style_diff.py`. Primary human deliverable is the native restyled Office artifact when available; otherwise use `style_profile_report.html` or visual diff HTML as the banker-facing first read. Style profile JSON and change-log JSON are support artifacts, not user-facing deliverables by default. Senior-ready status requires preservation of numbers, citations, formulas, source links, and a downstream QC handoff for decks or committee materials.
