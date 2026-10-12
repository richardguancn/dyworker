---
name: distressed-recovery-waterfall
description: Analyze distressed capital structures and recovery waterfalls. Use when the user asks about claims, lien priority, fulcrum security, plan value, liquidation value, sale paths, or restructuring recoveries. Do not use for standard LBO modeling.
---

# Distressed Recovery Waterfall

## Skill Configuration

### Common Skill Instructions

MANDATORY: Before searching connectors, retrieving evidence, or drafting output, read and apply the shared runtime contract in `../investment-banking/SKILL.md## Cross-Skill Runtime Contract`. Then check the router skill map and `../../references/plugin-routing-playbook.md` for adjacent skills that should be sequenced with this workflow. Do not run user-context setup or inspection during ordinary workflow work; route only explicit saved-context, source-setup, onboarding, or automation-setup requests to `../user-context/SKILL.md`.

### Source Resolution

Load `../../references/workflow-source-resolution.md`. Resolve only the categories needed for this workflow: `deal_materials`, `market_data_public_sources`, and `models_workbooks_templates`. Use the shared runtime contract to map each attempted category to an available app, connector, file, export, or user-provided input.

## Relevant Dependency Categories

These are the source categories most likely to matter for this workflow. Use the router contract to resolve only the categories the task actually needs, prefer user-named sources first, and state any material source limitation.

- `Deal Materials`
- `Market Data & Public Sources`
- `Models, Workbooks & Templates`
- `Process Updates`

## Deliverable Intake

When this skill owns a new substantive user-facing artifact, before source gathering, analysis, modeling, or rendering load `../../references/deliverable-intake-policy.md` and perform its adaptive `request_user_input` preflight for materially unresolved preferences. For a debtor-side sale-path, restructuring-alternatives, board-recommendation, or recovery-advice memo with an unresolved surface, offer `Polished HTML restructuring memo (Recommended)`, `Excel recovery waterfall workbook`, and `Word memo (.docx)`. Default to polished standalone HTML when intake is not required or a non-interactive narrative run must apply a default. Select workbook-first output without a format question when the request is principally to build, calculate, or sensitize recoveries, claims waterfalls, or value-break scenarios. When invoked as a downstream support step within an already scoped workflow, inherit resolved preferences and do not re-prompt.
## Plugin Workflow Routing

For broad transaction workflow prompts, read `../../references/plugin-routing-playbook.md` before selecting or sequencing skills. Use this skill as lead only in the workflows named there; when acting as support, preserve validated handoff fields, source IDs, routing metadata, and the artifact hierarchy so the hero deliverable remains the standalone HTML restructuring memo, banker-facing recovery workbook, requested native document, or clear first-read package.

## Artifact Hierarchy

Follow `../../references/artifact-manifest-standard.md` before returning generated files. The normal hero deliverable for debtor-side sale-path, restructuring-alternatives, or board-recommendation analysis is a polished standalone HTML restructuring memo. For model-heavy recovery waterfall, claims allocation, or value-break sensitivity work, use the workbook as the hero deliverable and a concise standalone HTML explanation only when useful. CSV, JSON, Markdown, run logs, manifests, model-citation ledgers, and handoff payloads are support artifacts unless the user explicitly asks for them. Final responses should lead with the hero deliverable and meaningful companion deliverables; do not link to manifests, renderer contracts, audit payloads, or handoff files in ordinary delivery responses.

## Standard

Operate like a senior restructuring investment banker preparing MD/partner-level advice. Do not merely allocate value down a stack. Identify who is impaired, where value breaks, which constituency is fulcrum, who has leverage, which restructuring alternatives are executable, what diligence gaps matter, and what the client should do next.

Always separate:
- sourced facts, calculated outputs, user-provided assumptions, market-derived assumptions, and unsourced assumptions.
- strict legal-entitlement economics from negotiated plan economics.
- enterprise-value waterfalls from collateral/liquidation waterfalls.
- banker judgment from items requiring counsel, tax, valuation, or industry specialist review.

Do not provide definitive legal advice. Flag legal interpretation points for counsel review.

## Context routing

Start by inferring the working mode from the prompt and available materials:

1. No-context mode: if the user provides only a company name or broad request, do not fabricate the debt stack. Provide an intake checklist, model skeleton, and what can be done with public data.
2. Partial-context mode: if the user provides claims, debt, EBITDA, EV, or a model but not documents, build an illustrative waterfall and label all priority, lien, collateral, claim-size, and legal assumptions.
3. Full-data-room mode: if documents, models, VDR exports, or filings are available, extract the capital structure, claims, legal-entity map, collateral pools, valuation cases, and source tie-outs.
4. Existing-model mode: if the user provides an Excel workbook, preserve it. Do not overwrite tabs, formulas, names, or assumptions unless specifically requested. Create copies, output tabs, audit logs, and change notes.
5. Fast-turn mode: if the user explicitly needs quick meeting prep or time-boxed triage, produce a concise value-break read, three-case recovery table, diligence gaps, and senior questions; otherwise default to the full recovery analysis.
6. Advocacy mode: if the user represents a specific stakeholder, adapt the analysis to that constituency while still making economics and assumptions transparent.

If the user does not state the role, infer if possible from context. Otherwise state the assumed perspective, such as debtor-side, first-lien creditor, second-lien creditor, unsecured noteholder, sponsor, buyer, board, or internal banking team.

## Deliverable Modes

Choose the artifact mode independently from the analysis type:

- `restructuring_memo`: debtor-side sale path, board recommendation, stakeholder advice, or restructuring-alternatives analysis; default hero deliverable is a polished standalone HTML memo.
- `recovery_workbook`: calculation-heavy claims waterfall, recovery range, value-break, collateral pool, or sensitivity analysis; default hero deliverable is an XLSX workbook, with a standalone HTML companion only when it improves decision communication.
- `screening_note`: preliminary public-source or thin-context read without enough evidence for a board recommendation or supportable recovery model; use HTML or chat according to scope, with missing inputs made explicit.

A narrative restructuring memo is not a request for a dashboard. Do not route ordinary debtor-side recovery or sale-path HTML analysis through `dashboard-builder`. For a substantive `restructuring_memo`, do not return a completed inline Markdown memo when HTML is selected or defaulted; create and visually inspect the `.html` artifact and use chat as a concise cover note.

## Source hierarchy

Prefer sources in this order:

1. User-provided documents, workbooks, prompts, and uploaded data.
2. Callable connected routes or user-provided exports, such as drive, email, slack, internal document systems, financial-data connectors, market-data connectors, or deal-room exports.
3. Company filings, bankruptcy docket materials, court filings, indentures, credit agreements, prospectuses, press releases, investor presentations, and ratings reports.
4. Market data such as loan or bond prices, CDS, equity trading, comps, precedent transactions, DIP/exit financing terms, and recent restructuring precedents.
5. Web search as fallback for public, recent, or missing information.
6. User-confirmed assumptions when no reliable source is available.

Use `references/source-hierarchy.md` for source labels, stale-data checks, and citation discipline.

## Core workflow

Use this sequence unless the user explicitly asks for a narrower deliverable:

1. Frame mandate and client posture.
2. Build legal-entity, obligor, guarantor, and collateral map.
3. Build claims register, including funded debt and non-funded claims.
4. Normalize debt stack by true economic priority, not just labels.
5. Determine collateral coverage, structural subordination, and intercreditor constraints.
6. Build valuation framework: reorganization value, sale value, collateral value, and liquidation value.
7. Construct recovery waterfalls across low/base/high and restructuring alternatives.
8. Identify value break and fulcrum security by scenario.
9. Compare restructuring alternatives: amend-and-extend, exchange, LME, equitization, prepack, pre-arranged filing, freefall, 363 sale, credit bid, liquidation, or enforcement.
10. Analyze stakeholder leverage, plan feasibility, voting dynamics, and new-money needs.
11. Pressure-test assumptions and reconcile market prices to model recoveries.
12. Provide recommendation, negotiation posture, diligence gaps, and next-step workplan.

Load `references/workflow.md` for detailed procedural guidance.

## Output Depth

Default to `extended_analysis`: full capital structure, claims register, value bridge, recovery waterfall, fulcrum analysis, alternatives comparison, stakeholder leverage map, diligence gaps, and recommendation wherever the context supports it. Use quick-read or fast-turn formats only when the user explicitly asks for brevity, the task is live meeting prep, or source context is too thin for a full waterfall without false precision. Read `../../references/output-depth-policy.md` before shortening.

## Required analytical outputs

Every substantive response should include as many of these as the context supports:

- Executive conclusion: where value breaks, fulcrum class, recoveries, best path, and largest risks.
- Capital structure table: instrument, issuer/borrower, guarantors, collateral, lien, priority, claim amount, maturity, coupon, trading price, notes.
- Claims register: funded debt, DIP/admin, priority, trade, leases, litigation, pension, tax, professional fees, intercompany, contingent, disputed, and equity interests.
- Value bridge: enterprise value to distributable value, including cash, debt-like claims, fees, wind-down costs, new money, and required liquidity.
- Recovery waterfall: low/base/high and, when relevant, liquidation, sale, plan, and LME-adjusted cases.
- Fulcrum analysis: value-break class, sensitivity, trading-price comparison, practical control constituency, and possible fulcrum shifts.
- Alternatives comparison: economics, feasibility, timing, support needs, litigation risk, and recommendation.
- Stakeholder leverage map: economic, legal, voting, liquidity, operational, and process leverage.
- Diligence gaps: source documents required, counsel-review points, valuation issues, model gaps, and market checks.
- Recommendation: action-oriented view appropriate for a senior client conversation.

Use `references/output-templates.md` for quick-read, memo, model, board, and creditor formats.

For a debtor-side sale-path or board-recommendation memo, surface the decision gates early: what the stalking-horse transaction proves and does not prove, how DIP and administrative leakage changes distributable value, where value may break, and what information is required before the board can rely on a recommendation. If claims, collateral pools, payoff amounts, sale-process evidence, or current docket status are incomplete, frame recovery metrics as illustrative sensitivity rather than distributable recovery.

## Sub-agent decomposition

For complex medium/large requests, use sub-agents where available; otherwise emulate the split as named workstreams. Suggested lanes: claims/legal priority, valuation, collateral/liquidation, market checks, and restructuring alternatives. Keep this skill as the lead: reconcile conflicts, source labels, assumptions, open items, final QA, and the user-facing answer.


## Workbook and model behavior

When creating or editing spreadsheets:

- Preserve user work. Never delete, overwrite, or flatten data unless the user specifically asks.
- Make the first visible tab a banker-readable `Cover`, `Executive Summary`, or `Dashboard` tab following `../../references/workbook-first-tab-standard.md`, with liquidity, maturity wall, leverage/coverage, covenant headroom, recovery, fulcrum, path risk, and next steps.
- Add new tabs rather than changing original tabs when possible.
- Keep formulas intact and make calculation logic auditable.
- Use clear input/calculation/output/check sections.
- Add source notes and assumption labels.
- Include scenario and sensitivity support.
- Include QA checks that prove allocated value ties to distributable value.
- Make recoveries ranges when assumptions are uncertain.
- For complex spreadsheet creation or modification, also follow the spreadsheet/modeling skill available in the environment.

Use `references/model-architecture.md` for recommended workbook tabs and formula logic.

## Mechanical calculation helper

For a first-pass simple waterfall or QA cross-check, use `scripts/waterfall_engine.py` with a JSON input. This script only performs a mechanical priority waterfall and is not a substitute for legal, collateral, intercreditor, or plan analysis. See `references/script-waterfall-engine.md` before use.

Do not use the script when collateral pools, deficiency claims, guarantee limitations, or negotiated plan economics are material unless you explicitly adapt the input and explain limitations.

## Senior judgment rules

Always apply these MD-level rules:

- Treat the fulcrum as a negotiation and control question, not just a math output.
- Challenge management projections, valuation multiples, normalized EBITDA, capex, working capital, and exit financing capacity.
- Reconcile model recoveries to trading prices and explain why they differ.
- Separate liquidation floor from reorganization value.
- Show how value break moves under realistic downside cases.
- Identify whether out-of-money classes still have litigation, voting, or nuisance leverage.
- Identify whether money-good classes still have process leverage due to timing, cash interest, default interest, collateral, or consent rights.
- Include new-money dilution, backstop fees, MIP dilution, warrants, and exit financing where relevant.
- Flag absolute-priority, fair-and-equitable, secured-claim, make-whole, default-interest, and intercreditor issues for counsel review.
- Do not imply that a plan is executable just because the waterfall balances.
- Do not present gross purchase-price components, credit bids, or known-funded-debt-only recovery thresholds as distributable recovery without the required net-proceeds, priority-claims, collateral, and allowed-claims support.

## Coordination with other finance skills

Use or defer to related skills when their job is primary:

- `financial-source-of-truth`: source hierarchy, citations, stale-data checks, and assumption labels.
- `financials-normalizer`: normalize statements, filings, PDFs, VDR exports, and KPIs.
- `excel-data-cleaner`: clean raw spreadsheet inputs before modeling.
- `model-audit-tieout`: audit existing models, formulas, signs, links, and source tie-outs.
- `scenario-sensitivity-generator`: build sensitivities, breakevens, downside cases, and stress tests.
- `comps-valuation`, and `dcf-model-builder`: prepare comps, DCF, and valuation support.
- `private-credit-underwriting`, `covenant-package-analyzer`, `lbo-model-build`, and `capital-markets-issuance`: analyze refinancing capacity, leverage, coverage, covenant constraints, and market structure.
- `buyer-investor-list`: identify DIP lenders, rescue capital providers, stalking horse buyers, strategic buyers, or distressed investors.
- `memo-builder`, `pitch-deck-builder`, and `ib-deck-qc`: convert the analysis into circulation materials. Use the canonical `distressed_recovery_waterfall_to_memo_builder`, `distressed_recovery_waterfall_to_pitch_deck_builder`, and `distressed_recovery_waterfall_to_ib_deck_qc` contracts in `../../references/handoff-contracts.md`.

When consuming private-credit watchlist, amendment, default, or recovery context, use `private_credit_underwriting_to_distressed_recovery_waterfall` from `../../references/handoff-contracts.md`. Preserve legal-entitlement economics, negotiated plan economics, collateral/liquidation waterfalls, enterprise-value waterfalls, and counsel-review flags as separate fields.

## Reference map

- `references/source-hierarchy.md`: evidence rules, data-source priority, stale-data checks, and labels.
- `references/workflow.md`: step-by-step distressed recovery process and adaptive modes.
- `references/claims-priority-collateral.md`: claim taxonomy, priority, collateral, guarantor, lien, and intercreditor issues.
- `references/valuation-liquidation.md`: reorganization value, sale value, liquidation value, and sensitivity design.
- `references/restructuring-alternatives.md`: alternatives analysis and stakeholder leverage.
- `references/model-architecture.md`: workbook structure, model logic, outputs, and checks.
- `references/output-templates.md`: default response, memo, board, creditor, and quick-read templates when shortening is justified.
- `references/qa-checklist.md`: MD review checklist, red flags, and failure modes.
- `references/script-waterfall-engine.md`: mechanical script schema and limitations.
- `../../references/output-depth-policy.md`: read when deciding whether a quick-read waterfall is justified; default to `extended_analysis`.
## Validated Handoffs

<!-- GENERATED: validated-handoffs START -->

Producer contracts:
- `distressed_recovery_waterfall_to_memo_builder` -> `memo-builder`. Schema: `../../schemas/distressed_recovery_waterfall_to_memo_builder.schema.json`. Validate with `../../scripts/validate_handoff_payload.py distressed_recovery_waterfall_to_memo_builder handoffs/distressed_recovery_waterfall_to_memo_builder.json` before another skill imports it.
- `distressed_recovery_waterfall_to_pitch_deck_builder` -> `pitch-deck-builder`. Schema: `../../schemas/distressed_recovery_waterfall_to_pitch_deck_builder.schema.json`. Validate with `../../scripts/validate_handoff_payload.py distressed_recovery_waterfall_to_pitch_deck_builder handoffs/distressed_recovery_waterfall_to_pitch_deck_builder.json` before another skill imports it.
- `distressed_recovery_waterfall_to_ib_deck_qc` -> `ib-deck-qc`. Schema: `../../schemas/distressed_recovery_waterfall_to_ib_deck_qc.schema.json`. Validate with `../../scripts/validate_handoff_payload.py distressed_recovery_waterfall_to_ib_deck_qc handoffs/distressed_recovery_waterfall_to_ib_deck_qc.json` before another skill imports it.

Intake validation:
- From `private-credit-underwriting`: require `private_credit_underwriting_to_distressed_recovery_waterfall` and run `../../scripts/validate_handoff_payload.py private_credit_underwriting_to_distressed_recovery_waterfall handoffs/private_credit_underwriting_to_distressed_recovery_waterfall.json` before importing fields into this skill.

Use `../../references/handoff-contracts.md` for canonical field names and shared evidence semantics. Add `--strict` before any model, deck, committee, lender, board, or client-circulation use so placeholders, empty arrays, and empty objects fail instead of becoming assumptions.

Handoff payloads belong under `handoffs/` and must be listed in `manifest.json` as support or agent artifacts with `handoff_contract_name`, `schema_path`, `validator_status`, `validated_at`, and `consumer_skill`. They are never the hero deliverable unless the user explicitly asks for machine-readable output.

<!-- GENERATED: validated-handoffs END -->
## Standalone HTML Path

When HTML is selected or defaulted for a restructuring memo, produce a polished standalone HTML document following `../../references/html-artifact-standard.md`. This skill owns the restructuring judgment, memo hierarchy, citation placement, and board-readiness caveats. Do not create a dashboard render contract, generic dashboard navigation, reader-action bars, table-export controls, or related-files module for ordinary recovery or sale-path analysis.

For a debtor-side board or sale-path memo, a useful first-read hierarchy is:

1. recommendation and decision posture;
2. what the proposed sale path establishes and what remains unproven;
3. DIP, administrative, cure, and transaction-cost gates to recoveries;
4. value break and recovery sensitivity, clearly labeled as illustrative where evidence is incomplete;
5. process alternatives and stakeholder implications;
6. information required before a board recommendation;
7. sources, assumptions, counsel flags, and posture conclusion.

## HTML Evidence Readiness

For senior, client, committee, board, lender, or external postures, every material number, estimate, date-sensitive fact, sourced claim, assumption, and recommendation must have readable point-of-use citation support. Model-derived claims shown in the memo should identify the workbook sheet/cell or range where available. Unknown source identifiers, uncited material figures, missing source registers, or unsupported recovery/board-readiness conclusions are blocking gaps: fix them, downgrade the posture, or present them as explicit diligence requirements.

For reader-facing HTML:

- use plain restructuring language such as `Executed DIP agreement`, `Filed sale agreement`, `Analyst calculation`, `Illustrative sensitivity`, or `Not yet supported`, retaining internal evidence codes only in support data or when requested;
- avoid citation badges that dominate the conclusion or fragment dates and figures; make material claims traceable without turning the memo into an audit interface;
- label recovery percentages based only on known funded unsecured debt as upper-bound sensitivity before unquantified allowed-claim dilution;
- render and visually inspect local HTML with local headless-browser screenshots, not the in-app Browser plugin, before delivery.

## Deliverable Format Standard

Follow `../../references/deliverable-format-policy.md` before creating files. For debtor-side sale-path, restructuring-alternatives, or board-recommendation analysis, the hero deliverable is normally the polished standalone HTML memo. For recovery modeling, waterfall computation, or value-break sensitivity work, use the workbook as hero and a standalone HTML summary only when useful. Do not create Markdown report files as the default rich deliverable. Do not present JSON contracts, manifests, run logs, render contracts, model-citation ledgers, or handoff payloads as the main user-facing output. Keep CSV files as backing ledgers/import layers unless the user explicitly asks for CSV, and explain whether each CSV contains new analysis or only support data.

Final responses should point the user to the hero deliverable first and then any meaningful companion. Mention support artifacts only when requested or useful for an immediate next step.

## Runtime Artifact Path

Default deterministic engine output is `recovery_waterfall.xlsx` with `Cover` first, plus `manifest.json` and `model_citations.json` as internal support. The engine does not generate a dashboard or render contract by default. Legacy Markdown, raw waterfall JSON/CSV, citation ledgers, manifests, and handoff payloads are support artifacts unless explicitly requested. Senior-ready status requires legal-entitlement separation, plan economics, collateral/liquidation support, counsel review flags, source-backed claims hierarchy, and workbook/cell provenance for recovery outputs.
