---
name: deal-process-tracker
description: Build, update, or reconstruct IB deal-process trackers in a banker-facing workbook. Use for buyer progression, outreach, NDAs, access, diligence, bids, deadlines, process status, or proxy-disclosed sale-process chronology. Do not use to create buyer universes from scratch or write narrative HTML reports.
---

# Deal Process Tracker

## Skill Configuration

### Common Skill Instructions

MANDATORY: Before searching connectors, retrieving evidence, or drafting output, read and apply the shared runtime contract in `../investment-banking/SKILL.md## Cross-Skill Runtime Contract`. Then check the router skill map and `../../references/plugin-routing-playbook.md` for adjacent skills that should be sequenced with this workflow. Do not run user-context setup or inspection during ordinary workflow work; route only explicit saved-context, source-setup, onboarding, or automation-setup requests to `../user-context/SKILL.md`.

### Source Resolution

Load `../../references/workflow-source-resolution.md`. Resolve only the categories needed for this workflow: `deal_materials`, `process_updates`, `relationship_counterparty_context`, and `models_workbooks_templates`. Use the shared runtime contract to map each attempted category to an available app, connector, file, export, or user-provided input.

## Relevant Dependency Categories

These are the source categories most likely to matter for this workflow. Use the router contract to resolve only the categories the task actually needs, prefer user-named sources first, and state any material source limitation.

- `Process Updates`
- `Deal Materials`
- `Relationship & Counterparty Context`

## Deliverable Intake

When this skill owns a new substantive user-facing artifact, before source gathering, analysis, modeling, or rendering load `../../references/deliverable-intake-policy.md` and perform its adaptive `request_user_input` preflight for materially unresolved preferences. When invoked as a downstream support step within an already scoped workflow, inherit resolved preferences and do not re-prompt.

## Artifact Hierarchy

Follow `../../references/artifact-manifest-standard.md` before returning generated files. For a substantive process build, update, or reconstruction, the hero deliverable is a polished XLSX tracker with an executive `Dashboard` first tab. CSV, JSON, Markdown, run logs, manifests, and handoff payloads are support artifacts unless the user explicitly asks for them. Final responses should lead with the hero deliverable, which is the workbook here, then support artifacts in one short sentence if useful.

## Plugin Workflow Routing

For broad transaction workflow prompts, read `../../references/plugin-routing-playbook.md` before selecting or sequencing skills. Use this skill as lead only in the workflows named there; when acting as support, preserve validated handoff fields, source IDs, routing metadata, and the artifact hierarchy so the hero deliverable remains the banker-facing workbook. Route a user request for a narrative HTML process report or board-style memo to `memo-builder`, using the tracker workbook or extracted process facts as source material; route a requested presentation to `pitch-deck-builder`.

## Trigger Boundary

Use for building, updating, or reconstructing IB deal-process trackers: buyer funnel, outreach, NDAs, materials access, diligence, process letters, IOIs/LOIs, bids, owners, dates, status, open issues, senior escalation, or public-filing chronology of a completed or signed sale process.

Role: maintain the process-execution spine or reconstruct disclosed process history, turning fragmented process facts into a workbook with source-backed status, MD judgment, risk, decision points, and change history where applicable.

Non-role: do not create the initial buyer universe from scratch, send outreach, grant materials access, provide legal advice, or silently overwrite historical tracker data. Use `buyer-investor-list` for universe creation and specialist skills for modeling, credit, covenant, deck, memo, and QC work.

## Fast Workflow

1. Choose workbook use case: live-process build, partial-context structuring, existing-tracker update, public-process reconstruction, executive/process update, or bid/round decision support.
2. Frame the process: transaction type, seller/client, asset, stage, buyer mix, confidentiality posture, public/private status, counsel/legal dependencies, deadlines, and decision point.
3. Gather and reconcile sources from prompt, uploaded files, existing tracker, callable connected routes, user-provided exports, deal docs, meeting notes, and public sources only when needed.
4. Normalize buyer names, stages, statuses, dates, owners, deadlines, risk levels, confidence labels, and tracker modules using `references/tracker-schema.md`.
5. Build or update the executive `Dashboard` tab, buyer master, contacts, outreach, NDA, document access, diligence, calendar, bids, issues/escalations, change log, sources, and definitions as needed.
6. Apply MD judgment to buyer credibility, process momentum, competitive tension, bid likelihood, confidentiality risk, stale items, and intervention needs.
7. Produce the right output view and run QA for missing owners, stale buyers, unsupported bid values, NDA/access conflicts, open diligence, and fact/inference labeling.

## Sub-agent decomposition

For complex medium/large requests, use sub-agents where available; otherwise emulate the split as named workstreams. Suggested lanes: party/status updates, materials and NDA status, diligence/bid milestones, owner actions, and process risks. Keep this skill as the lead: reconcile conflicts, source labels, assumptions, open items, final QA, and the user-facing answer.


## Artifact Contract

Default workbook content for a tracker build, refresh, or reconstruction:

1. Executive command view: process health, buyer funnel, priority buyers, upcoming deadlines, key risks, client decisions, and MD interventions.
2. Operating tracker: buyer master, outreach, NDA, document access, diligence, calendar, bids, issues, and change log.
3. Judgment layer: buyer credibility, bid likelihood, competitive tension, risk-adjusted bid quality, process risk, confidentiality risk, and escalation recommendations.

Default to `extended_analysis` even for chat answers: include the executive command view, operating tracker logic, judgment layer, source/caveat notes, change-log posture, and next actions that matter. Use compact markdown tables and bullets only when the user explicitly asks for a short update, the task is a narrow delta to an existing full tracker, or the response is a cover note for the workbook. Create or update a polished workbook with separate operating tabs and an executive `Dashboard` first tab. Read `../../references/output-depth-policy.md` before shortening.

This skill is workbook-owned. Do not create an automatic HTML companion, dashboard render contract, or dashboard-builder package for an ordinary tracker request. If the user primarily wants a narrative HTML executive summary, board process review, or reader-facing process memo, route to `memo-builder`; the tracker may provide source-backed schedules or a workbook companion when useful.

### Public-Process Reconstruction

When the source is a definitive proxy, merger filing, board disclosure, or similar public record rather than a live deal-team tracker, build a retrospective workbook that clearly states the disclosed scope. Include the executive conclusion, bidder progression, timeline, access or solicitation gates, bid and price progression, go-shop or no-shop mechanics where applicable, competitive-tension assessment, sources, and limitations. Distinguish filed facts from banker inference and counsel-review issues. Do not invent live owners, outreach tasks, or unresolved operating statuses merely to fill a tracker template.

Import from `buyer-investor-list`: consume `buyer_investor_list_to_deal_process_tracker` from `../../references/handoff-contracts.md`; validate automation payloads with `../../schemas/buyer_investor_list_to_deal_process_tracker.schema.json`. If `party_id`, `tier`, `recommended_wave`, or outreach eligibility is missing, create the row as `needs_review`; preserve `holds_and_exclusions` separately.

Import from `meeting-prep`: consume `meeting_prep_to_deal_process_tracker` from `../../references/handoff-contracts.md`; validate against `../../schemas/meeting_prep_to_deal_process_tracker.schema.json`. Translate only concrete process events into tracker deltas and preserve prior status, reason, date, and source.

## Source, Safety, And Evidence Posture

Use the user's prompt, existing tracker/workbook, deal artifacts, callable connected routes, user-provided exports, and uploaded documents first. Use web only as fallback for public/company/market facts. Cite sources when used.

Never delete or overwrite silently. Preserve rows, fields, notes, bid values, dates, and history unless explicitly requested; for updates, add a change log with prior value, new value, source, confidence, and review flag.

Separate confirmed facts, inferences, unverified items, conflicts, and recommendations. Respect NDA, clean-team, competitor, public-company, antitrust, employee, customer, pricing, MNPI, and legal-process sensitivities. Do not act on behalf of the deal team unless explicitly asked and supported by the environment.

## Validated Handoffs

<!-- GENERATED: validated-handoffs START -->

Intake validation:
- From `buyer-investor-list`: require `buyer_investor_list_to_deal_process_tracker` and run `../../scripts/validate_handoff_payload.py buyer_investor_list_to_deal_process_tracker handoffs/buyer_investor_list_to_deal_process_tracker.json` before importing fields into this skill.
- From `meeting-prep`: require `meeting_prep_to_deal_process_tracker` and run `../../scripts/validate_handoff_payload.py meeting_prep_to_deal_process_tracker handoffs/meeting_prep_to_deal_process_tracker.json` before importing fields into this skill.

Use `../../references/handoff-contracts.md` for canonical field names and shared evidence semantics. Add `--strict` before any model, deck, committee, lender, board, or client-circulation use so placeholders, empty arrays, and empty objects fail instead of becoming assumptions.

Handoff payloads belong under `handoffs/` and must be listed in `manifest.json` as support or agent artifacts with `handoff_contract_name`, `schema_path`, `validator_status`, `validated_at`, and `consumer_skill`. They are never the hero deliverable unless the user explicitly asks for machine-readable output.

<!-- GENERATED: validated-handoffs END -->
## Script Map

For deterministic tracker workbook materialization, use `scripts/build_process_tracker.py`. For import validation, use:

- `../../scripts/validate_handoff_payload.py buyer_investor_list_to_deal_process_tracker <payload.json>`
- `../../scripts/validate_handoff_payload.py meeting_prep_to_deal_process_tracker <payload.json>`

## Workbook Evidence Readiness

For senior, client, committee, board, lender, or external postures, every material number, date-sensitive fact, sourced claim, assumption, and recommendation in the workbook must be traceable at the point of use through a source ID, source column, source note, or clearly linked source register. For analysis derived from workbook calculations, retain readable inputs and formulas or calculation support.

Unknown source IDs, missing source registers, unsupported bid values or deadlines, unlabeled banker inferences, or unresolved legal/process-fairness conclusions are blocking readiness gaps. Fix them, downgrade the posture to draft or working-team use, or surface the missing support explicitly; do not call the workbook senior/client/committee/board/external-ready while those gaps remain.

Before delivering a substantive tracker workbook, inspect key ranges, scan for formula errors where formulas are present, and render and visually inspect the executive `Dashboard` and material operating tabs. Long operating tables should use frozen header rows and filters or structured tables where feasible; timelines, bid grids, and issue logs must remain legible at normal zoom.

## Presentation Boundary

This skill does not own a narrative HTML report mode. When the user explicitly requests an HTML report, board-style process narrative, or standalone presentation layer, preserve the tracker as the process source and route the reader-facing synthesis to `memo-builder` or `pitch-deck-builder` as appropriate. Do not route an ordinary process tracker through `dashboard-builder`.

## Deliverable Format Standard

Follow `../../references/deliverable-format-policy.md` before creating files. For a substantive request owned by this skill, identify the XLSX tracker workbook as the hero deliverable. Do not create Markdown or HTML reports as the default deliverable, and do not present JSON contracts, manifests, run logs, or handoff payloads as the main user-facing output. Keep CSV files as backing ledgers/import layers unless the user explicitly asks for CSV, and explain whether each CSV contains new analysis or only support data.

Final responses should point the user to the hero deliverable first and then briefly explain any supporting artifacts.

## Reference Map

Load references only as needed:

- `references/tracker-schema.md`: read when creating/updating tracker modules, workbook tabs, fields, controlled values, and structured tables.
- `references/md-judgment.md`: read when ranking buyers, flagging risks, deciding escalation, comparing bids, or summarizing process health.
- `references/source-handling.md`: read when extracting from emails/docs/calendars, reconciling conflicts, preserving history, or updating an existing tracker.
- `references/output-templates.md`: read when designing workbook views for MD summaries, weekly client updates, board updates, buyer assessments, bid reviews, tracker build/update summaries, or public-process reconstructions.
- `references/quality-checks.md`: read before finalizing any tracker, update, recommendation, or import.
- `../../references/handoff-contracts.md`: read when importing from `buyer-investor-list` or `meeting-prep`, or when exact field-name parity matters.
- `../../references/evidence-label-taxonomy.md`: read when mapping process status, source notes, or confidence labels into shared evidence categories.
- `../../references/output-depth-policy.md`: read when deciding whether a compact process update is justified; default to `extended_analysis`.

## Runtime Artifact Path

Default deterministic builder: `scripts/build_process_tracker.py`. Primary human deliverable is `deal_process_tracker.xlsx` with an executive `Dashboard` first tab. Support artifacts live under `support/` and may include intake or source-ledger JSON; `manifest.json` is agent-facing and must identify the workbook as `first_read`. Senior-ready live trackers require current source dates, owner/status coverage for live process items, stale-date review, and open-items escalation; public-process reconstructions require disclosed-scope labeling, fact/inference separation, and explicit counsel-review flags where legal characterization matters.
