---
name: cim-teardown
description: analyze seller materials into claims, diligence gaps, red flags, and model handoffs. use when the user asks to tear down a cim or banker deck. do not use to write the cim; use cim-builder.
---

# CIM-Teardown

## Skill Configuration

### Common Skill Instructions

MANDATORY: Before searching connectors, retrieving evidence, or drafting output, read and apply the shared runtime contract in `../investment-banking/SKILL.md## Cross-Skill Runtime Contract`. Then check the router skill map and `../../references/plugin-routing-playbook.md` for adjacent skills that should be sequenced with this workflow. Do not run user-context setup or inspection during ordinary workflow work; route only explicit saved-context, source-setup, onboarding, or automation-setup requests to `../user-context/SKILL.md`.

### Source Resolution

Load `../../references/workflow-source-resolution.md`. Resolve only the categories needed for this workflow: `deal_materials`, `market_data_public_sources`, and `models_workbooks_templates`. Use the shared runtime contract to map each attempted category to an available app, connector, file, export, or user-provided input.

## Relevant Dependency Categories

These are the source categories most likely to matter for this workflow. Use the router contract to resolve only the categories the task actually needs, prefer user-named sources first, and state any material source limitation.

- `Deal Materials`
- `Models, Workbooks & Templates`
- `Process Updates`
- `Market Data & Public Sources`

## Deliverable Intake

When this skill owns a new substantive user-facing artifact, before source gathering, analysis, modeling, or rendering load `../../references/deliverable-intake-policy.md` and perform its adaptive `request_user_input` preflight for materially unresolved preferences. When invoked as a downstream support step within an already scoped workflow, inherit resolved preferences and do not re-prompt.

## Artifact Hierarchy

Follow `../../references/artifact-manifest-standard.md` before returning generated files. The hero deliverable must be a polished standalone HTML diligence report, workbook, native deck/document, generated folder first-read file, or justified chat-only answer. CSV, JSON, Markdown, run logs, manifests, and handoff payloads are support artifacts unless the user explicitly asks for them. Final responses should lead with the hero deliverable, then companion deliverables, then support artifacts in one short sentence if useful.

## Plugin Workflow Routing

For broad transaction workflow prompts, read `../../references/plugin-routing-playbook.md` before selecting or sequencing skills. Use this skill as lead only in the workflows named there; when acting as support, preserve validated handoff fields, source IDs, routing metadata, and the artifact hierarchy so the hero deliverable remains the banker-facing standalone HTML diligence report, workbook, native deck/document, or clear first-read package.

## Trigger Boundary
Use this skill when the user wants to test seller materials, including:
- a CIM, teaser, or investor deck teardown
- a claims ledger from seller materials
- evidence requests, seller asks, or a data-room gap list
- ranked diligence questions or a diligence workplan
- a red-flag register
- quick underwriting implications from seller claims
- a decision-oriented diligence memo for PE, growth, CorpDev, or confirmatory diligence

Do not use this skill for:
- writing, polishing, or designing a CIM
- building a full DCF, LBO, merger model, or valuation workbook
- generic company summaries with no diligence or falsification ask
- pure legal opinions or legal advice
- casual article or deck summarization

## Role / Non-Role
Act as the diligence lead turning seller materials into a falsification-first, decision-grade pack that tells the team whether to keep spending time.

Default posture:
- the CIM is the claim source, not proof
- decision-grade top layer first, broad background later
- definitions before numbers
- gating items before narrative
- explicit kill criteria for each gating item
- first-wave seller asks before second-wave confirmatory diligence
- HTML teardown report first for substantial diligence; concise chat only for narrow follow-ups or explicit quick screens

Minimum input is one seller material artifact and an identifiable deal/company. If inputs are incomplete, still produce the teardown and mark gaps with `UNKNOWN`, `TBD`, `ASSUMPTION`, or `CITATION_TBD`.

Stop and ask for clarification only when document versions, deal perimeter, persona lens, or asset type conflict in a way that would change the answer.

## Fast Workflow
1. Triage deal stage, user-requested artifact, persona lens, available inputs, and connector/export availability.
2. Detect the primary asset type. Load the matching overlay reference before assigning owners or finalizing gates.
3. Build a citation map for files, pages, sections, exhibits, charts, footnotes, versions, and external sources.
4. Run the CIM credibility anomaly pass and promote material trust issues into the IC view.
5. Extract atomic claims, classify them, capture qualifiers, and flag missing definitions.
6. Run quick underwriting math when price plus earnings, cashflow, NOI, EBITDA, FCF, or equivalent metrics appear.
7. Draft first-wave gating items with linked `C-`, `E-`, `Q-`, and `RF-` IDs where available.
8. Create falsification-first questions and a `First-Wave Seller Data Request`.
9. Detect red flags, state `What resolves it`, and link each flag to claims and questions.
10. Produce the requested artifact with appendices, then run readability and audit QA.

## Sub-agent decomposition

For complex medium/large requests, use sub-agents where available; otherwise emulate the split as named workstreams. Suggested lanes: claims extraction, evidence/citation map, financial/KPI tie-out, red flags, and diligence questions. Keep this skill as the lead: reconcile conflicts, source labels, assumptions, open items, final QA, and the user-facing answer.


## Artifact Contract
Default output for substantial teardown work is an `extended_analysis` polished standalone HTML diligence report with three layers:
1. compact initial IC recommendation and gating decision
2. decision-useful first-wave diligence sections focused on the user's ask
3. appendices or structured exports for the full claims, evidence, questions, red flags, and tasks/workplan when useful

Default sections:
- `Initial IC Recommendation`, including posture, gating issues, and what changes the recommendation
- `Claims That Matter Most`, including proof status and required validation
- `Red Flags And Kill Tests`, including what resolves each gating issue
- `First-Wave Seller Data Request`, limited to evidence needed before deciding whether to proceed
- `Quick Underwriting Implications` when price and a cashflow/earnings metric exist
- external triangulation pack when connectors or primary exports are missing
- executable workplan when it adds decisions or ownership not already shown in the request table
- appendices: full claims ledger, evidence list, question list, red-flag register, and task/workplan list
- assumptions, missing evidence, and open questions

Use stable IDs across every artifact:
- `claim_id`: `C-0001`
- `evidence_id`: `E-0001`
- `question_id`: `Q-0001`
- `red_flag_id`: `RF-0001`
- `task_id`: `T-0001`

Create CSV, JSON, XLSX, or folder outputs only when the user asks for files or reusable structured output is clearly needed. Keep the same IDs and linkages across the HTML report, chat cover note, and support exports.

For an initial IC discussion, do not create a separate open-diligence section that merely repeats the gating issues, red flags, or first-wave seller request. Keep full linked diligence ledgers as appendices or support artifacts when they are decision-useful or needed by a downstream model or memo workflow.

For an initial IC screen, use one primary first-read gating/red-flag table that includes the relevant kill tests. Do not repeat the same risks in a separate main-body `Red Flags And Kill Tests` table; show only incremental risks there, or keep the full red-flag register in an appendix or support artifact.

For detailed schemas, templates, readability rules, and export contracts, read:
- [report-template.md](references/report-template.md)
- [output-schemas.md](references/output-schemas.md)
- [downstream-handoffs.md](references/downstream-handoffs.md)
- [handoff-contracts.md](../../references/handoff-contracts.md)

## Source / Evidence Posture
No hallucinated citations. Every material fact needs a resolvable pointer or `CITATION_TBD`.

Canonical pointer families:
- `CIM <file> | p.<page> | <section_path> | <exhibit_id> | <object> | <span>`
- `WEB | <source_name> | <url> | <title> | <date_accessed> | <span/lines>`
- `CITATION_TBD`

Evidence order:
1. connectors and systems of record
2. user-provided exports, uploads, or data-room files
3. credible primary web sources
4. secondary aggregators, with lower confidence and corroboration when material

Web research can triangulate context but never overrides primary exports or systems of record. Label unsourced owners, deadlines, benchmark tolerances, acceptance thresholds, and kill thresholds as `sourced`, `calculated`, `screening default`, or `assumption`.

For detailed citation, proof, claim, metric, question, and red-flag rules, read:
- [citations.md](references/citations.md)
- [evidence-framework.md](references/evidence-framework.md)
- [claims-taxonomy.md](references/claims-taxonomy.md)
- [metric-definitions.md](references/metric-definitions.md)
- [question-engine.md](references/question-engine.md)
- [red-flag-catalog.md](references/red-flag-catalog.md)

## Validated Handoffs

<!-- GENERATED: validated-handoffs START -->

Producer contracts:
- `cim_teardown_to_memo_builder` -> `memo-builder`. Schema: `../../schemas/cim_teardown_to_memo_builder.schema.json`. Validate with `../../scripts/validate_handoff_payload.py cim_teardown_to_memo_builder handoffs/cim_teardown_to_memo_builder.json` before another skill imports it.
- `cim_teardown_to_model_builder` -> `model builders`. Schema: `../../schemas/cim_teardown_to_model_builder.schema.json`. Validate with `../../scripts/validate_handoff_payload.py cim_teardown_to_model_builder handoffs/cim_teardown_to_model_builder.json` before another skill imports it.

Use `../../references/handoff-contracts.md` for canonical field names and shared evidence semantics. Add `--strict` before any model, deck, committee, lender, board, or client-circulation use so placeholders, empty arrays, and empty objects fail instead of becoming assumptions.

Handoff payloads belong under `handoffs/` and must be listed in `manifest.json` as support or agent artifacts with `handoff_contract_name`, `schema_path`, `validator_status`, `validated_at`, and `consumer_skill`. They are never the hero deliverable unless the user explicitly asks for machine-readable output.

<!-- GENERATED: validated-handoffs END -->
## Script Map
Use scripts only when the user asks for file outputs or a structured teardown workspace.

- `scripts/validate_plan.py`: validates `plan.json` before scaffolding.
- `scripts/run_plan.py`: scaffolds `cim_teardown_report.html`, CSV ledgers, `deal_package.json`, and `manifest.json`; it does not parse the CIM.
- `scripts/validate_outputs.py`: validates output files, headers, IDs, cross-links, citation presence, and priority math.

When using scripts, read [output-schemas.md](references/output-schemas.md) for `plan.json`, file headers, and validation rules. Read [examples.md](references/examples.md) for the happy-path run sequence.

## Standalone HTML Path

When HTML is requested or selected, produce a polished standalone HTML diligence report following `../../references/html-artifact-standard.md`. This skill owns the diligence judgment, report hierarchy, writing, and presentation. Do not route an ordinary CIM teardown HTML report through `dashboard-builder`, create a dashboard render contract, or force linked diligence analysis into fixed dashboard modules.

For an initial IC screen, keep the first-read path tight: initial recommendation, gating claims, red flags and kill tests, first-wave seller data request, preliminary underwriting implications where possible, then evidence limitations and any useful appendix. Keep the main report focused on the decision to continue diligence, not on displaying every control ledger.

Stable `C-`, `E-`, `Q-`, `RF-`, and `T-` IDs remain part of this skill's analytical architecture. Use IDs where they help the IC reader connect an issue to proof or a seller request; preserve dense cross-links in appendices, CSV/JSON support files, or downstream handoffs instead of repeating them throughout the narrative.

Do not add generic dashboard navigation, repeated table export controls, reader-action bars, related-file panels, internal render contracts, or visible generation machinery merely because the deliverable is HTML. Include an exportable structured diligence pack only when requested or when a downstream workflow benefits from it.
Do not add a navigation bar or table-of-contents strip to an ordinary initial IC report unless material length or complexity makes navigation useful.

## HTML Evidence Readiness

For senior, client, committee, board, lender, or external postures, every material number, estimate, date-sensitive fact, sourced claim, assumption, and recommendation must have readable point-of-use citation support. Unknown citation IDs, missing source registers, uncited material numeric claims, unsupported normalization conclusions, or unresolved transaction-perimeter claims are blocking readiness gaps: fix them, downgrade the posture to draft or screen-grade, or surface them explicitly.

For an HTML CIM teardown report:

- Cite complete claims, table rows, or metric phrases where possible rather than repeating source chips across headings, individual cells, and section footers.
- Keep seller claims, analyst calculations, inferred diligence risks, and requested evidence visibly distinct.
- Make the proceed/pause/pass posture conditional when source support is limited to seller materials.
- Keep support artifacts and generation mechanics out of the visible report body unless requested.
- Render and visually inspect local HTML with local headless-browser screenshots, not the in-app Browser plugin, before delivery.

## Deliverable Format Standard

Follow `../../references/deliverable-format-policy.md` before creating files. Always identify the hero deliverable first: polished standalone HTML diligence report, XLSX workbook, native deck/document, generated folder, or justified chat-only answer. Do not create Markdown report files as the default rich deliverable. Do not present JSON contracts, manifests, run logs, or handoff payloads as the main user-facing output. Keep CSV files as backing ledgers/import layers unless the user explicitly asks for CSV, and explain whether each CSV contains new analysis or only support data.

When the report is complete as an initial screen but material seller evidence is still needed for a proceed, reprice, or pass recommendation, set `blocked_or_partial_status.status` to `partial` and identify the unresolved inputs. Use `complete` only when the requested decision scope is resolved without material missing evidence.

Final responses should point the user to the hero deliverable first and then briefly explain any supporting artifacts.

## Reference Map
Read only the references needed for the request.

Core operating references:
- [../../references/html-artifact-standard.md](../../references/html-artifact-standard.md): shared standalone HTML design, evidence, and visual-inspection standard.
- [analysis-playbook.md](references/analysis-playbook.md): detailed operating rules, anomaly pass, underwriting math, owner mapping, edge cases, and do-not-do rules.
- [report-template.md](references/report-template.md): default HTML report, IC view, seller ask block, readability QA, and templates.
- [citations.md](references/citations.md): detailed citation strings, web/CIM pointer rules, and citation failure modes.
- [evidence-framework.md](references/evidence-framework.md): proof hierarchy, retrieval ladder, source standards, seller tricks, and external triangulation.
- [claims-taxonomy.md](references/claims-taxonomy.md): claim extraction, taxonomy, qualifiers, and worked claim examples.
- [metric-definitions.md](references/metric-definitions.md): definitions and pitfalls for ARR, retention, gross margin, CAC, pipeline, EBITDA, cash conversion, and related metrics.
- [reconciliation-playbooks.md](references/reconciliation-playbooks.md): tie-outs for ARR, bookings, retention, gross margin, pipeline, working capital, and cash conversion.
- [question-engine.md](references/question-engine.md): falsification-first question design, priority scoring, owners, and branching follow-ups.
- [data-requests-library.md](references/data-requests-library.md): exact export wording and field lists for seller requests.
- [red-flag-catalog.md](references/red-flag-catalog.md): red-flag detection logic and severity calibration.
- [output-schemas.md](references/output-schemas.md): CSV/JSON schemas, plan schema, and validator expectations.
- [downstream-handoffs.md](references/downstream-handoffs.md): memo-builder and model-builder handoff fields, mapped to the shared `cim_teardown_to_memo_builder` and `cim_teardown_to_model_builder` contracts.
- [../../references/handoff-contracts.md](../../references/handoff-contracts.md): canonical cross-skill handoff field names.
- [persona-overlays.md](references/persona-overlays.md): PE, growth/VC, CorpDev, diligence lead, and mixed-lens emphasis.
- [security-legal-dd.md](references/security-legal-dd.md): security, compliance, and legal diligence checks when those workstreams are material.
- [examples.md](references/examples.md): trigger examples, edge cases, and a micro worked example.

Asset overlays:
- [overlay-saas.md](references/overlay-saas.md): software, SaaS, usage, or recurring-revenue businesses.
- [overlay-consumer-retail.md](references/overlay-consumer-retail.md): stores, ecommerce, brands, restaurants, and retail rollups.
- [overlay-local-field-services.md](references/overlay-local-field-services.md): route, dispatch, technician, local services, and field operations.
- [overlay-staffing-labor-services.md](references/overlay-staffing-labor-services.md): staffing, labor marketplaces, outsourced labor, and payroll-funding businesses.
- [overlay-fuel-convenience-site-retail.md](references/overlay-fuel-convenience-site-retail.md): fuel, convenience, car wash, QSR pad, and site-retail economics.
- [overlay-industrials.md](references/overlay-industrials.md): manufacturing, processing, distribution-with-production, and asset-heavy industrials.
- [overlay-healthcare.md](references/overlay-healthcare.md): providers, services, reimbursement, regulated healthcare, and patient-volume businesses.
- [overlay-financial-services.md](references/overlay-financial-services.md): asset management, insurance distribution, specialty finance, servicing, payments, and regulated financials.
- [overlay-real-assets.md](references/overlay-real-assets.md): site-driven real assets where throughput, permits, condition, and local demand drive cash flow.
- [overlay-real-estate-heavy.md](references/overlay-real-estate-heavy.md): leases, NOI, occupancy, rent, taxes, and property-heavy operating models.
