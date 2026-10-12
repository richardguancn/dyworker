---
name: ib-deck-qc
description: quality-control investment-banking decks and reports before circulation. use when the user asks to check numbers, units, sources, charts, footnotes, formatting, or page takeaways. do not use to build the deck from scratch.
---

# IB Deck QC

## Skill Configuration

### Common Skill Instructions

MANDATORY: Before searching connectors, retrieving evidence, or drafting output, read and apply the shared runtime contract in `../investment-banking/SKILL.md## Cross-Skill Runtime Contract`. Then check the router skill map and `../../references/plugin-routing-playbook.md` for adjacent skills that should be sequenced with this workflow. Do not run user-context setup or inspection during ordinary workflow work; route only explicit saved-context, source-setup, onboarding, or automation-setup requests to `../user-context/SKILL.md`.

## Relevant Dependency Categories

These are the source categories most likely to matter for this workflow. Use the router contract to resolve only the categories the task actually needs, prefer user-named sources first, and state any material source limitation.

- `Deal Materials`
- `Models, Workbooks & Templates`
- `Market Data & Public Sources`
- `Process Updates`

## Deliverable Intake

When this skill owns a new substantive user-facing artifact, before source gathering, analysis, modeling, or rendering load `../../references/deliverable-intake-policy.md` and perform its adaptive `request_user_input` preflight for materially unresolved preferences. When invoked as a downstream support step within an already scoped workflow, inherit resolved preferences and do not re-prompt.

## Plugin Workflow Routing

For broad transaction workflow prompts, read `../../references/plugin-routing-playbook.md` before selecting or sequencing skills. Use this skill as lead only in the workflows named there; when acting as support, preserve validated handoff fields, source IDs, routing metadata, and the artifact hierarchy so the hero deliverable remains the banker-facing workbook, HTML report/dashboard, native deck/document, or clear first-read package.

## Purpose

Use this skill as the banker/client-circulation gate for Investment Banking deliverables. The default job is to identify issues, prioritize fixes, and produce a polished standalone HTML QC report, annotated native deck workflow, or native-deck remediation path for pitch books, CIMs, teasers, valuation decks, financing decks, strategic alternatives materials, process materials, and committee readouts. Do not rewrite, rebuild, or redesign the deliverable unless the user explicitly asks for remediation.

This skill replaces the generic deck/report review dependency inside the Investment Banking plugin. Route final IB materials here, not to a generic deck/report review skill.

## Banker circulation ownership

This skill owns the final IB circulation decision:
- whether a deck, CIM, teaser, buyer list, financing pitch, valuation deck, or process material is ready for analyst fixes, VP/director review, MD review, client circulation, buyer/lender circulation, or is not circulable;
- whether numbers, units, dates, footnotes, sources, page titles, charts, and narrative claims tie across the deck, model, source files, and supporting materials;
- whether valuation, financing, leverage, covenant, returns, accretion/dilution, buyer rationale, process, and market pages carry the caveats needed for banker/client use;
- whether the page-level "so what" is clear enough for a banker to present without re-explaining the analysis.

Preserve the strongest generic QC controls: repeated-number tie-outs, source and footnote coverage, visual review, chart-to-narrative consistency, issue taxonomy, remediation sequence, posture labels, and explicit missing-support-file flags.

## Operating principles

1. Treat every number, unit, footnote, chart, and conclusion as something that must tie to an identified source or model output.
2. Separate deterministic findings from judgment calls. Mark uncertain items as `needs_review` rather than overclaiming.
3. Prioritize issues by decision impact. A mismatched EBITDA value, leverage multiple, covenant headroom, IRR, or valuation range is more important than minor formatting polish.
4. Preserve the original artifact. QC should create an issue log and suggested fixes first; edit only when asked.
5. Apply `financial-source-of-truth` standards for source hierarchy, stale-data checks, citation format, source conflicts, and fact/assumption labels.
6. Route model-level issues to `model-audit-tieout` and data-shaping issues to `excel-data-cleaner` instead of trying to solve them inside this skill.

## Artifact Hierarchy

Follow `../../references/artifact-manifest-standard.md` before returning generated files. For an ordinary circulation-gate review with no requested native markup workflow, the hero deliverable is a polished standalone HTML QC report. A workbook, native deck/document, generated folder first-read file, or justified chat-only answer may be the hero only when the user's requested workflow calls for it. CSV issue ledgers, JSON, Markdown, run logs, manifests, handoff payloads, and render inputs are support artifacts unless the user explicitly asks for them. Final responses should lead with the hero deliverable, then companion deliverables, then support artifacts in one short sentence if useful.

## Workflow

### 1. Classify the deliverable

Identify the file type and purpose:
- IB pitch book, CIM, teaser, board deck, investor presentation, fairness/valuation deck, strategic alternatives deck, financing pitch, capital markets deck, process update, buyer/investor list, lender presentation, or committee readout
- model output deck or report linked to DCF, comps, LBO, merger model, QoE, three-statement, private credit, covenant analysis, capital markets issuance, restructuring, or recovery analysis
- mixed pack with PPTX/PDF/DOCX/XLSX support files

If the user provides multiple files, identify the controlling artifact and the source artifacts. Example: deck is controlling output; model, evidence ledger, transcript, and CIM are supporting materials.

### 2. Extract first-pass text, numbers, and sources

For PPTX, DOCX, XLSX, CSV, TXT, or markdown files, run the bundled script when available:

```bash
python scripts/inspect_deck_report.py <file1> <file2> --outdir qc_out
```

Use the script output as a first-pass map only. It is not a substitute for visual review, chart inspection, model tie-out, or PDF rendering.

For PDFs, screenshots, image-heavy slides, or scanned materials, use PDF/rendering tools to inspect pages visually before finalizing QC. If charts are embedded as images, state that the underlying chart data could not be extracted unless the model/source file is provided.

### 3. Build the QC map

Create or infer:
- page/slide/section list
- main title and thesis by page
- all repeated metrics and key claims
- source footnotes and citation coverage
- chart titles, axes, units, legends, and cited data source
- model-output tables and valuation/returns ranges
- section-level narrative conclusions

Consult `references/qc-playbook.md` for QC categories and `references/extraction-and-tieout.md` for extraction and tie-out guidance.

### 4. Run issue checks

Check at minimum:
- repeated numbers: same metric, company, period, and unit should match unless there is a disclosed reason
- units: millions/billions, dollars/local currency, percentages/bps, turns, multiples, per-share, nominal/real, annualized/LTM/NTM should be explicit and consistent
- source footnotes: each data-heavy page should identify source, as-of date, period, and whether data is company, market, broker, management, seller, model, or internal estimate
- charts: chart title, axis units, legends, series labels, chart numbers, and narrative takeaway should agree
- narrative consistency: executive summary, page titles, subtitles, bullets, charts, and conclusion should not contradict each other
- formatting: titles, subtitles, page numbers, fonts, alignment, table formatting, footnote style, decimal precision, capitalization, and repeated labels should be consistent
- caveats: preliminary, unaudited, management-provided, seller-provided, model-derived, and assumption-led items should be labeled
- compliance hygiene: do not add legal disclaimers unless requested, but flag missing caveats/disclosures where the analysis relies on uncertain or restricted inputs

Consult `references/issue-taxonomy.md` for severity and issue-type definitions.

## Import Contracts

Use `../../references/handoff-contracts.md` as the canonical shared handoff layer. If native field names differ, require the upstream artifact to map them to the canonical fields before QC.

Expected imports:
- `cim_builder_to_ib_deck_qc` for CIMs, teasers, management presentations, lender presentations, and buyer-facing CIM sections.
- `pitch_deck_builder_to_ib_deck_qc` for pitch books, client discussion decks, strategic alternatives decks, financing decks, and slide-blueprint handoffs.
- `style_guide_adapter_style_profile` and `style_guide_adapter_change_log` when a style profile or restyle pass was used.
- `distressed_recovery_waterfall_to_ib_deck_qc` when the material includes restructuring, claims, lien priority, recoveries, value-break, fulcrum, or waterfall analysis.

Use these packages to seed the QC map. Treat missing `source_log`, `key_numbers_to_tie`, `claim_register`, or required style/restructuring tie-outs as high-severity issues for any external, board, committee, lender, or client-facing deliverable. Preserve the distinction between external-ready language and internal banker notes; flag any internal note that appears in client-facing pages.

If style support is metadata-only or `visual_review_status` is `not_performed`, `metadata_only`, or `blocked`, do not assign `client-ready`; assign a lower posture and list rendered visual review as an open item.

### 5. Decide the review posture

Assign one of these postures:
- `client-ready`: only immaterial polish items remain
- `senior-review-ready`: mostly ready, with limited open questions or judgement calls
- `needs-targeted-fixes`: specific corrections are required before circulation
- `not-circulable`: material numerical, source, chart, or narrative issues remain
- `blocked`: necessary source/model files are missing

### 6. Produce the QC output

Default output for substantial QC work is an `extended_analysis` polished standalone HTML QC report, or an annotated/native deck workflow when the user asks for edits or slide-native review. Include:
1. Executive QC verdict
2. Circulation posture
3. Top issues by severity
4. Issue log table
5. Repeated metric / number tie-out table
6. Source and footnote coverage table
7. Chart and narrative tie-out findings
8. Formatting/presentation polish findings
9. Recommended remediation sequence
10. Open questions / missing support files

Use quick red-flag review only when the user explicitly asks for red flags, top issues only, a fast scan, or a narrow follow-up against an existing full QC pack. Read `../../references/output-depth-policy.md` before shortening. Use `references/output-templates.md` for default templates.

## Standalone HTML Path

For an ordinary HTML circulation-gate review, produce a polished standalone HTML QC report following `../../references/html-artifact-standard.md`. This skill owns the report hierarchy, issue prioritization, evidence presentation, and remediation sequence. Do not route an ordinary circulation QC HTML report through `dashboard-builder`, create a dashboard render contract, or force findings into generic dashboard modules.

Make the report read like a compact banker redline memo:
- open with the circulation posture, decision consequence, and three to five issues that block the requested circulation audience;
- place the remediation owner or required support next to each blocker;
- keep missing inputs and what remains unverifiable prominent but concise;
- put the detailed issue register, number/source checks, visual findings, and lower-priority polish beneath the first-read blockers;
- where a confirmed critical/high finding is visible in a supplied deck or PDF, include a compact page excerpt, page thumbnail, or precise page-reference callout when it makes remediation easier to confirm.

Keep evidence readable. Use compact point-of-use citations at the material issue, table-row, or paragraph level and a clean source register; do not repeat citation chips on every clause or table cell. Do not add generic dashboard navigation, persistent reader-action bars, repeated posture cards, broad export controls, or visible internal support machinery merely because the output is HTML.

If the user asks for an owner tracker, tracked remediation cycle, or slide-native markup, provide the appropriate workbook or annotated/native-deck companion workflow while keeping the circulation judgment and issue evidence consistent.

## Sub-agent decomposition

For complex medium/large requests, use sub-agents where available; otherwise emulate the split as named workstreams. Suggested lanes: number/model tie-out, source/footnote review, chart/narrative review, formatting/style QC, and issue severity. Keep this skill as the lead: reconcile conflicts, source labels, assumptions, open items, final QA, and the user-facing answer.


## Severity rules

Use these severities:
- `critical`: could change investment decision, valuation, financing terms, IC/credit recommendation, market read, or client trust
- `high`: material inconsistency or missing support that must be fixed before circulation
- `medium`: localized inconsistency, unclear caveat, formatting issue, or missing source detail that should be fixed
- `low`: polish item that does not affect substance
- `needs_review`: possible issue that requires visual, model, source, or user confirmation

Never hide uncertainty. If a number may be wrong but cannot be proven wrong from available files, label it `needs_review` and ask for the model/source support.

## Investment Banking skill routing

Use `references/investment-banking-integrations.md` when deciding whether an issue belongs in this skill or should be routed to another Investment Banking skill.

Common routes:
- source hierarchy, stale data, citation standard, source conflict, fact/assumption labeling -> `financial-source-of-truth`
- workbook formula, model logic, sensitivity, scenario, source tie-out -> `model-audit-tieout`
- messy tabular data, duplicated rows, bad date/number formats -> `excel-data-cleaner`
- valuation or transaction model construction or repair -> `dcf-model-builder`, `comps-valuation`, `lbo-model-build`, `merger-model-builder`, or `three-statement-model-builder`
- seller claim diligence and evidence asks -> `cim-teardown` or `financials-normalizer`
- buyer/investor rationale -> `buyer-investor-list`
- CIM or teaser build/refresh -> `cim-builder`
- issuance or financing market advice -> `capital-markets-issuance`
- restructuring and recovery waterfall logic -> `distressed-recovery-waterfall`
- final committee or client synthesis -> `memo-builder`

## Final checks before responding

Before final output, verify:
- every critical/high issue has location, evidence, why it matters, and suggested fix
- every repeated metric table distinguishes exact mismatch from possible period/unit mismatch
- source gaps are not presented as factual errors unless a controlling source proves the issue
- formatting findings are separated from investment-substance findings
- the final posture matches the severity of remaining issues
- the response does not imply the deck/report is fully verified if charts, screenshots, PDFs, or source models were not inspectable
- any shortened QC response was explicitly requested or justified by `../../references/output-depth-policy.md`
## Validated Handoffs

<!-- GENERATED: validated-handoffs START -->

Intake validation:
- From `cim-builder`: require `cim_builder_to_ib_deck_qc` and run `../../scripts/validate_handoff_payload.py cim_builder_to_ib_deck_qc handoffs/cim_builder_to_ib_deck_qc.json` before importing fields into this skill.
- From `pitch-deck-builder`: require `pitch_deck_builder_to_ib_deck_qc` and run `../../scripts/validate_handoff_payload.py pitch_deck_builder_to_ib_deck_qc handoffs/pitch_deck_builder_to_ib_deck_qc.json` before importing fields into this skill.
- From `distressed-recovery-waterfall`: require `distressed_recovery_waterfall_to_ib_deck_qc` and run `../../scripts/validate_handoff_payload.py distressed_recovery_waterfall_to_ib_deck_qc handoffs/distressed_recovery_waterfall_to_ib_deck_qc.json` before importing fields into this skill.
- From `style-guide-adapter`: require `style_guide_adapter_style_profile` and run `../../scripts/validate_handoff_payload.py style_guide_adapter_style_profile handoffs/style_guide_adapter_style_profile.json` before importing fields into this skill.
- From `style-guide-adapter`: require `style_guide_adapter_change_log` and run `../../scripts/validate_handoff_payload.py style_guide_adapter_change_log handoffs/style_guide_adapter_change_log.json` before importing fields into this skill.

Use `../../references/handoff-contracts.md` for canonical field names and shared evidence semantics. Add `--strict` before any model, deck, committee, lender, board, or client-circulation use so placeholders, empty arrays, and empty objects fail instead of becoming assumptions.

Handoff payloads belong under `handoffs/` and must be listed in `manifest.json` as support or agent artifacts with `handoff_contract_name`, `schema_path`, `validator_status`, `validated_at`, and `consumer_skill`. They are never the hero deliverable unless the user explicitly asks for machine-readable output.

<!-- GENERATED: validated-handoffs END -->
## HTML Evidence Readiness

For senior, client, committee, board, lender, or external circulation postures, every material number, estimate, date-sensitive fact, sourced claim, assumption, and recommendation in the standalone HTML QC report must have readable point-of-use citation support. Model-derived findings should cite the workbook/sheet/cell or range where available.

Unknown sources, missing source registers, or uncited material numeric findings are blocking readiness gaps. Fix them, downgrade the posture, or surface the missing support as an explicit source gap; do not call the reviewed deliverable ready for the requested circulation audience while those gaps remain.

For a standalone HTML QC report:
- cite each critical/high issue close to the stated evidence and remediation requirement without duplicating citation chips in every cell;
- distinguish confirmed deck defects from unsupported assertions, missing support, and judgment items requiring review;
- render and visually inspect the controlling deck/document where layout matters, plus the generated local HTML through local headless-browser screenshots rather than the in-app Browser plugin;
- check the opening viewport and issue-register sections for hierarchy, table legibility, clipped content, excessive chrome, and citation noise before delivery.

## Deliverable Format Standard

Follow `../../references/deliverable-format-policy.md` before creating files. Always identify the hero deliverable first: standalone HTML QC report, XLSX remediation tracker, native deck/document, generated folder, or justified chat-only answer. Do not create Markdown report files as the default rich deliverable. Do not present JSON contracts, manifests, run logs, render inputs, or handoff payloads as the main user-facing output. Keep CSV issue logs as backing ledgers/import layers unless the user explicitly asks for CSV, and explain whether each CSV contains new analysis or only support data.

Final responses should point the user to the hero deliverable first and then briefly explain any supporting artifacts.
