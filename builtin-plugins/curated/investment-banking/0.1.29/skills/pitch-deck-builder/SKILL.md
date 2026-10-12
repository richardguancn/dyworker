---
name: pitch-deck-builder
description: build investment-banking pitch deck outlines, page plans, and draft slide content. use when the user asks to create or refresh a banking pitch or client discussion deck. do not mark final client-ready; route final circulation qc to ib-deck-qc.
---

# Pitch Deck Builder

## Skill Configuration

### Common Skill Instructions

MANDATORY: Before searching connectors, retrieving evidence, or drafting output, read and apply the shared runtime contract in `../investment-banking/SKILL.md## Cross-Skill Runtime Contract`. Then check the router skill map and `../../references/plugin-routing-playbook.md` for adjacent skills that should be sequenced with this workflow. Do not run user-context setup or inspection during ordinary workflow work; route only explicit saved-context, source-setup, onboarding, or automation-setup requests to `../user-context/SKILL.md`.

### Source Resolution

Load `../../references/workflow-source-resolution.md`. Resolve only the categories needed for this workflow: `deal_materials`, `process_updates`, `relationship_counterparty_context`, `market_data_public_sources`, and `models_workbooks_templates`. Use the shared runtime contract to map each attempted category to an available app, connector, file, export, or user-provided input.

## Relevant Dependency Categories

These are the source categories most likely to matter for this workflow. Use the router contract to resolve only the categories the task actually needs, prefer user-named sources first, and state any material source limitation.

- `Deal Materials`
- `Market Data & Public Sources`
- `Relationship & Counterparty Context`
- `Process Updates`

## Deliverable Intake

When this skill owns a new substantive user-facing artifact, before source gathering, analysis, modeling, or rendering load `../../references/deliverable-intake-policy.md` and perform its adaptive `request_user_input` preflight for materially unresolved preferences. When invoked as a downstream support step within an already scoped workflow, inherit resolved preferences and do not re-prompt.

## Artifact Hierarchy

Follow `../../references/artifact-manifest-standard.md` before returning generated files. The hero deliverable must be a workbook, HTML report/dashboard, native deck/document, generated folder first-read file, or justified chat-only answer. CSV, JSON, Markdown, run logs, manifests, and handoff payloads are support artifacts unless the user explicitly asks for them. Final responses should lead with the hero deliverable, then companion deliverables, then support artifacts in one short sentence if useful.

## Plugin Workflow Routing

For broad transaction workflow prompts, read `../../references/plugin-routing-playbook.md` before selecting or sequencing skills. Use this skill as lead only in the workflows named there; when acting as support, preserve validated handoff fields, source IDs, routing metadata, and the artifact hierarchy so the hero deliverable remains the banker-facing workbook, HTML report/dashboard, native deck/document, or clear first-read package.

## Trigger Boundary

Use for investment banking buyer pitches, sell-side and M&A pitches, financing pitches, strategic alternatives decks, company profile decks, market maps, sector updates, capital structure discussions, and board/client meeting decks.

Role: orchestrate the pitch storyline, page architecture, source posture, draft slide content, and structured handoffs.

Non-role: do not replace full valuation/modeling/diligence skills, do not make legal/tax/accounting/securities-law conclusions, and do not mark a deck final client-ready. Route circulation review to `ib-deck-qc`.

Success condition: produce a concise, decision-led banker deck in which each core page advances the audience's decision, supported facts and banker judgment are clearly distinguished, and visual QA is performed on the final exported artifact.

## Fast Workflow

1. Classify the deck type, audience, objective, source package, and whether the ask is a page plan, storyboard, native deck, or slide-construction handoff.
2. If the request is ambiguous, choose the most likely deck type from context; ask one targeted clarification only when the deck objective or target company is truly unclear.
3. If the entity/company facts are thin, route through `company-tearsheet`; if financials, valuation, credit, buyer lists, diligence, or models are specialized, use the appropriate dedicated skill instead of recreating it here.
4. Draft the MD-level storyline before page planning: what decision/action should the client take, why now, what supports it, and what objections must be handled.
5. Build the deck plan/page plan as the default planning control. Preserve user-provided materials and make missing sources, stale data, conflicts, assumptions, and senior-review issues visible.
6. For a deck deliverable, use the available `Presentations` capability to create a polished native editable `.pptx` when available. If native deck generation is unavailable or the user specifically requests HTML, create a polished standalone HTML storyboard/report following `../../references/html-artifact-standard.md`. Convert to slide blueprints only after the deck plan is stable.
7. Render and visually inspect the final exported `.pptx` slide previews and contact sheet, or the standalone HTML screenshots, before reporting QA. Then route final circulation/readiness review to `ib-deck-qc` when available.

## Sub-agent decomposition

For complex medium/large requests, use sub-agents where available; otherwise emulate the split as named workstreams. Suggested lanes: storyline, source support, financial/model inputs, slide drafting, and QC handoff. Keep this skill as the lead: reconcile conflicts, source labels, assumptions, open items, final QA, and the user-facing answer.


## Artifact Contract

Default reader-facing artifact: a polished native editable `.pptx` built through `Presentations` when that capability is available, or a polished standalone HTML storyboard/report when native deck generation is unavailable or HTML is expressly requested. The banker-readable deck plan remains the planning layer that explains the deck objective, MD storyline, proposed slide architecture, evidence status, source needs, open items, and downstream work.

Separate contract: a **slide blueprint** is a lower-level construction spec for slide-generation tools. Use it only after the deck plan is stable and do not substitute it for unresolved deck strategy or weak sourcing.

Do not route an ordinary deck or HTML storyboard through `dashboard-builder`. If a structured handoff is requested, use deck-plan JSON and validate it as a support artifact. If the downstream builder specifically needs construction instructions, create separate slide-blueprint JSON and validate that too.

## Export Contract To `ib-deck-qc`

When a deck plan, storyboard, native deck, or slide blueprint is ready for circulation review, export the canonical `pitch_deck_builder_to_ib_deck_qc` package from `../../references/handoff-contracts.md`.

Required package fields:
- `artifact_type`, `artifact_version`, `circulation_posture`, `audience`, `deck_metadata`, `md_storyline`, `page_plan`, `source_log`, `key_numbers_to_tie`, `claim_register`, `chart_and_visual_register`, `slide_blueprint`, `appendix`, `style_profile_package`, `style_change_log_package`, `qa_status`, and `open_items`.

The native deck or HTML storyboard/report is the user-facing strategy/page-plan artifact. The slide blueprint is only a construction spec after the deck plan is stable. Missing source support, unresolved storyline issues, or `qa_status.ready_for_ib_deck_qc = false` should block final circulation posture.

## Source And Evidence Posture

Preserve source materials, existing slides, sheets, rows, columns, files, workbook tabs, formulas, charts, deck structure, templates, masters, formatting systems, page numbers, footnote conventions, disclaimers, brand assets, and user data unless the user explicitly asks for changes.

Every material factual claim, metric, valuation output, market statistic, financing view, ownership claim, transaction reference, recent development, or buyer rationale needs a citation, source-register entry, or explicit `needs_source` / `assumption` / `placeholder` label.

Use pitch-deck-native labels such as `fact`, `source_derived_estimate`, `model_derived_estimate`, `banker_judgment`, `client_assumption`, `external_assumption`, `placeholder`, and `unknown`. For downstream Investment Banking handoffs, add `canonical_evidence_category` from `../../references/evidence-label-taxonomy.md` without overwriting native labels.

## Validated Handoffs

<!-- GENERATED: validated-handoffs START -->

Producer contracts:
- `pitch_deck_builder_to_ib_deck_qc` -> `ib-deck-qc`. Schema: `../../schemas/pitch_deck_builder_to_ib_deck_qc.schema.json`. Validate with `../../scripts/validate_handoff_payload.py pitch_deck_builder_to_ib_deck_qc handoffs/pitch_deck_builder_to_ib_deck_qc.json` before another skill imports it.

Intake validation:
- From `distressed-recovery-waterfall`: require `distressed_recovery_waterfall_to_pitch_deck_builder` and run `../../scripts/validate_handoff_payload.py distressed_recovery_waterfall_to_pitch_deck_builder handoffs/distressed_recovery_waterfall_to_pitch_deck_builder.json` before importing fields into this skill.
- From `style-guide-adapter`: require `style_guide_adapter_style_profile` and run `../../scripts/validate_handoff_payload.py style_guide_adapter_style_profile handoffs/style_guide_adapter_style_profile.json` before importing fields into this skill.
- From `style-guide-adapter`: require `style_guide_adapter_change_log` and run `../../scripts/validate_handoff_payload.py style_guide_adapter_change_log handoffs/style_guide_adapter_change_log.json` before importing fields into this skill.

Use `../../references/handoff-contracts.md` for canonical field names and shared evidence semantics. Add `--strict` before any model, deck, committee, lender, board, or client-circulation use so placeholders, empty arrays, and empty objects fail instead of becoming assumptions.

Handoff payloads belong under `handoffs/` and must be listed in `manifest.json` as support or agent artifacts with `handoff_contract_name`, `schema_path`, `validator_status`, `validated_at`, and `consumer_skill`. They are never the hero deliverable unless the user explicitly asks for machine-readable output.

<!-- GENERATED: validated-handoffs END -->
## Script Map

- `scripts/build_source_request_checklist.py <deck_type>`: print universal plus deck-type-specific source asks.
- `scripts/build_deck_blueprint.py --deck-type <type> [--entity ...] [--audience ...] [--objective ...] [--format json|markdown]`: create a starter slide-construction blueprint after planning context is stable.
- `scripts/validate_deck_plan_json.py <deck_plan.json>`: validate the user-facing deck/page-plan JSON contract.
- `scripts/build_deck_storyboard.py <deck_plan.json> <output.md>`: convert validated deck-plan JSON into a support storyboard when explicitly requested or needed for downstream tooling.
- `scripts/build_deck_storyboard_html.py --input <deck_plan.json> --output-dir <dir>`: create the standalone HTML storyboard fallback when native deck output is unavailable or HTML is requested.
- `scripts/validate_deck_blueprint.py <blueprint.json>`: validate lower-level slide-construction blueprint JSON.
- `scripts/make_slide_index.py <blueprint.json>`: create a compact slide index from blueprint JSON.

## Native Deck Evidence Readiness

For senior, client, committee, board, lender, or external postures, every material number, estimate, date-sensitive fact, sourced claim, assumption, and recommendation must have readable point-of-use citation support in the native deck or standalone HTML storyboard. Model-derived claims should cite model support down to workbook/sheet/cell or range where available.

Unknown source IDs, missing source registers, uncited material numeric claims, or unmarked banker judgment are blocking readiness gaps. Fix them, downgrade the posture to working draft, or surface the missing support explicitly; do not call the output senior/client/committee/board/external-ready while those gaps remain.

## Native Deck And HTML Fallback

When a native deck is requested or appropriate, keep this skill as the analytical owner and use `Presentations` for editable slide construction, rendering, contact-sheet review, and final exported `.pptx` visual QA. The normal hero artifact is the final `.pptx`; deck-plan JSON, source registers, QA records, and handoff payloads remain support artifacts.

If native slide tooling is unavailable or the user requests HTML, produce a polished standalone HTML storyboard following `../../references/html-artifact-standard.md`. Render and visually inspect the local HTML via local headless-browser screenshots; do not use the in-app Browser plugin for local-file inspection and do not route ordinary storyboard output through `dashboard-builder`.

For either path, report QA from the final exported artifact. If layout checks show warnings that are visually adjudicated as non-blocking, say so accurately rather than claiming `0` warnings.

## Deliverable Format Standard

Follow `../../references/deliverable-format-policy.md` before creating files. Always identify the hero deliverable first: XLSX workbook, HTML report, HTML dashboard, native deck/document, generated folder, or justified chat-only answer. Do not create Markdown report files as the default rich deliverable. Do not present JSON contracts, manifests, run logs, or handoff payloads as the main user-facing output. Keep CSV files as backing ledgers/import layers unless the user explicitly asks for CSV, and explain whether each CSV contains new analysis or only support data.

Final responses should point the user to the hero deliverable first and then briefly explain any supporting artifacts.

## Reference Map

- `references/deck-archetypes.md`: read when classifying the pitch type, required sections, typical slide order, archetype-specific outputs, or source asks.
- `references/storyline-framework.md`: read when shaping the MD storyline, proof pillars, client decision, page economy, or narrative escalation.
- `references/md-level-standards.md` and `references/banker-quality-standard.md`: read when drafting banker-grade action titles, commercial judgment, and senior-review framing.
- `references/source-and-evidence.md`: read when sources are missing, stale, conflicting, confidential, assumption-heavy, or need citation/evidence labels.
- `references/source-request-checklists.md`: read when context is thin or the deliverable should include source requests instead of fabricated values.
- `references/slide-library.md`: read when assembling common banking page patterns or choosing visuals.
- `references/output-schema.md`: read when producing the deck plan, HTML storyboard/report, support storyboard, or structured JSON handoff.
- `references/slide-blueprint-schema.md`: read only when a downstream slide builder needs construction-level instructions after the deck plan is stable.
- `references/integration-guide.md`: read when coordinating with `company-tearsheet`, valuation/modeling/credit/diligence skills, `style-guide-adapter`, or downstream deck builders.
- `references/quality-checklist.md` and `references/slide-quality-qc.md`: read before final delivery and before routing to `ib-deck-qc`.
- `references/prompt-examples.md`: read when testing trigger boundaries or example requests.
- `../../references/html-artifact-standard.md`: read when HTML storyboard/report output is requested or native slide tooling is unavailable.
- `../../references/handoff-contracts.md`: read when exporting the `pitch_deck_builder_to_ib_deck_qc` package or importing structured outputs from restructuring, style, model, credit, or diligence skills.

## Runtime Artifact Path

Primary human deliverable: a specifically named native `.pptx` created and rendered through `Presentations` when available. Deterministic standalone HTML fallback: `scripts/build_deck_storyboard_html.py`, producing `pitch_deck_storyboard.html` without a dashboard contract or placeholder native deck. Deck-plan JSON and QC handoffs are support/agent artifacts only. Final client-ready status is not granted here; route the generated deck or storyboard through `ib-deck-qc` with source/model citation coverage.
