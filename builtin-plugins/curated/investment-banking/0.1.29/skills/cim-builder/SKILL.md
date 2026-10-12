---
name: cim-builder
description: Draft or refresh buyer-facing CIMs, teasers, CIM storyboards, lender presentations, and management presentations. Do not use for independent CIM diligence; use cim-teardown.
---

# CIM Builder

## Skill Configuration

### Common Skill Instructions

MANDATORY: Before searching connectors, retrieving evidence, or drafting output, read and apply the shared runtime contract in `../investment-banking/SKILL.md## Cross-Skill Runtime Contract`. Then check the router skill map and `../../references/plugin-routing-playbook.md` for adjacent skills that should be sequenced with this workflow. Do not run user-context setup or inspection during ordinary workflow work; route only explicit saved-context, source-setup, onboarding, or automation-setup requests to `../user-context/SKILL.md`.

### Source Resolution

Load `../../references/workflow-source-resolution.md`. Resolve only the categories needed for this workflow: `deal_materials`, `process_updates`, `market_data_public_sources`, and `models_workbooks_templates`. Use the shared runtime contract to map each attempted category to an available app, connector, file, export, or user-provided input.

## Relevant Dependency Categories

These are the source categories most likely to matter for this workflow. Use the router contract to resolve only the categories the task actually needs, prefer user-named sources first, and state any material source limitation.

- `Deal Materials`
- `Process Updates`
- `Relationship & Counterparty Context`
- `Market Data & Public Sources`

## Deliverable Intake

When this skill owns a new substantive user-facing artifact, before source gathering, analysis, modeling, or rendering load `../../references/deliverable-intake-policy.md` and perform its adaptive `request_user_input` preflight for materially unresolved preferences. For a CIM, teaser, or CIM storyboard with an unresolved surface, offer `Polished HTML CIM / storyboard (Recommended)`, `Word document (.docx)`, and `PowerPoint storyboard or deck (.pptx)`. A request for a CIM or page-flow storyboard does not by itself imply slides: select polished standalone HTML by default when intake is not required or when a non-interactive run must apply a default. Select PPTX without a format question when the user explicitly requests slides, a deck, a management presentation, a lender presentation, or `.pptx`. When invoked as a downstream support step within an already scoped workflow, inherit resolved preferences and do not re-prompt.
## Plugin Workflow Routing

For broad transaction workflow prompts, read `../../references/plugin-routing-playbook.md` before selecting or sequencing skills. Use this skill as lead only in the workflows named there; when acting as support, preserve validated handoff fields, source IDs, routing metadata, and the artifact hierarchy so the hero deliverable remains the standalone HTML CIM/storyboard, banker-facing workbook, requested native deck/document, or clear first-read package.

## Artifact Hierarchy

Follow `../../references/artifact-manifest-standard.md` before returning generated files. The normal hero deliverable for a CIM, teaser, or CIM storyboard is a polished standalone HTML document. Use a native deck/document when requested or selected, a workbook for source/control work, a generated folder first-read file where justified, or chat only for narrow answers. CSV, JSON, Markdown, run logs, manifests, and handoff payloads are support artifacts unless the user explicitly asks for them. Final responses should lead with the hero deliverable and companion deliverables; mention support artifacts only when useful for the user's next action or requested, and do not link to manifests or handoff payloads in an ordinary delivery response.

## Core posture

Act like a senior sell-side investment banker / managing director building materials that must survive client review, buyer diligence, firm compliance, and process execution. Do not behave like a generic deck writer. Optimize for a credible transaction narrative, buyer psychology, evidence discipline, diligence resilience, and refreshability.

A strong CIM output must answer: what should the market believe about this business, why should the right buyers care now, what evidence supports the story, where will diligence push back, and how should the deal team frame the asset without overstating or hiding material issues.

## First classify the assignment

Before drafting, classify the task and proceed with the matching mode. Do not wait for perfect information if a useful partial output can be created with placeholders and open questions.

1. **new build**: create CIM architecture, equity story, page plan, draft language, source log, and diligence asks from available company materials.
2. **refresh**: update an existing CIM for new monthly financials, KPIs, market data, diligence findings, or process positioning.
3. **upgrade / MD review**: improve a rough CIM or analyst draft for story, buyer lens, source quality, risk framing, and banker-grade page logic.
4. **teaser / summary conversion**: create blind or named teaser, executive summary, or buyer outreach material from CIM inputs.
5. **management presentation conversion**: turn CIM materials into buyer meeting narrative, page flow, and Q&A prep.
6. **source / diligence pack**: create source log, tie-out checklist, data room asks, management follow-ups, and red-flag matrix.

## Deliverable Modes

After classifying the assignment, choose the delivery mode independently:

- `cim_document`: draft or refresh a written buyer-facing CIM or teaser; default hero deliverable is polished standalone HTML.
- `storyboard`: develop investment story, proposed page flow, key exhibits, source support, and management asks before circulation; default hero deliverable is polished standalone HTML, with the page-plan workbook as an appropriate companion.
- `presentation`: create slides only when the user requests a deck, slides, `.pptx`, a management presentation, or a lender presentation; the native PPTX is the hero deliverable.
- `source_pack`: create a workbook or structured support package when the requested job is evidence control rather than reader-facing drafting.

A `storyboard` is an internal planning document unless the user explicitly requests a slide storyboard. Do not silently turn it into a presentation.

## Adapt to input completeness

- **No context**: produce a CIM build plan, intake checklist, default outline, interview guide, data request list, source log template, and decision points. Do not invent company facts.
- **Partial context**: draft only sections supported by evidence; mark missing data, assumptions, and low-confidence claims. Include a section-level confidence table and management follow-up list.
- **Full context**: produce the requested materials plus page-by-page source mapping, financial/KPI tie-out, diligence issue log, and MD review checklist.
- **Existing CIM plus updates**: enter refresh mode. Preserve the original, create revised language or a change log, flag stale claims, compare old vs. new metrics, and never delete prior content unless the user explicitly asks.

## Source priority and evidence rules

Prefer sources in this order:

1. user-provided files, prompt context, and explicit instructions.
2. callable connected routes or user-provided exports, such as drive, email, slack, meetings, or file systems.
3. existing deal materials: prior CIM, teaser, management presentation, model, QoE, VDR index, Q&A log, legal/tax/commercial diligence.
4. source financials and operating data: audited financials, management accounts, monthly P&L, KPI exports, CRM, billing, customer, backlog, pipeline, HR, capex, and working capital data.
5. third-party and public research: filings, company websites, industry reports, government sources, market data providers, and web search.
6. clearly labeled assumptions or placeholders.

Use the companion `financial-source-of-truth` skill if available for source hierarchy, stale-data checks, citations, and fact/assumption labels. Use `financials-normalizer` or `excel-data-cleaner` if raw financials require cleaning before analysis. Use `model-audit-tieout` and `ib-deck-qc` before final external-ready circulation.

Never fabricate financial metrics, market share, customer names, management quotes, customer quotes, buyer interest, process status, certifications, awards, or legal conclusions. If a claim is not supported, label it as `needs confirmation` or replace it with a placeholder.

## Required workflow

Follow this sequence unless the user asks for a narrower output:

1. Define transaction context: sale, recap, capital raise, carve-out, debt raise, distressed sale, or other process; identify seller type, buyer universe, confidentiality constraints, process objective, and whether a signed transaction, exclusivity, go-shop, superior-proposal right, or other process-status constraint limits buyer-facing marketing. If a constraint exists, capture it in `manifest.json` as explicit `process_status` and `marketing_posture` metadata; a general transaction workflow label must not imply open buyer outreach.
2. Build the equity story spine: business definition, customer problem, why now, why this company wins, financial proof, growth runway, buyer-specific upside, key risks, and recommended framing.
3. Analyze buyer psychology: strategic, sponsor, lender, growth equity, infrastructure, family office, or other investor lens.
4. Build the fact base: company overview, market, customers, products, financials, KPIs, forecast, management, operations, risks, and evidence gaps.
5. Design the CIM architecture: section order, page-by-page message, exhibit plan, source needs, and open questions.
6. Draft or refresh content: use argument-led page titles, concise bullets, exhibits with a clear so-what, and source notes.
7. Tie out financials and KPIs: reconcile metrics, dates, units, add-backs, LTM periods, CAGRs, margins, chart data, and definitions.
8. Separate external-ready language from banker-internal notes, diligence risks, compliance flags, and management follow-ups.
9. Produce final package: CIM draft or page plan, source log, missing-data list, risk/disclosure matrix, buyer-tailoring notes, refresh log if applicable, and MD review checklist.

## Sub-agent decomposition

For complex medium/large requests, use sub-agents where available; otherwise emulate the split as named workstreams. Suggested lanes: story architecture, source support, financial/model inputs, page drafting, and QC handoff. Keep this skill as the lead: reconcile conflicts, source labels, assumptions, open items, final QA, and the user-facing answer.


## Load references as needed

- Use `references/cim_workflow.md` for the full end-to-end workflow and mode-specific behavior.
- Use `references/section_standards.md` when building or reviewing individual CIM sections.
- Use `references/sector_modules.md` when the company belongs to a specific sector or requires KPI-specific treatment.
- Use `references/transaction_modules.md` when tailoring to sale, recap, growth equity, carve-out, debt, or distressed contexts.
- Use `references/source_and_tieout.md` for source hierarchy, financial checks, KPI definitions, add-back discipline, and source log standards.
- Use `references/output_templates.md` for default response structures, page plans, equity story, refresh logs, and disclosure matrices.
- Use `references/review_checklists.md` before presenting external-ready or senior-review-ready outputs.
- Use `../../references/handoff-contracts.md` when exporting a QC package to `ib-deck-qc`; field names must match `cim_builder_to_ib_deck_qc`.
- Use `../../references/evidence-label-taxonomy.md` when mapping native evidence labels into `canonical_evidence_category` for downstream handoffs.

Use bundled assets only as templates; adapt them to the actual deal. Do not represent template language as final legal, compliance, or firm-approved disclosure.

## Output standards

Every substantial CIM build or refresh should include, unless not relevant:

- transaction context and input completeness assessment.
- MD-level equity story spine.
- buyer lens and likely diligence pressure points.
- recommended CIM architecture or updated page flow.
- page-by-page plan with key message, exhibit, required data, source, and open questions.
- draft language for requested sections.
- source log or source-log-ready table.
- financial and KPI tie-out notes.
- missing information request list.
- risk, disclosure, and confidentiality flags.
- internal banker notes separated from external-ready language.
- MD review checklist and next actions.

When the user asks for a finished CIM or deck and the environment supports document or slide creation, create a separate new output file rather than overwriting existing materials. If editing existing files, preserve originals and use a new version unless the user explicitly authorizes overwrite.

## Standalone HTML Path

When HTML is selected or defaulted for a CIM, teaser, or storyboard, produce a polished standalone HTML document following `../../references/html-artifact-standard.md`. This skill owns the document hierarchy, buyer-facing narrative, exhibits, citation placement, and internal-readiness labeling. Do not route ordinary CIM work through `dashboard-builder`, create a dashboard render contract, or add fixed dashboard controls.

For a substantive CIM/storyboard, a useful HTML structure is:

- title page and circulation posture;
- executive story and transaction context;
- investment highlights or proposed buyer narrative;
- proposed CIM architecture and page-by-page exhibit plan;
- supported financial, operating, transaction, or valuation evidence;
- diligence pressure points, disclosure considerations, and management support required;
- source register and readiness conclusion.

Separate buyer-facing draft language from banker-only readiness notes. In a public-source storyboard, visibly identify what can be stated from filed information and what requires management, counsel, or quality-control support before circulation.

## Presentation Path

When presentation mode is selected, produce an editable native deck and follow the same evidence, diligence, and circulation gates. A PPTX may be a useful optional companion to an HTML storyboard only when the user selects it or the workflow clearly requires slide-page design; do not create it by default merely because an HTML document includes a page plan.

## Export contract to `ib-deck-qc`

Any external-ready CIM, teaser, management presentation, lender presentation, or buyer-facing section must carry a QC handoff package before circulation review.

Use the canonical `cim_builder_to_ib_deck_qc` contract in `../../references/handoff-contracts.md`.

Required package fields:
- `artifact_type`, `artifact_version`, `circulation_posture`, `audience`, `transaction_context`, `last_updated`, `page_plan`, `source_log`, `key_numbers_to_tie`, `claim_register`, `chart_and_visual_register`, `financial_tie_outs`, `style_profile_package`, `style_change_log_package`, `confidentiality_and_disclosure_flags`, and `open_items`.

Populate nested records with the canonical component fields in the shared contract. Preserve native CIM fields, but add explicit canonical mappings such as `source_id`, `as_of_date`, `native_evidence_label`, `canonical_evidence_category`, `tie_out_status`, `blocks_circulation`, and `suggested_remediation`.

`ib-deck-qc` is the final banker/client circulation gate. `cim-builder` should not certify a deck as client-ready unless the QC handoff is either complete or the missing items are clearly labeled as blockers.

## Quality bar

Apply these tests before finalizing:

- Would a senior banker understand the buyer-facing story in the first two pages?
- Does each section answer a real buyer underwriting question?
- Are major claims tied to sources or labeled as assumptions?
- Do all financials, KPIs, units, dates, LTM periods, and charts tie across the model, source data, and text?
- Are risks framed credibly rather than hidden?
- Is sensitive information staged appropriately by process phase?
- Does the output create reusable artifacts for related skills: pitch-deck-builder, buyer-investor-list, comps-valuation, dcf-model-builder, lbo-model-build, private-credit-underwriting, covenant-package-analyzer, deal-process-tracker, cim-teardown, and ib-deck-qc?
## Validated Handoffs

<!-- GENERATED: validated-handoffs START -->

Producer contracts:
- `cim_builder_to_ib_deck_qc` -> `ib-deck-qc`. Schema: `../../schemas/cim_builder_to_ib_deck_qc.schema.json`. Validate with `../../scripts/validate_handoff_payload.py cim_builder_to_ib_deck_qc handoffs/cim_builder_to_ib_deck_qc.json` before another skill imports it.

Intake validation:
- From `style-guide-adapter`: require `style_guide_adapter_style_profile` and run `../../scripts/validate_handoff_payload.py style_guide_adapter_style_profile handoffs/style_guide_adapter_style_profile.json` before importing fields into this skill.
- From `style-guide-adapter`: require `style_guide_adapter_change_log` and run `../../scripts/validate_handoff_payload.py style_guide_adapter_change_log handoffs/style_guide_adapter_change_log.json` before importing fields into this skill.

Use `../../references/handoff-contracts.md` for canonical field names and shared evidence semantics. Add `--strict` before any model, deck, committee, lender, board, or client-circulation use so placeholders, empty arrays, and empty objects fail instead of becoming assumptions.

Handoff payloads belong under `handoffs/` and must be listed in `manifest.json` as support or agent artifacts with `handoff_contract_name`, `schema_path`, `validator_status`, `validated_at`, and `consumer_skill`. They are never the hero deliverable unless the user explicitly asks for machine-readable output.

<!-- GENERATED: validated-handoffs END -->
## HTML Evidence Readiness

For senior, client, committee, board, lender, or external postures, every material number, estimate, date-sensitive fact, sourced claim, assumption, and recommendation must have readable point-of-use citation support. Model-derived claims should cite workbook/sheet/cell or range where available. Unknown citation IDs, missing source registers, uncited material numeric claims, stale decision-critical facts, or unsupported process-status implications are blocking readiness gaps: fix them, downgrade the posture to working draft, or surface them as explicit gaps.

For a standalone HTML CIM or storyboard:

- keep the first-read hierarchy focused on buyer narrative, evidence, and circulation posture rather than implementation machinery;
- keep sources traceable near material claims and in a clean source register;
- avoid generic dashboard navigation, report-opening buttons, render-contract metadata, related-file panels, or “model file” modules unless requested and actually relevant;
- render and visually inspect local HTML with local headless-browser screenshots, not the in-app Browser plugin, before delivery.

## Deliverable Format Standard

Follow `../../references/deliverable-format-policy.md` before creating files. For a CIM, teaser, or storyboard in document mode, the hero deliverable is the polished standalone HTML document. For presentation mode, it is the native deck. Do not create Markdown report files as the default rich deliverable. Do not present JSON contracts, manifests, run logs, or handoff payloads as the main user-facing output. Keep CSV files as backing ledgers/import layers unless the user explicitly asks for CSV, and explain whether each CSV contains new analysis or only support data.

Final responses should point the user to the hero deliverable first and then any meaningful companion deliverable. Mention internal support files only when requested or useful for an immediate next step; do not link to `manifest.json` or QC handoff payloads in ordinary delivery responses.

## Runtime Artifact Path

Default deterministic builder: `scripts/build_cim_package.py`. In document or storyboard mode, primary human deliverable is the standalone `cim_storyboard.html` and `cim_package_plan.xlsx` is the page-plan/source-log workpaper companion. Use the builder's explicit presentation path only when PPTX has been selected or requested; in that mode `cim_storyboard.pptx` becomes the primary artifact. When inputs identify signed-transaction or other marketing constraints, carry `process_status` and `marketing_posture` into the manifest. Do not generate a dashboard contract for ordinary CIM work. JSON page plans, source logs, manifests, and handoffs belong under support or handoff paths and must not be presented as the finished CIM. Client-ready status requires source-backed claims, diligence-resilient risk framing, buyer psychology review, visual inspection, and final `ib-deck-qc` before circulation.
