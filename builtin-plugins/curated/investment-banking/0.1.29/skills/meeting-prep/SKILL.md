---
name: meeting-prep
description: prepare ib meeting briefs, question lists, and debrief follow-ups. use when the user asks for call prep, buyer or lender meeting materials, diligence questions, or action tracking. do not use for full memo drafting.
---

# Meeting Prep

## Skill Configuration

### Common Skill Instructions

MANDATORY: Before searching connectors, retrieving evidence, or drafting output, read and apply the shared runtime contract in `../investment-banking/SKILL.md## Cross-Skill Runtime Contract`. Then check the router skill map and `../../references/plugin-routing-playbook.md` for adjacent skills that should be sequenced with this workflow. Do not run user-context setup or inspection during ordinary workflow work; route only explicit saved-context, source-setup, onboarding, or automation-setup requests to `../user-context/SKILL.md`.

### Source Resolution

Load `../../references/workflow-source-resolution.md`. Resolve only the catalogued source categories needed for the current meeting. Prefer a user-named source first, then one available app, connector, file, export, or pasted input that satisfies the category. Attempt the smallest useful native read only when the workflow needs that source. If a route needs auth, connection, or setup, state the practical limitation and continue from prompt context, active artifacts, pasted or exported material, and public sources when the meeting brief can still be useful. Do not inspect unrelated source categories, run broad source setup, write connector readiness, or create, read, migrate, or update `category-state.json`.

The runtime source categories below cover the catalogued Investment Banking sources. Use `references/context-and-sources.md` for the broader evidence hierarchy, including optional meeting-logistics connectors.

### Workflow Sources

When this skill uses a source category, use it for the following information. These are semantic source categories, not fixed connector names.

- `deal_materials`: VDR exports, diligence documents, process letters, and source materials needed for an active transaction or diligence meeting.
- `process_updates`: trackers, meeting notes, and internal updates needed for status, action, or debrief context.
- `relationship_counterparty_context`: relationship, buyer, lender, sponsor, and counterparty context when it changes the meeting plan.
- `market_data_public_sources`: public filings, market data, ratings, and transaction benchmarks only when they materially change the coverage angle or meeting questions.
- `models_workbooks_templates`: models, workbooks, and templates only when they materially change the meeting baseline, analysis, or follow-up.

## Relevant Dependency Categories

These are the source categories most likely to matter for this workflow. Use the router contract to resolve only the categories the task actually needs, prefer user-named sources first, and state any material source limitation.

- `Process Updates`
- `Deal Materials`
- `Relationship & Counterparty Context`
- `Market Data & Public Sources`

## Deliverable Intake

When this skill owns a new substantive user-facing artifact, before source gathering, analysis, modeling, or rendering load `../../references/deliverable-intake-policy.md` and perform its adaptive `request_user_input` preflight for materially unresolved format, depth, audience/use, or focus choices. When the user explicitly requests HTML for a meeting brief, that resolves the presentation surface to a polished standalone HTML briefing note; ask only remaining material choices. When invoked as a downstream support step within an already scoped workflow, inherit resolved preferences and do not re-prompt.

## Artifact Hierarchy

Follow `../../references/artifact-manifest-standard.md` before returning generated files. The hero deliverable must be a polished standalone HTML meeting brief, workbook, native deck/document, generated folder first-read file, or justified chat-only answer. CSV, JSON, Markdown, run logs, manifests, and handoff payloads are support artifacts unless the user explicitly asks for them. Final responses should lead with the hero deliverable, then companion deliverables, then support artifacts in one short sentence if useful.

## Plugin Workflow Routing

For broad transaction workflow prompts, read `../../references/plugin-routing-playbook.md` before selecting or sequencing skills. Use this skill as lead only in the workflows named there; when acting as support, preserve validated handoff fields, source IDs, routing metadata, and the artifact hierarchy so the hero deliverable remains the banker-facing standalone HTML brief, workbook, native deck/document, or clear first-read package.

## Trigger Boundary

Use for IB meeting briefs, call prep, diligence questions, live-meeting talk tracks, debriefs, and follow-up/action tracking from any starting point: no context, partial context, calendar invite, deck, model, memo, transcript, data room, or research packet.

Role: make the user ready for the meeting: what to know, what to ask, what not to say, what evidence to request, what decisions to drive, and what follow-ups to send.

Non-role: do not draft a full memo, build models/decks/trackers, certify circulation readiness, or overwrite source artifacts. Route full memo drafting to `memo-builder`; route process tracking to `deal-process-tracker`; route final IB material review to `ib-deck-qc`.

## Output Depth

Default to `extended_analysis`: a full prep bundle with decision frame, facts vs assumptions, source caveats, prioritized questions, diligence asks, likely pushbacks, avoid-saying items, follow-ups, and open gaps. Use a one-page, starter, or live-call brief only when the user explicitly asks for brevity, the meeting is imminent/time-boxed, or available context is too thin for a full prep without false precision. Read `../../references/output-depth-policy.md` when deciding whether to shorten.

## Output Modes

Choose the meeting mode that best matches the purpose rather than treating every meeting as diligence:

- `coverage_meeting`: introductory or relationship-development meeting with a public or private-company client. Lead with relationship objective, informed coverage angle, mandate triggers, three to five questions to land, no more than two or three conditional follow-up prompts, internal guardrails, and one preferred permissioned next step. Use limited alternative next steps only when distinct mandate triggers warrant different follow-up work. Do not turn an introductory call into an exhaustive diligence questionnaire or process tracker.
- `transaction_or_diligence_meeting`: active process, lender, buyer, sponsor, management diligence, or decision-gate meeting. Include detailed question/evidence matrices, issues, decisions, owners, and follow-ups as required.
- `debrief_or_follow_up`: completed meeting. Capture confirmed facts, changed assumptions, commitments, process implications, and owned actions; create a tracker handoff only for concrete process events.
- `live_call_brief`: imminent/time-boxed meeting or explicitly concise request. Produce a short, usable call sheet and identify what remains unverified.

## Fast Workflow

1. Determine mode: build from scratch, refresh prep, turn analysis into call prep, prepare for a specific meeting, prepare follow-ups, or review/upgrade an existing packet.
2. Infer meeting type, audience, circulation mode, objective, decision needed, and likely agenda. Ask only for details that materially change the output.
3. Build the context pack from the prompt, active artifacts, connected apps, trusted internal sources, source financials/models/materials, and public sources only when needed.
4. Handle sparse context without stalling: produce a starter brief with assumptions and data asks; for conflicts, mark "verify before meeting."
5. Compose with the narrowest relevant finance skill when specialized analysis is needed; do not duplicate model, valuation, credit, covenant, deck, source-of-truth, or process-tracker work.
6. Create the brief in the selected mode: decision frame, verified facts vs assumptions, top questions, targeted evidence asks, likely pushbacks or listening signals, avoid-saying items, and follow-ups. In `coverage_meeting`, consolidate questions rather than repeating the same themes in multiple topic tables.
7. For completed meetings, produce a debrief with decisions, new facts, changed assumptions, diligence requests, commitments, owners, due dates, dependencies, and draft follow-up language when useful.
8. Apply non-destructive artifact rules and run the quality bar before finalizing.

## Sub-agent decomposition

For complex medium/large requests, use sub-agents where available; otherwise emulate the split as named workstreams. Suggested lanes: source pack, counterparty context, diligence questions, banker talking points, and follow-up tracker. Keep this skill as the lead: reconcile conflicts, source labels, assumptions, open items, final QA, and the user-facing answer.


## Artifact Contract

Default prep bundle: meeting objective, likely agenda, must-know context, recommended stance, facts vs assumptions, questions ordered by decision impact, evidence asks, likely pushbacks or listening signals, action tracker, source log, and open gaps.

Questions must be specific, decision-linked, and ordered. For important questions, include why it matters, what answer would change the analysis, what evidence would verify it, likely evasive answer/follow-up, or owner/source to verify after the call.

For `coverage_meeting`, the first-read brief should answer: why this meeting matters now, what strategic/financing angle is worth testing, which few questions earn a second conversation, what mandate trigger to listen for, what not to presume, and what permissioned next step to request. Keep deeper issue trees and supporting diligence questions secondary rather than presenting three long overlapping priority-question tables as the core meeting script. Limit secondary prompts to two or three conditional follow-ups tied to management signals surfaced during the meeting. Present one recommended next step; include no more than two alternatives only where different observed triggers would lead to different work.

Memo handoff: export `meeting_prep_to_memo_builder` from `../../references/handoff-contracts.md` when prep or debrief should become a memo. Validate against `../../schemas/meeting_prep_to_memo_builder.schema.json`.

Tracker handoff: export `meeting_prep_to_deal_process_tracker` from `../../references/handoff-contracts.md` only when a meeting creates a concrete process event. Validate against `../../schemas/meeting_prep_to_deal_process_tracker.schema.json`. General impressions must be labeled `qualitative_signal` and source-noted.

## Standalone HTML Path

When HTML is requested or selected, produce a polished standalone HTML meeting brief following `../../references/html-artifact-standard.md`. This skill owns the brief hierarchy, writing, and presentation. Do not route an ordinary meeting-prep HTML brief through `dashboard-builder`, create a dashboard render contract, or force the preparation into fixed dashboard modules.

For an introductory coverage or management meeting, use this first-read hierarchy:

1. Meeting objective and recommended posture: what relationship or mandate outcome the banker should seek, without implying an existing mandate or financing need.
2. Must-know snapshot: a compact set of sourced operating, capital-allocation, liquidity, or strategic facts that change the conversation.
3. Coverage angles and mandate triggers: growth priorities, M&A/build-versus-buy, capital-markets relevance, and the concrete management signal that would justify follow-up work.
4. Questions to land: one compact prioritized table, normally three to five core questions plus no more than two or three conditional follow-up prompts tied to management signals; do not repeat the same topic across multiple long tables.
5. Talk track, guardrails, and next step: a credible opening/close, internal-only do-not-say items, missing relationship/logistics context, and one recommended permissioned next step with no more than two trigger-specific alternatives when needed.
6. Evidence and limitations: readable point-of-use citations and a concise source register.

Keep public-source analysis, inferred banking opportunities, internal strategy, and management-confirmed interest visibly distinct. Avoid generic dashboard navigation, persistent action bars, visible renderer plumbing, or broad diligence registers that make a first meeting feel like an active transaction process.

## Source, Safety, And Evidence Posture

Do not ask the user for context that can be retrieved from enabled connectors. Preserve source artifacts unless the user explicitly asks for edits; prefer new briefs, comments, speaker notes, copied sections, appended trackers, or change logs.

Separate facts, assumptions, recommendations, and meeting strategy. Do not fabricate attendees, decisions, financials, metrics, source provenance, or commitments.

## Validated Handoffs

<!-- GENERATED: validated-handoffs START -->

Producer contracts:
- `meeting_prep_to_deal_process_tracker` -> `deal-process-tracker`. Schema: `../../schemas/meeting_prep_to_deal_process_tracker.schema.json`. Validate with `../../scripts/validate_handoff_payload.py meeting_prep_to_deal_process_tracker handoffs/meeting_prep_to_deal_process_tracker.json` before another skill imports it.
- `meeting_prep_to_memo_builder` -> `memo-builder`. Schema: `../../schemas/meeting_prep_to_memo_builder.schema.json`. Validate with `../../scripts/validate_handoff_payload.py meeting_prep_to_memo_builder handoffs/meeting_prep_to_memo_builder.json` before another skill imports it.

Use `../../references/handoff-contracts.md` for canonical field names and shared evidence semantics. Add `--strict` before any model, deck, committee, lender, board, or client-circulation use so placeholders, empty arrays, and empty objects fail instead of becoming assumptions.

Handoff payloads belong under `handoffs/` and must be listed in `manifest.json` as support or agent artifacts with `handoff_contract_name`, `schema_path`, `validator_status`, `validated_at`, and `consumer_skill`. They are never the hero deliverable unless the user explicitly asks for machine-readable output.

<!-- GENERATED: validated-handoffs END -->
## Script Map

Deterministic standalone artifact scaffold:

- `scripts/build_meeting_prep_packet.py --input <intake.json> --output-dir <output-dir>`

For downstream handoff validation, use:

- `../../scripts/validate_handoff_payload.py meeting_prep_to_memo_builder <payload.json>`
- `../../scripts/validate_handoff_payload.py meeting_prep_to_deal_process_tracker <payload.json>`

## HTML Evidence Readiness

For senior, client, committee, board, lender, or external postures, every material number, estimate, date-sensitive fact, sourced claim, assumption, and recommendation must have readable point-of-use citation support. Unknown citation IDs, missing source registers, uncited material numerical claims, unsupported mandate implications, or unverified relationship claims are blocking readiness gaps: fix them, downgrade the posture to draft/internal working team, or surface the gaps explicitly.

For an HTML meeting brief:

- Cite complete facts and metric phrases close to where they inform the stance or question plan; do not rely only on a source appendix.
- State when attendees, prior relationship history, agenda, restricted-list/compliance posture, or bank-specific context were not provided; do not invent them.
- Distinguish a public-source inferred opportunity from management-confirmed interest, an active mandate, financing need, or M&A process.
- Use internal-only do-not-say guidance only in a clearly marked internal working brief, never in external-clean material.
- Render and visually inspect local HTML with local headless-browser screenshots, not the in-app Browser plugin, before delivery.

## Deliverable Format Standard

Follow `../../references/deliverable-format-policy.md` before creating files. Always identify the hero deliverable first: polished standalone HTML meeting brief, workbook, native deck/document, generated folder, or justified chat-only answer. Do not create Markdown report files as the default rich deliverable. Do not present JSON contracts, manifests, run logs, or handoff payloads as the main user-facing output. Keep CSV files as backing ledgers/import layers unless the user explicitly asks for CSV, and explain whether each CSV contains new analysis or only support data.

Final responses should point the user to the hero deliverable first and then briefly explain any supporting artifacts.

## Reference Map

- `references/meeting-type-playbooks.md`: read when meeting type, persona, use case, or companion-skill routing matters.
- `references/context-and-sources.md`: read for context gathering, connector/source order, stale-data checks, citation behavior, source conflicts, and no-context handling.
- `references/output-templates.md`: read for detailed prep packets, debriefs, follow-up trackers, live talk tracks, and one-page/starter formats only when shortening is justified.
- `references/question-and-diligence-bank.md`: read when generating pointed diligence questions, evidence asks, pushback follow-ups, or avoid-asking topics.
- `references/follow-up-and-action-tracking.md`: read for post-meeting debrief mode, action tracker fields, status taxonomy, owners, due dates, and non-destructive tracker updates.
- `references/safety-and-integrations.md`: read for artifact safety, internal-vs-external circulation, sensitive topics, companion-skill routing, and final checks.
- `../../references/html-artifact-standard.md`: shared HTML design, evidence, and local visual-inspection standard.
- `../../references/handoff-contracts.md`: read when exporting exact fields to `memo-builder` or `deal-process-tracker`.
- `../../references/evidence-label-taxonomy.md`: read when mapping meeting facts, assumptions, judgments, and source notes to shared evidence labels.
- `../../references/output-depth-policy.md`: read when deciding whether a one-page or live-call format is justified; default to `extended_analysis`.

## Runtime Artifact Path

Default deterministic builder: `scripts/build_meeting_prep_packet.py`. Primary human deliverable is the standalone `meeting_prep_packet.html`; `meeting_prep_packet.docx` is the native document companion when generated. Support artifacts live under `support/` and include the intake JSON. The builder is a lightweight artifact scaffold; substantive briefs should apply the selected mode, full source work, and visual review. Senior-ready status requires attendee/source confidence, circulation-appropriate guardrails, open evidence asks, and no uncited material claims in the first-read brief.
