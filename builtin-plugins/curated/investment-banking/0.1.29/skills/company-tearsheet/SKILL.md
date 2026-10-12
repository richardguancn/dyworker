---
name: company-tearsheet
description: Create source-backed banker-facing company, target, borrower, issuer, or counterparty tearsheets. Use for baseline profiles, coverage screens, deal-screen inputs, and meeting context. Do not use for full memos, models, decks, or diligence reports.
---

# Company Tearsheet

## Skill Configuration

### Common Skill Instructions

MANDATORY: Before searching connectors, retrieving evidence, or drafting output, read and apply the shared runtime contract in `../investment-banking/SKILL.md## Cross-Skill Runtime Contract`. Then check the router skill map and `../../references/plugin-routing-playbook.md` for adjacent skills that should be sequenced with this workflow. Do not run user-context setup or inspection during ordinary workflow work; route only explicit saved-context, source-setup, onboarding, or automation-setup requests to `../user-context/SKILL.md`.

### Source Resolution

Load `../../references/workflow-source-resolution.md`. Resolve only the catalogued source categories needed for the current tearsheet. Prefer a user-named source first, then one available app, connector, file, export, or pasted input that satisfies the category. Attempt the smallest useful native read only when the workflow needs that source. If a route needs auth, connection, or setup, state the practical limitation and continue from prompt context, active artifacts, pasted or exported material, and public sources when the tearsheet can still be useful. Do not inspect unrelated source categories, run broad source setup, write connector readiness, or create, read, migrate, or update `category-state.json`.

The runtime source categories below cover the catalogued Investment Banking sources. Use `references/source-and-evidence.md` for the broader evidence hierarchy and freshness rules.

### Workflow Sources

When this skill uses a source category, use it for the following information. These are semantic source categories, not fixed connector names.

- `deal_materials`: user-provided files, deal documents, VDR exports, management materials, and diligence sources needed for the company baseline.
- `process_updates`: trackers and internal updates only when active process status materially changes the tearsheet framing.
- `relationship_counterparty_context`: relationship, sponsor, buyer, lender, and counterparty context when it materially changes the coverage or transaction read.
- `market_data_public_sources`: filings, ratings, market data, provider exports, and transaction benchmarks needed for reported facts, valuation context, and freshness checks.
- `models_workbooks_templates`: models, workbook extracts, and approved templates only when they materially improve the baseline or downstream handoff.

## Relevant Dependency Categories

These are the source categories most likely to matter for this workflow. Use the router contract to resolve only the categories the task actually needs, prefer user-named sources first, and state any material source limitation.

- `Market Data & Public Sources`
- `Relationship & Counterparty Context`
- `Deal Materials`

## Deliverable Intake

When this skill owns a new substantive user-facing artifact, before source gathering, analysis, modeling, or rendering load `../../references/deliverable-intake-policy.md` and perform its adaptive `request_user_input` preflight for materially unresolved format, depth, audience/use, or focus choices. When the user explicitly requests HTML for a tearsheet, that resolves the presentation surface to a polished standalone HTML banker tearsheet; ask only remaining material choices. When invoked as a downstream support step within an already scoped workflow, inherit resolved preferences and do not re-prompt.

## Artifact Hierarchy

Follow `../../references/artifact-manifest-standard.md` before returning generated files. The hero deliverable must be a polished standalone HTML report, workbook, native deck/document, generated folder first-read file, or justified chat-only answer. CSV, JSON, Markdown, run logs, manifests, and handoff payloads are support artifacts unless the user explicitly asks for them. Final responses should lead with the hero deliverable, then companion deliverables, then support artifacts in one short sentence if useful.

## Plugin Workflow Routing

For broad transaction workflow prompts, read `../../references/plugin-routing-playbook.md` before selecting or sequencing skills. Use this skill as lead only for a factual baseline or explicitly requested coverage screen; when acting as support, preserve validated handoff fields, source IDs, routing metadata, and the artifact hierarchy so the owning workflow retains its intended banker-facing deliverable.

## Purpose And Boundary

Create a factual starting point for an Investment Banking workflow: a company or counterparty baseline, an initial coverage screen, a pitch input, a financing/credit snapshot, or a meeting brief input.

Use for source-backed profiles of a public or private company, borrower, issuer, sponsor-owned target, business unit, competitor, client, or relevant counterparty. Use a fund/manager profile only when it is directly part of a banker coverage or transaction context.

Do not turn the tearsheet into a complete investment memo, client pitch, valuation case, acquisition recommendation, lender approval, full diligence workplan, or model. Route expanded work to `memo-builder`, `pitch-deck-builder`, `cim-teardown`, `capital-markets-issuance`, `private-credit-underwriting`, `comps-valuation`, or the relevant model skill.

## Output Modes

Choose the narrowest mode that satisfies the request and requested depth:

- `baseline_tearsheet`: company identity, banker read, high-signal metrics, business/financial profile, mandate relevance, material gaps, sources, and next analytical route.
- `coverage_screen`: use when the prompt asks for initial coverage, pitch preparation, strategic alternatives, acquisition appetite, financing opportunity, or transaction dialogue. Add selected transaction/financing history, preliminary coverage angle, and one consolidated priority-questions table.
- `structured_handoff`: source-backed JSON for a downstream skill; it is support material unless explicitly requested as the deliverable.

Default to `extended_analysis` under `../../references/output-depth-policy.md` for a substantive standalone request, while keeping the selected mode disciplined. Full working depth in `baseline_tearsheet` does not justify expanding it into a pitch workplan; `coverage_screen` requires a mandate signal from the prompt or intake.

## Standalone HTML Path

When HTML is requested or selected, produce a polished standalone HTML banker tearsheet following `../../references/html-artifact-standard.md`. The skill owns its report hierarchy, writing, and presentation. Do not route an ordinary tearsheet through `dashboard-builder`, create a dashboard render contract, or force the content into fixed dashboard modules.

Let the profile type and mandate determine the first-read structure:

- M&A or coverage screen: coverage read, operating snapshot, transaction relevance, actionable validation questions.
- ECM/public issuer: equity story, operating/valuation context, capital-markets relevance, financing considerations.
- Borrower/financing issuer: credit profile, liquidity/leverage, financing need, maturities/covenants, underwriting gaps.
- Private target/sell-side: business profile, scale and KPIs, ownership/process context, diligence flags.
- Counterparty/meeting context: strategic relevance, relationship context when provided, developments, meeting implications.

Do not add generic dashboard navigation, reader-action bars, related-file panels, repeated diligence registers, or visible internal support machinery merely because the output is HTML. Include functionality only when it materially helps the stated banker workflow.

## Workflow

1. **Classify the profile and mode.** Identify the entity, banker use case, audience, `baseline_tearsheet` versus `coverage_screen`, and downstream workflow.
2. **Build a focused source inventory.** Track source identity, type, as-of date, retrieved-at date where relevant, period, freshness, and location.
3. **Extract only critical facts.** Use source-supported business, scale, operating driver, financial, capital structure, valuation, transaction, relationship, and evidence-gap fields relevant to the mandate.
4. **Label evidence and confidence.** Distinguish facts, company/management claims, company-defined metrics, calculations, estimates, assumptions, stale inputs, conflicts, and missing evidence.
5. **Compose the tearsheet.** Lead with why the entity matters for the mandate, then select four or five high-signal metrics and the minimum tables or narrative needed to establish the banker view.
6. **Control scope.** In `coverage_screen`, use one consolidated priority-questions/action table. Do not add a second open-diligence register that repeats it.
7. **Run QC.** Confirm identity, periods, units, currency, source support, freshness, readiness posture, citation readability, and HTML visual quality when applicable.

## Metric And Framing Discipline

- Headline metrics must serve the requested banker question, not merely fill a row of tiles.
- Do not feature stale market-derived valuation, trading levels, transaction values, or financing capacity in the headline view without a clear reason, visible as-of date, and explicit limitation. Prefer a current operating or mandate-relevant metric when valuation is not ready for decision use.
- Use `Valuation Context` or `Indicative Market Reference` for incomplete or derived valuation context; do not imply a valuation opinion, fairness conclusion, or client-ready pitch case.
- Keep management-defined metrics, synergy claims, prospective financing capacity, relationship intelligence, and internal objectives clearly identified as such.

## Source And Evidence Posture

Preserve all source materials, files, workbook tabs, user notes, and connected-app records unless the user explicitly requests a destructive change.

Use the strongest accessible source, starting with user-provided context/files and connected/internal sources, then primary sources, trusted providers, credible secondary sources, public web, and finally clearly labeled assumptions.

Never invent missing facts, metrics, ownership details, ratings, customer names, revenue, EBITDA, AUM, debt, valuation, relationship history, strategic appetite, or transaction objectives. Cite material claims and metrics; disclose stale, preliminary, unaudited, estimated, OCR-derived, low-confidence, and conflicting data.

In a reader-facing artifact, translate support labels into plain banking language such as `Reported`, `Company-defined`, `Derived`, `Management statement`, `Stale market reference`, or `Not yet sourced`; keep internal evidence codes in structured support data only unless explicitly requested.

## Deterministic Helpers And Handoffs

```bash
python scripts/validate_tearsheet_json.py path/to/tearsheet.json
python scripts/build_tearsheet_markdown.py path/to/tearsheet.json output.md
python scripts/map_tearsheet_to_memo_handoff.py path/to/tearsheet.json handoffs/company_tearsheet_to_memo_builder.json --strict
python ../../scripts/validate_handoff_payload.py company_tearsheet_to_memo_builder handoffs/company_tearsheet_to_memo_builder.json --strict
```

The JSON validator and memo mapper support structured handoffs. The Markdown converter is only for explicit Markdown requests or downstream legacy tooling; it does not produce the standalone HTML hero artifact. Raw JSON, Markdown, manifests, and handoff payloads are support artifacts unless the user specifically requests them.

Producer contract:

- `company_tearsheet_to_memo_builder` -> `memo-builder`. Schema: `../../schemas/company_tearsheet_to_memo_builder.schema.json`.

Use `../../references/handoff-contracts.md` for canonical fields and evidence semantics. Handoff payloads belong under `handoffs/`, must preserve source IDs and caveats, and must be listed in `manifest.json` as support or agent artifacts when generated. They are never the hero deliverable unless requested as machine-readable output.

## HTML Evidence Readiness

For senior, committee, board, client, lender, or external postures, every material number, estimate, date-sensitive fact, sourced claim, assumption, and recommendation must have readable point-of-use citation support. Unknown citation IDs, missing source registers, uncited material numerical claims, stale headline valuation inputs, or unsupported transaction implications are blocking readiness gaps: fix them, downgrade the posture to draft/screen-grade, or surface them explicitly.

For an HTML tearsheet:

- Keep the first-read sequence concise: banker read, four or five relevant metrics, operating/transaction or financing context, material gaps, source notes, and next route.
- Prefer one well-designed decision-useful table over several repeated panels.
- Cite complete figures and phrases; do not split fiscal periods, dates, transaction labels, or metric values into fragmented linked tokens.
- Keep support artifacts and generation mechanics out of the visible report body unless requested.
- Render and visually inspect local HTML with local headless-browser screenshots, not the in-app Browser plugin, before delivery.

## Deliverable Format Standard

Follow `../../references/deliverable-format-policy.md` before creating files. Do not create Markdown report files, JSON contracts, manifests, run logs, or handoff payloads as the default rich deliverable. Keep CSV files as backing ledgers/import layers unless the user explicitly asks for CSV. For an HTML-selected tearsheet, the hero artifact is the polished standalone HTML report.

## Reference Map

- `../../references/html-artifact-standard.md`: shared HTML design, evidence, and visual-inspection standard.
- `references/source-and-evidence.md`: source hierarchy, citation, freshness, conflict, and evidence-label rules.
- `references/profile-templates.md`: banker profile types and standalone HTML structures.
- `references/metric-library.md`: operating, valuation, financing, transaction, and profile-specific metrics.
- `references/quality-checks.md`: scope, evidence, valuation, and HTML presentation QC.
- `references/integration-guide.md`: downstream Investment Banking handoffs.
- `../../references/handoff-contracts.md`: exact payload fields for validated downstream imports.
- `../../references/evidence-label-taxonomy.md`: shared evidence semantics.
- `../../references/output-depth-policy.md`: analysis-depth policy; default to `extended_analysis` unless an explicit shortening condition applies.
