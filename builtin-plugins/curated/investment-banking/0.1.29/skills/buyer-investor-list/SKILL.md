---
name: buyer-investor-list
description: build prioritized buyer, investor, lender, or sponsor universes for ib processes. use when the user asks for target lists, outreach waves, rationale, or tracker-ready parties. do not use to run the live process; use deal-process-tracker.
---

# Buyer Investor List

## Skill Configuration

### Common Skill Instructions

MANDATORY: Before searching connectors, retrieving evidence, or drafting output, read and apply the shared runtime contract in `../investment-banking/SKILL.md## Cross-Skill Runtime Contract`. Then check the router skill map and `../../references/plugin-routing-playbook.md` for adjacent skills that should be sequenced with this workflow. Do not run user-context setup or inspection during ordinary workflow work; route only explicit saved-context, source-setup, onboarding, or automation-setup requests to `../user-context/SKILL.md`.

### Source Resolution

Load `../../references/workflow-source-resolution.md`. Resolve only the categories needed for this workflow: `deal_materials`, `relationship_counterparty_context`, `market_data_public_sources`, and `models_workbooks_templates`. Use the shared runtime contract to map each attempted category to an available app, connector, file, export, or user-provided input.

## Relevant Dependency Categories

These are the source categories most likely to matter for this workflow. Use the router contract to resolve only the categories the task actually needs, prefer user-named sources first, and state any material source limitation.

- `Relationship & Counterparty Context`
- `Market Data & Public Sources`
- `Process Updates`

## Deliverable Intake

When this skill owns a new substantive user-facing artifact, before source gathering, analysis, modeling, or rendering load `../../references/deliverable-intake-policy.md` and perform its adaptive `request_user_input` preflight for materially unresolved preferences. When invoked as a downstream support step within an already scoped workflow, inherit resolved preferences and do not re-prompt.

## Artifact Hierarchy

Follow `../../references/artifact-manifest-standard.md` before returning generated files. The hero deliverable must be a polished standalone HTML buyer-universe report, workbook, native deck/document, generated folder first-read file, or justified chat-only answer. CSV, JSON, Markdown, run logs, manifests, and handoff payloads are support artifacts unless the user explicitly asks for them. Final responses should lead with the hero deliverable, then companion deliverables, then support artifacts in one short sentence if useful.

## Plugin Workflow Routing

For broad transaction workflow prompts, read `../../references/plugin-routing-playbook.md` before selecting or sequencing skills. Use this skill as lead only in the workflows named there; when acting as support, preserve validated handoff fields, source IDs, routing metadata, and the artifact hierarchy so the hero deliverable remains the banker-facing standalone HTML report, workbook, native deck/document, or clear first-read package.

## Trigger Boundary

Use for prioritized buyer, sponsor, lender, financing source, or investor universes where the user needs who to contact, why they care, whether they can transact, what risk they introduce, who should approach them, and when they belong in the process.

Role: produce a senior banker process strategy artifact, not a directory export. Optimize for price, certainty, speed, confidentiality, strategic fit, financing capacity, cultural fit, restructuring feasibility, or competitive tension based on the user's objective.

Non-role: do not run the live process, mark outreach complete, send materials, grant access, or replace the process tracker. Use `deal-process-tracker` once the universe becomes active outreach.

## Fast Workflow

1. Classify the mandate: sell-side M&A, sponsor targeting, lender/financing source, growth/minority/private placement, restructuring/distressed capital, or public-market investor targeting.
2. Adapt to context: with no context, build a starter framework and assumptions; with partial context, produce a preliminary universe; with full materials or an existing list, preserve existing rows/notes and add proposed columns plus a change log.
3. Establish transaction objective, constraints, target profile, confidentiality limits, client preferences, do-not-contact parties, and success metric.
4. Define archetypes before names, then build the universe from user materials, connected sources, structured data, public sources, and banker judgment.
5. Normalize entities, apply hard screens, score/tier parties, write specific rationale, map relationship path, sequence outreach waves, and run MD-style QA.
6. Use only the references needed for the request; do not load every playbook by default.

## Sub-agent decomposition

For complex medium/large requests, use sub-agents where available; otherwise emulate the split as named workstreams. Suggested lanes: strategic buyers, sponsors, lenders/financing sources, exclusions/conflicts, and outreach-wave strategy. Keep this skill as the lead: reconcile conflicts, source labels, assumptions, open items, final QA, and the user-facing answer.


## Artifact Contract

Default deliverable: `extended_analysis` with executive summary, ranked table, top-call notes, hold/exclusion list, process strategy, source/evidence posture, confidentiality flags, tracker handoff readiness, and data gaps/validation asks.

Use starter or preliminary depth only when source context is genuinely thin, the user explicitly asks for a quick target list, or the response is a narrow update to an existing full universe. Read `../../references/output-depth-policy.md` before shortening.

For an HTML-selected pitch, prioritization, or top-call request, the hero artifact is a polished standalone HTML buyer-universe report. For a user-supplied universe that requires scoring, deduping, tracking, or operational row management, prefer a workbook as the hero artifact and use HTML only when requested as an additional reader-facing report.

Hero report ranked-table core fields: party, type, tier/wave, specific thesis, ability-to-transact evidence or validation need, confidentiality/regulatory handling, next action, and source/confidence. Keep raw score, penalty, and final-score columns in the working workbook or a secondary analytical schedule unless the user specifically wants numerical scoring in the first-read report.

For spreadsheet-like outputs, preserve existing user columns, add new fields to the right, and use proposed-change columns instead of destructive edits.

Tracker handoff: when the universe becomes active outreach, export the canonical `buyer_investor_list_to_deal_process_tracker` contract in `../../references/handoff-contracts.md`. Validate automation payloads against `../../schemas/buyer_investor_list_to_deal_process_tracker.schema.json`; keep `holds_and_exclusions` separate and preserve confidentiality, conflict, and client-approval flags.

## Standalone HTML Path

When HTML is requested or selected, produce a polished standalone HTML buyer-universe report following `../../references/html-artifact-standard.md`. This skill owns its report hierarchy, writing, and presentation. Do not route an ordinary buyer-universe HTML report through `dashboard-builder`, create a dashboard render contract, or force the analysis into fixed dashboard modules.

For an initial sell-side pitch or outreach-sequencing request, use this first-read hierarchy:

1. Process recommendation: objective, recommended process posture, conditional first-wave names, high-value holds, and decisions required from the client or MD.
2. Outreach sequencing: one compact wave-and-gates table combining disclosure approach, required approvals, and validation steps.
3. Prioritized buyer universe: the decision-useful ranked table, with unverified capacity, ownership, relationship, or conflicts visibly marked as validation needs.
4. Sensitive parties and holds: one register for confidentiality, regulatory, commercial, conflict, and do-not-contact handling.
5. Pre-outreach decisions: one consolidated action table for missing approvals, relationship checks, capacity validation, legal/compliance protocol, and material diligence gaps.
6. Evidence and limitations: readable source notes and the preliminary or decision-ready posture.

Keep the report table-first where comparison is central, but do not repeat the same conclusion in a hero callout, separate call sheet, separate open-diligence register, and multiple near-duplicate tables. In a pitch-stage HTML report, keep the prioritized buyer universe focused on actionable and conditionally actionable parties. Present held or excluded sensitive parties in the dedicated hold register instead of duplicating full rows in both sections, unless side-by-side comparison is central to the recommendation. A candidate with unverified ownership, capacity, conflict status, or outreach authorization may be recommended for validation or `Conditional Wave 1`, but must not be presented as cleared for outreach.

Do not add generic dashboard navigation, reader-action bars, related-file panels, internal renderer contracts, or visible generation machinery merely because the output is HTML. Include a companion workbook when the user needs operational scoring or tracker-style row management; keep it distinct from the first-read report.

## Source And Evidence Posture

Use user-provided deal materials and explicit instructions first, then connected/internal sources, licensed/company data where available, public primary/credible secondary sources, and clearly labeled inference. Compose with `financial-source-of-truth` when source hierarchy, citations, stale-data checks, conflicts, or fact/assumption labels matter.

Do not fabricate factual claims, relationship history, mandate fit, capacity, contacts, or do-not-contact status. Mark each row's source quality/confidence and preserve source dates.

## Validated Handoffs

<!-- GENERATED: validated-handoffs START -->

Producer contracts:
- `buyer_investor_list_to_deal_process_tracker` -> `deal-process-tracker`. Schema: `../../schemas/buyer_investor_list_to_deal_process_tracker.schema.json`. Validate with `../../scripts/validate_handoff_payload.py buyer_investor_list_to_deal_process_tracker handoffs/buyer_investor_list_to_deal_process_tracker.json` before another skill imports it.

Use `../../references/handoff-contracts.md` for canonical field names and shared evidence semantics. Add `--strict` before any model, deck, committee, lender, board, or client-circulation use so placeholders, empty arrays, and empty objects fail instead of becoming assumptions.

Handoff payloads belong under `handoffs/` and must be listed in `manifest.json` as support or agent artifacts with `handoff_contract_name`, `schema_path`, `validator_status`, `validated_at`, and `consumer_skill`. They are never the hero deliverable unless the user explicitly asks for machine-readable output.

<!-- GENERATED: validated-handoffs END -->
## Script Map

If the user provides a csv-style universe and asks for scoring, deduping, or tiering, you may use `scripts/score_buyer_universe.py`. The script preserves all original columns and appends framework-aligned score, risk penalty, tier, wave, recommended action, confidence, source quality, MD judgment note, score-basis, and QA fields. Use `--objective` when the process objective is clear (`maximize_valuation`, `maximize_certainty`, `preserve_confidentiality`, `founder_friendly_recap`, `lender_process`, or `distressed_restructuring`). Do not use the script as a substitute for judgment; review and revise the output before presenting it.

- For tracker handoff validation, use `../../scripts/validate_handoff_payload.py buyer_investor_list_to_deal_process_tracker <payload.json>`.

## HTML Evidence Readiness

For senior, client, committee, board, lender, or external postures, every material number, estimate, date-sensitive fact, sourced claim, assumption, and recommendation must have readable point-of-use citation support. Unknown citation IDs, missing source registers, uncited material numeric claims, unsupported buyer-capacity claims, unsupported interest or relationship claims, and uncleared confidentiality or regulatory implications are blocking readiness gaps: fix them, downgrade the posture to draft or preliminary pitch-screen status, or surface them explicitly.

For an HTML buyer-universe report:

- Keep sources readable: cite complete claims or table rows where possible rather than attaching repeated citation chips to every cell.
- Separate confirmed facts from banker hypotheses, inferred buyer logic, relationship-validation needs, and legal/compliance gates.
- Keep numeric scoring from implying buyer interest, transaction capacity, approval, or legal conclusions.
- Keep support artifacts and generation mechanics out of the visible report body unless requested.
- Render and visually inspect local HTML with local headless-browser screenshots, not the in-app Browser plugin, before delivery.

## Deliverable Format Standard

Follow `../../references/deliverable-format-policy.md` before creating files. Always identify the hero deliverable first: standalone HTML buyer-universe report, XLSX workbook, native deck/document, generated folder, or justified chat-only answer. Do not create Markdown report files as the default rich deliverable. Do not present JSON contracts, manifests, run logs, or handoff payloads as the main user-facing output. Keep CSV files as backing ledgers/import layers unless the user explicitly asks for CSV, and explain whether each CSV contains new analysis or only support data.

Final responses should point the user to the hero deliverable first and then briefly explain any supporting artifacts.

## Reference Map

Load only the reference needed for the current task.

- `../../references/html-artifact-standard.md`: shared HTML design, evidence, and visual-inspection standard.
- `references/workflow.md`: full execution flow, mandate modes, context handling, archetype-first build logic, and process strategy.
- `references/scoring-framework.md`: tier definitions, score treatment, override rules, wave logic, and risk-adjusted scoring nuance.
- `references/output-templates.md`: standalone HTML report, ranked table, hold register, outreach sequence, and tracker-ready export templates.
- `references/data-source-playbook.md`: source hierarchy, entity resolution, data gathering, and evidence handling.
- `references/industry-nuance.md`: sector, buyer-type, sponsor/fund, cross-border, lender, and distressed-capital nuance.
- `references/compliance-confidentiality.md`: confidentiality, antitrust, MNPI, conflicts, clean-team, sanctions, and escalation flags.
- `references/qa-checklist.md`: final MD review, HTML presentation review, and tracker handoff readiness.
- `../../references/handoff-contracts.md`: canonical downstream handoff fields.
- `../../references/evidence-label-taxonomy.md`: shared evidence/source-label taxonomy.
- `../../references/output-depth-policy.md`: analysis-depth policy; default to `extended_analysis` unless an explicit shortening condition applies.
