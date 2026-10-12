---
name: memo-builder
description: draft or review investment-banking memos from existing analysis. use when the user wants a client, committee, board, financing, process, or diligence note. do not use to build source models, decks, trackers, or tearsheets.
---

# Memo Builder

## Skill Configuration

### Common Skill Instructions

MANDATORY: Before searching connectors, retrieving evidence, or drafting output, read and apply the shared runtime contract in `../investment-banking/SKILL.md## Cross-Skill Runtime Contract`. Then check the router skill map and `../../references/plugin-routing-playbook.md` for adjacent skills that should be sequenced with this workflow. Do not run user-context setup or inspection during ordinary workflow work; route only explicit saved-context, source-setup, onboarding, or automation-setup requests to `../user-context/SKILL.md`.

### Source Resolution

Load `../../references/workflow-source-resolution.md`. Resolve only the categories needed for this workflow: `deal_materials`, `process_updates`, `relationship_counterparty_context`, `market_data_public_sources`, and `models_workbooks_templates`. Use the shared runtime contract to map each attempted category to an available app, connector, file, export, or user-provided input.

## Relevant Dependency Categories

These are the source categories most likely to matter for this workflow. Use the router contract to resolve only the categories the task actually needs, prefer user-named sources first, and state any material source limitation.

- `Deal Materials`
- `Process Updates`
- `Market Data & Public Sources`
- `Models, Workbooks & Templates`
- `Relationship & Counterparty Context`

## Deliverable Intake

When this skill owns a new substantive user-facing artifact, before source gathering, analysis, modeling, or rendering load `../../references/deliverable-intake-policy.md` and perform its adaptive `request_user_input` preflight for materially unresolved preferences. When invoked as a downstream support step within an already scoped workflow, inherit resolved preferences and do not re-prompt.

## Artifact Hierarchy

Follow `../../references/artifact-manifest-standard.md` before returning generated files. For substantial memo work, the selected or high-confidence inferred surface controls the hero deliverable: formal banker, committee, board, client, or lender memos usually use a real Word document; source-heavy web-style reports usually use polished standalone HTML; quick narrow notes may stay inline. If the surface is semi-ambiguous, use `../../references/deliverable-intake-policy.md` before drafting and let the chosen or timeout-resolved option control the manifest primary. CSV, JSON, Markdown, run logs, manifests, and handoff payloads are support artifacts unless the user explicitly asks for them. Final responses should lead with the hero deliverable, then companion deliverables, then support artifacts in one short sentence if useful.

## Plugin Workflow Routing

For broad transaction workflow prompts, read `../../references/plugin-routing-playbook.md` before selecting or sequencing skills. Use this skill as lead only in the workflows named there; when acting as support, preserve validated handoff fields, source IDs, routing metadata, and the artifact hierarchy so the hero deliverable remains the banker-facing selected memo surface, workbook, native deck/document, or clear first-read package.

## Trigger Boundary

Use this skill when the user wants model outputs, CIM claims, diligence findings, buyer feedback, meeting notes, process status, or other Investment Banking analysis converted into a decision-ready memo for a client, MD, committee, board, lender, sponsor, issuer, or deal team.

Use it for client recommendations, committee approval notes, board or special committee notes, ECM/DCM/LevFin/private-placement framing, lender or credit committee support, transaction updates, process summaries, diligence synthesis, management-call readouts, one-page banking notes, and banker-readiness reviews of existing memos.

Do not use it when the primary request is to build a source model, CIM, teaser, pitch deck, buyer list, process tracker, company tearsheet, or final deck/report circulation QC. Route those requests to the appropriate upstream skill first, then return here for memo synthesis if needed.

Do not provide personal investment advice, trading advice, legal advice, tax advice, accounting advice, fairness opinions, or account-specific portfolio recommendations.

## Role / Non-Role

Role: act as the synthesis layer that turns existing banker analysis into a memo with explicit evidence, judgment, open items, and next steps.

Non-role: do not invent the analysis, build the model, create the CIM, run the buyer list, manage the process tracker, or certify final circulation readiness. If the memo may circulate externally, to a board, to a committee, or to lenders, mark `ib_deck_qc_required: yes` and route final-circulation candidates to `ib-deck-qc`.

Default output for substantial memo work: an `extended_analysis` memo in the selected or high-confidence inferred surface, with readable point-of-use citations and any model-derived claims tied to source IDs or workbook cells/ranges where available. For a new internal transaction memo, committee memo, board memo, client memo, or lender memo with no high-confidence surface, ask the format question and normally recommend `Word document (.docx)`. For a source-heavy web-style memo or explicit HTML request, use polished standalone HTML. Use concise chat only for narrow answers, quick follow-ups, or a cover note for a richer deliverable. Use one-page, transaction-update, or brief formats only when the user explicitly asks for that shorter form, the memo is a narrow delta against an existing full artifact, or the response is a cover note for a richer deliverable. Read `../../references/output-depth-policy.md` before shortening.

## Fast Workflow

1. Classify the memo mode, audience, circulation posture, decision or question, time sensitivity, and source scope.
2. Build the source packet from user-provided files, prior outputs, connected apps, models, decks, trackers, notes, and source-of-truth records before asking for more.
3. Read only the needed references:
   - mode selection and the seven memo templates in [references/memo-modes-and-templates.md](references/memo-modes-and-templates.md)
   - upstream skill handoffs and import payloads in [references/upstream-handoffs-and-imports.md](references/upstream-handoffs-and-imports.md)
   - QA, readiness checks, and examples in [references/quality-checks-and-examples.md](references/quality-checks-and-examples.md)
   - applicable sector overlays in [references/sector-overlays.md](references/sector-overlays.md)
4. Establish the memo plan using the artifact contract below.
5. Identify the decision hinge, the 3-5 load-bearing claims, and the evidence or model output behind each.
6. Draft in the selected mode, keeping background subordinate to decision usefulness.
7. Run memo QA for sources, numbers, scenario consistency, open items, caveats, audience fit, and downstream handoff.
8. Route final-circulation candidates to `ib-deck-qc`; use `style-guide-adapter` only for format, tone, and precedent alignment after content is correct.

## Standalone HTML Path

For an ordinary internal deal-team, client-draft, committee-draft, or board-draft memo delivered as HTML, produce a polished standalone HTML memo following `../../references/html-artifact-standard.md`. For a memo delivered as DOCX, create a real full Word memo with the same decision spine, evidence posture, risks, diligence asks, and source limitations; do not treat DOCX as a thin companion to an HTML-first artifact. This skill owns the memo hierarchy, recommendation, reliance posture, evidence presentation, risk framing, and diligence asks. Do not route an ordinary HTML memo through `dashboard-builder`, create a dashboard render contract, or force the memo into generic dashboard modules.

Make the first read feel like a banker decision memo:

- open with the recommendation, reliance posture, decision hinge, source scope, and the few transaction or financial facts needed to orient the reader;
- organize the body around transaction snapshot, supported rationale, projections or model implications, key risks, diligence required before reliance, and next actions;
- distinguish disclosed transaction projections, management or seller claims, banker calculations, model outputs, and banker judgment in reader-facing language;
- keep the memo plan, manifest, render inputs, JSON support records, and internal control plumbing outside the visible report unless the user asks for them;
- use compact tables only where they sharpen the decision; do not add generic reader-action bars, navigation shells, repeated copy/export controls, or related-files panels by default.

The memo may include HTML and DOCX companions when useful, but the selected or timeout-resolved surface remains the hero. If the user explicitly requests a dashboard, route that distinct presentation request separately without making it the ordinary memo path.

## Sub-agent decomposition

For complex medium/large requests, use sub-agents where available; otherwise emulate the split as named workstreams. Suggested lanes: model outputs, diligence findings, process status, evidence register, and final synthesis. Keep this skill as the lead: reconcile conflicts, source labels, assumptions, open items, final QA, and the user-facing answer.


## Artifact Contract

Every memo should carry this lightweight memo plan, even if it is only implicit in the chat output:

- `memo_type`
- `audience`
- `circulation`: internal draft, client draft, committee draft, board draft, lender draft, or final-circulation candidate
- `decision_or_question`
- `source_scope`
- `source_as_of_dates`
- `model_outputs_used`
- `key_numbers_to_tie`
- `style_profile_package`: optional, from `style_guide_adapter_style_profile`
- `style_change_log_package`: optional, from `style_guide_adapter_change_log`
- `open_items`
- `recommended_next_step`
- `ib_deck_qc_required`: yes for any external, board, committee, lender, or client-facing use

The memo plan is a control layer, not permission to make the memo thin. Preserve evidence labels, source dates, open items, key numbers to tie, and recommended next steps unless the user explicitly requests a shorter answer.

Use these posture labels:

- `final-circulation-candidate`: evidence-supported, internally consistent, and ready for `ib-deck-qc`.
- `senior-review-ready`: good draft, but needs MD/client-team review before circulation.
- `client-draft`: useful client-facing draft with open items disclosed.
- `screen-grade`: useful for early discussion but not ready for external or committee use.
- `blocked`: missing source/model/context prevents a defensible memo.

## Source And Evidence Posture

- Never invent facts, financials, buyer feedback, valuation ranges, debt terms, process status, board decisions, or diligence findings.
- Every material number needs a source, model output, or explicit assumption.
- If a model output is used, cite its model status, date, scenario, and any hard failures or material warnings.
- Separate reported facts, management claims, seller claims, model outputs, banker judgment, and assumptions.
- When relying only on transaction filings, characterize strategic rationale as `disclosed`, `stated`, or `board-considered`; do not say the filings support or validate the strategic logic unless independent evidence substantiates that conclusion.
- Use `financial-source-of-truth` when source hierarchy, conflicts, stale data, or fact/assumption labels matter.
- Use `financials-normalizer` before relying on messy financials, adjusted EBITDA, NWC, debt schedules, or KPI tables.
- If any upstream handoff is missing source dates, evidence labels, or circulation caveats, keep the memo at `screen-grade` or `senior-review-ready` and list the missing fields in `open_items`.

## Validated Handoffs

<!-- GENERATED: validated-handoffs START -->

Intake validation:
- From `company-tearsheet`: require `company_tearsheet_to_memo_builder` and run `../../scripts/validate_handoff_payload.py company_tearsheet_to_memo_builder handoffs/company_tearsheet_to_memo_builder.json` before importing fields into this skill.
- From `meeting-prep`: require `meeting_prep_to_memo_builder` and run `../../scripts/validate_handoff_payload.py meeting_prep_to_memo_builder handoffs/meeting_prep_to_memo_builder.json` before importing fields into this skill.
- From `cim-teardown`: require `cim_teardown_to_memo_builder` and run `../../scripts/validate_handoff_payload.py cim_teardown_to_memo_builder handoffs/cim_teardown_to_memo_builder.json` before importing fields into this skill.
- From `distressed-recovery-waterfall`: require `distressed_recovery_waterfall_to_memo_builder` and run `../../scripts/validate_handoff_payload.py distressed_recovery_waterfall_to_memo_builder handoffs/distressed_recovery_waterfall_to_memo_builder.json` before importing fields into this skill.
- From `style-guide-adapter`: require `style_guide_adapter_style_profile` and run `../../scripts/validate_handoff_payload.py style_guide_adapter_style_profile handoffs/style_guide_adapter_style_profile.json` before importing fields into this skill.
- From `style-guide-adapter`: require `style_guide_adapter_change_log` and run `../../scripts/validate_handoff_payload.py style_guide_adapter_change_log handoffs/style_guide_adapter_change_log.json` before importing fields into this skill.

Use `../../references/handoff-contracts.md` for canonical field names and shared evidence semantics. Add `--strict` before any model, deck, committee, lender, board, or client-circulation use so placeholders, empty arrays, and empty objects fail instead of becoming assumptions.

Handoff payloads belong under `handoffs/` and must be listed in `manifest.json` as support or agent artifacts with `handoff_contract_name`, `schema_path`, `validator_status`, `validated_at`, and `consumer_skill`. They are never the hero deliverable unless the user explicitly asks for machine-readable output.

<!-- GENERATED: validated-handoffs END -->
## Script Map

Use upstream Investment Banking and Financial Markets skills for deterministic model, diligence, valuation, process, and source-of-truth work, then use this skill to synthesize those outputs into memo form. When deterministic packaging from structured memo inputs is appropriate, use `scripts/build_memo_package.py --primary-format html` or `scripts/build_memo_package.py --primary-format docx` according to the selected memo surface.

For structured upstream packages, validate exact field names before relying on them as automation boundaries:

- `../../scripts/validate_handoff_payload.py company_tearsheet_to_memo_builder <payload.json>`
- `../../scripts/validate_handoff_payload.py meeting_prep_to_memo_builder <payload.json>`

## HTML Evidence Readiness

For senior, client, committee, board, lender, or external circulation postures, every material number, estimate, date-sensitive fact, sourced claim, assumption, and recommendation in the standalone HTML memo must have readable point-of-use citation support. Model-derived claims should cite the workbook, scenario, status, sheet, and cell or range where available.

Unknown sources, missing source registers, unsupported material numerical claims, or unlabeled projection/model assumptions are blocking readiness gaps. Fix them, downgrade the posture to draft or `screen-grade`, or surface the missing support as an explicit diligence gap; do not call the memo ready for the intended circulation audience while those gaps remain.

For a standalone HTML memo:

- label disclosed projections and synergy cases as disclosed or management/seller cases until diligence establishes an underwritten case;
- keep derived calculations and banker judgments visibly distinct from reported facts and quoted model outputs;
- render and visually inspect the local HTML through local headless-browser screenshots rather than the in-app Browser plugin, checking the opening viewport and the most decision-critical tables or diligence sections;
- check hierarchy, table legibility, clipping, density, citation noise, and whether the requested decision is clear before delivery.

## Deliverable Format Standard

Follow `../../references/deliverable-format-policy.md` before creating files. Always identify the hero deliverable first: standalone HTML memo, XLSX workbook, native deck/document, generated folder, or justified chat-only answer. Do not create Markdown report files as the default rich deliverable. Do not present JSON contracts, manifests, run logs, render inputs, or handoff payloads as the main user-facing output. Keep CSV files as backing ledgers/import layers unless the user explicitly asks for CSV, and explain whether each CSV contains new analysis or only support data.

Final responses should point the user to the hero deliverable first and then briefly explain any supporting artifacts.

## Reference Map

- [references/memo-modes-and-templates.md](references/memo-modes-and-templates.md): read when choosing a memo mode, drafting from a mode-specific structure, or converting a user request into one of the seven standard memo templates.
- [references/upstream-handoffs-and-imports.md](references/upstream-handoffs-and-imports.md): read when consuming outputs from company tearsheets, CIM teardown, meeting prep, buyer/investor lists, process trackers, models, underwriting, covenant, capital markets, or restructuring workflows.
- [references/quality-checks-and-examples.md](references/quality-checks-and-examples.md): read before calling a memo senior-review-ready or final-circulation-candidate, when reviewing an existing memo, or when examples of memo-plan and evidence-label handling would help.
- [references/sector-overlays.md](references/sector-overlays.md): read only when the target clearly matches healthcare workflow/payments software, consumer internet/marketplace, or specialty materials/industrial carve-out.
- [../../references/html-artifact-standard.md](../../references/html-artifact-standard.md): shared standalone HTML design, evidence, and local visual-inspection standard.
- [../../references/handoff-contracts.md](../../references/handoff-contracts.md): read when exact upstream field names, shared package names, or cross-skill contract parity matters.
- [../../references/evidence-label-taxonomy.md](../../references/evidence-label-taxonomy.md): read when mapping upstream source labels, memo evidence labels, assumptions, and banker judgment into the shared taxonomy.
- [../../references/output-depth-policy.md](../../references/output-depth-policy.md): read when deciding whether one-page or transaction-update depth is justified; default to `extended_analysis`.

## Runtime Artifact Path

Default deterministic builder: `scripts/build_memo_package.py`. The selected or high-confidence inferred surface controls the primary human deliverable: `investment_memo.docx` for DOCX-selected formal memo circulation or `investment_memo.html` for HTML-selected web-style reports. The other surface may be generated as a companion. Support artifacts live under `support/` and include memo-plan or calculation-support JSON where needed; do not create a dashboard render contract for an ordinary memo. Committee/client-ready status requires source posture, model tie-outs, open issues, readable citation support, and downstream `ib-deck-qc` where required; unresolved material citations force draft posture.
