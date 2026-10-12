---
name: dashboard-builder
description: Render MD-grade Investment Banking HTML dashboards and lightweight report-only HTML pages with polished reader-facing structure, citations, and copy controls.
---

# Investment Banking Dashboard Builder

> Internal support playbook. Load through `internal-support/policy.md`; this renderer is bundled with the visible router rather than exposed as a skill entrypoint.

## Deliverable Intake

When another Investment Banking skill owns the analysis, inherit its resolved preferences and do not re-prompt before rendering. Only when this skill independently owns a new substantive standalone dashboard or HTML report should it, before source gathering, analysis, or rendering, load `../../../../references/deliverable-intake-policy.md` and perform its adaptive `request_user_input` preflight for materially unresolved preferences.

## Plugin Workflow Routing

For broad transaction workflow prompts, read `../../../../references/plugin-routing-playbook.md` before selecting or sequencing skills. Use this skill as lead only in the workflows named there; when acting as support, preserve validated handoff fields, source IDs, routing metadata, and the artifact hierarchy so the hero deliverable remains the banker-facing workbook, HTML report/dashboard, native deck/document, or clear first-read package.

Use this skill when an Investment Banking workflow should produce a reader-facing HTML dashboard, HTML report, or hybrid workbook-plus-HTML package. Keep the skill name `dashboard-builder`. The scope is broader than visual dashboards: it is the shared renderer for MD-grade HTML deliverables across the plugin.

This skill is a renderer and packaging layer. It does not replace the analytical skill, build the financial model, invent diligence conclusions, or rewrite the memo. Source skills own analysis. `dashboard-builder` owns the HTML shell, responsive behavior, report-only mode, dashboard modules, executive hero, highlight tiles, citation badges, copy controls, diligence gaps, and related-file links.

## Artifact Hierarchy

Follow `../../../../references/artifact-manifest-standard.md` before returning generated files. The hero deliverable must be a workbook, HTML report/dashboard, native deck/document, generated folder first-read file, or justified chat-only answer. CSV, JSON, Markdown, run logs, manifests, and handoff payloads are support artifacts unless the user explicitly asks for them. Final responses should lead with the hero deliverable, then companion deliverables, then support artifacts in one short sentence if useful.

## Core Principle

Centralize rendering. Decentralize skill-specific analysis and mapping.

Do not create standalone HTML/CSS/JS packs inside every source skill. Do not make Markdown reports or naked JSON contracts the default user-facing deliverables. The reader should see a polished HTML report/dashboard or the true hero artifact, such as an XLSX workbook, native deck, or chat answer.

## Render Modes

Supported modes:

- `dashboard`: metric cards, charts, tables, issue registers, timelines, and MD cockpit views.
- `report_only`: polished HTML for memo, tearsheet, credit memo, meeting prep, QC report, or diligence narrative.
- `hybrid`: an XLSX/native deck/model plus an HTML executive report/dashboard companion.

## Expected Inputs

A source skill should provide an internal render contract. The file may still be JSON because the renderer needs structure, but it is not the user-facing deliverable.

The contract should include:

- `deliverable.render_mode`
- `deliverable.primary_artifact` and `deliverable.primary_artifact_type`
- `deliverable.hero_callout`
- optional `issuer`, `hero`, `snapshot`, and `citations`
- `report_body` for report-only or hybrid prose; the renderer groups these entries into one copyable Analysis module with internal subsections
- `sections` for dashboard or hybrid modules; modules default to responsive grid cards unless they explicitly need a wide/full layout
- `blocked_output_context` when an output is partial or blocked
- `supporting_outputs` for short related-file links
- `sources` and `assumptions`
- inline citation support on every claim-bearing or numeric item, including hero callouts, snapshot tiles, metrics, paragraphs, bullets, report sections, table rows/cells, and module notes. Accepted aliases are `citations`, `citation_ids`, `citation`, `source_id`, and `source_ids`; bracket markers like `$15.0B [S1]` are also accepted.
- optional external-only citation fields on a value or row: `source_url`, `source_title`, `as_of`/`date`, and `excerpt`/`pinpoint`/`note`.
- optional `model_citations`, `workbook_citations`, `model_citations_path`, or `workbook_citations_path` for cell/range-level workbook citations. Records should include `id`, `workbook_path`, `sheet`, `cell` or `range`, `value`, optional `formula`, and aliases such as `base irr` or `net leverage`.
- `posture` or `readiness_posture` must be accurate. Senior/client/committee/board/external-ready postures hard-fail on material citation gaps unless the user explicitly accepts draft status.
- `deliverable.executive_summary`, `deliverable.hero_actions`, and `deliverable.utility_controls` when the page should support banker workflow controls such as copy summary, print/PDF, or open workbook/deck/model actions.
- table modules and report tables may set `table_id`, `download_filename`, and `exportable`; visible tables are exportable by default so associates can copy TSV into Excel or download a client-side CSV from the page.

Legacy `dashboard_contract.json` inputs still render, but new source skills should treat the contract as internal plumbing and keep implementation language out of the visible HTML.

## Operational Controls

Read `../../../../references/dashboard-operational-controls-policy.md` before rendering deal-team, MD, committee, client, board, lender, or external HTML. The renderer should provide Copy Full Report, Print / Save PDF, per-table Copy TSV, per-table Download CSV, and an Open Workbook/Deck/Model action when a true human companion artifact exists. These controls are workflow affordances inside the HTML page; they do not turn CSV, JSON, Markdown, logs, manifests, or handoff payloads into primary deliverables.

## Expected Outputs

Default output is a single reader-facing HTML file:

- `report.html` for `report_only`
- `dashboard.html` for `dashboard` and `hybrid`

Machine-readable support JSON is off by default. Use `--write-support-json` only for automated tests, audit workflows, or internal debugging.

## Rendering Command

```bash
python3 skills/investment-banking/internal-support/dashboard-builder/scripts/render_dashboard.py   --contract path/to/internal_render_contract.json   --outdir path/to/output_directory
```

Optional audit mode:

```bash
python3 skills/investment-banking/internal-support/dashboard-builder/scripts/render_dashboard.py   --contract path/to/internal_render_contract.json   --outdir path/to/output_directory   --write-support-json
```

## Source Skill Responsibilities

Each source skill should:

- identify the primary user artifact: XLSX, HTML, native deck, output folder, or chat-only answer;
- generate HTML report/dashboard output when a substantial text report would otherwise become Markdown;
- keep JSON handoffs, logs, manifests, and CSV ledgers internal/supporting unless the user explicitly asks for those files;
- explain any CSV/XLSX/JSON support file in the HTML and final response;
- include blocked-output context inside HTML rather than handing the user a raw JSON contract.
- cite every material number, estimate, date-sensitive claim, quote, assumption, and sourced factual claim at the point of use;
- treat the bottom source register as the ledger, not the citation experience. Numeric values should usually become the quiet citation link themselves, inheriting normal text color with a subtle underline/background affordance rather than a loud badge beside every number;
- use small citation chips for non-numeric claims. If a whole section/card/table uses the same repeated source set, put the ids on the section/module so the renderer can show a compact `Section sources` note instead of repeating identical chips after every sentence;
- use external-only source fields when the source is not in the ledger: `source_url`, `source_title`, `as_of`, and `excerpt`. The rendered citation opens the URL and still shows a hover/focus preview;
- when the cited support is a generated model workbook, prefer cell/range-level citation ids from `model_citations.json` over a generic `model-output` citation. Numeric model outputs should link directly through the number; hover should show workbook, sheet, range, value, and formula when available;
- expect validation to block senior/client/committee/board/external postures when unresolved citation IDs or uncited material numeric claims remain. Source gaps belong in missing-evidence/open-diligence sections, not as uncited claims in the report.

## Citation Readiness Gate

Read `../../../../references/dashboard-citation-readiness-policy.md` before rendering senior-review-ready, client-ready, committee-ready, board-ready, lender-ready, external, or final-circulation-candidate outputs.

Default citation policy is `block_for_senior`: draft, screen-grade, preliminary, working-draft, and source-caveat outputs may render with warnings, but senior/client/committee/board/external postures must hard-fail on unresolved citation IDs, uncited material numeric text, missing source registers, or model outputs that lack source/model-cell support.

Use `citation_policy: strict` when any citation gap should fail regardless of posture. Use `--accept-draft-citation-gaps` only when the user explicitly accepts draft status and provide `--citation-gap-acceptance-reason`; the renderer downgrades the visible readiness label to `Draft With Citation Gaps` and marks the output as not for external circulation.

## Quality Bar

A good HTML deliverable should answer:

- Where should the user look first?
- Is the output complete, partial, or blocked?
- What evidence, assumptions, and limitations matter?
- What supporting files exist and why?
- What is the next action?
