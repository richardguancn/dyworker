---
name: covenant-package-analyzer
description: Analyze credit documents for covenant definitions, baskets, leakage, headroom mechanics, amendments, and waivers. Use for finance-side covenant reviews, not legal advice.
---

# Covenant Package Analyzer

## Skill Configuration

### Common Skill Instructions

MANDATORY: Before searching connectors, retrieving evidence, or drafting output, read and apply the shared runtime contract in `../investment-banking/SKILL.md## Cross-Skill Runtime Contract`. Then check the router skill map and `../../references/plugin-routing-playbook.md` for adjacent skills that should be sequenced with this workflow. Do not run user-context setup or inspection during ordinary workflow work; route only explicit saved-context, source-setup, onboarding, or automation-setup requests to `../user-context/SKILL.md`.

### Source Resolution

Load `../../references/workflow-source-resolution.md`. Resolve only the categories needed for this workflow: `deal_materials` and `models_workbooks_templates`. Use the shared runtime contract to map each attempted category to an available app, connector, file, export, or user-provided input.

## Relevant Dependency Categories

These are the source categories most likely to matter for this workflow. Use the router contract to resolve only the categories the task actually needs, prefer user-named sources first, and state any material source limitation.

- `Deal Materials`
- `Market Data & Public Sources`
- `Process Updates`
- `Models, Workbooks & Templates`

## Deliverable Intake

When this skill owns a new substantive user-facing artifact, before source gathering, analysis, modeling, or rendering load `../../references/deliverable-intake-policy.md` and perform its adaptive `request_user_input` preflight for materially unresolved preferences. For a covenant package review, amendment analysis, or waiver memo with an unresolved surface, offer `Polished HTML covenant review memo (Recommended)`, `Excel covenant headroom workbook`, and `Word memo (.docx)`. Default to polished standalone HTML when intake is not required or a non-interactive run must apply a default. Select workbook-first output without a format question when the user requests calculations, covenant headroom, basket capacity, or scenarios requiring tabular inputs and formulas. When invoked as a downstream support step within an already scoped workflow, inherit resolved preferences and do not re-prompt.

## Artifact Hierarchy

Follow `../../references/artifact-manifest-standard.md` before returning generated files. The normal hero deliverable for a covenant review, amendment analysis, or waiver memo is a polished standalone HTML finance-side credit memo. Use a workbook as the hero deliverable for computed headroom, basket capacity, or scenario analysis, with a concise standalone HTML explanation as an appropriate companion. CSV, JSON, Markdown, run logs, manifests, and handoff payloads are support artifacts unless the user explicitly asks for them. Final responses should lead with the hero deliverable and any meaningful companion; do not link to render contracts, manifests, or handoff payloads in ordinary delivery responses.

## Plugin Workflow Routing

For broad transaction workflow prompts, read `../../references/plugin-routing-playbook.md` before selecting or sequencing skills. Use this skill as lead only in the workflows named there; when acting as support, preserve validated handoff fields, source IDs, routing metadata, and the artifact hierarchy so the hero deliverable remains the standalone HTML covenant memo, banker-facing headroom workbook, requested native document, or clear first-read package.

## Trigger Boundary

Use this skill for finance-side covenant analysis of credit agreements, indentures, note purchase agreements, term sheets, commitment papers, amendments, waivers, side letters, covenant certificates, and related debt documents.

Lead when the user asks what the borrower can do, what lenders can stop, how covenant ratios bind, how EBITDA and baskets create flexibility, what leakage exists, what negotiation asks matter, or what headroom can be computed from available documents and financials.

Do not present legal advice or final legal interpretation. Route contract drafting, enforceability, governing-law, or clause-language negotiation to legal or contract-review workflows, while framing this skill's output as finance-side analysis for counsel and the deal team.

## Role / Non-Role

Default lead role: document-first covenant and credit-agreement analyst.

Own document universe mapping, operative versions, definitions, baskets, leakage, restricted payments, investments, debt/lien capacity, covenant formulas, EBITDA definitions, collateral and guarantor gaps, amendment mechanics, waiver effects, source-backed headroom framing, and negotiation flags.

Hand off adjacent work:
- `financial-source-of-truth`: source hierarchy, stale-data checks, source conflicts, and fact / assumption / claim labels.
- `financials-normalizer`: reported EBITDA, adjusted EBITDA, normalized EBITDA, lender-after-haircut EBITDA, NWC, and add-back support.
- `private-credit-underwriting`: borrower-level proceed / decline recommendation, risk rating, downside loss view, collateral/recovery view, and credit committee memo.
- `capital-markets-issuance`: issuer-side financing strategy, instrument choice, market window, investor targeting, launch timing, and use-of-proceeds advice.
- `lbo-model-build` or `three-statement-model-builder`: covenant thresholds, liquidity, first-breach timing, debt paydown, and downside case modeling.
- `model-audit-tieout`: covenant calculators, compliance models, borrowing-base files, or uploaded workbook QA.
- `ib-deck-qc`: final committee materials, lender decks, board materials, or client reports.

If the user explicitly invokes `covenant-package-analyzer`, keep this skill as lead and label underwriting, capital markets, model, or legal implications as downstream read-through instead of silently switching ownership.

## Deliverable Modes

Choose the artifact mode independently from the analysis type:

- `covenant_memo`: document-first review of a credit agreement, amendment, waiver, covenant package, or reporting/default question; default hero deliverable is a polished standalone HTML memo.
- `headroom_workbook`: calculation-heavy ratio, basket, usage, or scenario work supported by inputs and governing definitions; default hero deliverable is an XLSX workbook, with an HTML summary when useful.
- `screening_note`: narrow initial screen from incomplete excerpts or public materials; use HTML or chat according to scope while clearly labeling missing reliance inputs.

An amendment or waiver review does not by itself call for a dashboard. Do not route an ordinary covenant review HTML memo through `dashboard-builder`.

For a substantive `covenant_memo`, a full inline Markdown review is not a completed deliverable unless the user explicitly requests chat, Markdown, or no file. When polished HTML is selected or defaulted, create the `.html` artifact, visually inspect it, and return a concise cover note with the HTML file as the hero deliverable.

## Fast Workflow

1. Use available context first: inspect prompt, attachments, prior context, and connectors before asking for documents.
2. Classify the request: term sheet screen, credit agreement teardown, amendment/waiver review, headroom analysis, EBITDA definition review, basket capacity review, or negotiation playbook.
3. Lock the document universe: borrower/issuer, guarantors, collateral agent, lenders, tranches, dates, amendments, and draft/executed status.
4. Create a source index with document type, date, source tier, operative status, missing schedules, and retrieval path.
5. Map capital structure and document stack: facilities, liens, guarantees, maturities, revolver, incremental facilities, intercreditor, collateral, and restricted/unrestricted subsidiaries.
6. Extract controlling definitions: EBITDA, CNI, debt, secured debt, net debt, fixed charges, pro forma basis, available amount, permitted acquisitions, collateral, and subsidiary definitions.
7. Analyze financial covenants, negative covenants, EBITDA add-backs, baskets, leakage paths, collateral/guarantor coverage, reporting, defaults, amendments, waivers, and voting controls.
8. Compute headroom only when definitions and financial inputs support it; otherwise state the exact missing metrics and affected conclusion.
9. Render decision-ready findings with fact/assumption/inference labels, severity, negotiation asks, open items, and downstream handoff.

## Sub-agent decomposition

For complex medium/large requests, use sub-agents where available; otherwise emulate the split as named workstreams. Suggested lanes: document universe, definitions, baskets/leakage, headroom math, and finance-side negotiation flags. Keep this skill as the lead: reconcile conflicts, source labels, assumptions, open items, final QA, and the user-facing answer.


## Artifact Contract

Default output sections:
- `Executive Summary`: recommendation, output posture, top risks, and required next step.
- `Source Base And Scope`: documents reviewed, dates, source tiers, and missing materials.
- `Covenant Package Snapshot`: parties, facilities, collateral, guarantees, financial covenants, reporting, and events of default.
- `Financial Covenant And Headroom`: covenant, threshold, actual, headroom, cushion, test date, and source.
- `EBITDA Definition And Add-Back Risk`: components, caps, pro forma terms, QoE/lender EBITDA gaps, and support needed.
- `Basket And Leakage Map`: debt, liens, RPs, investments, asset sales, junior debt prepayments, unrestricted subsidiaries, and leakage paths.
- `Negotiation Flags`: issue, severity, provision, economic impact, proposed ask, fallback, and owner.
- `Open Items And Data Requests`: exact missing file/value, why it matters, affected conclusion, and minimum substitute.
- `Downstream Handoff`: outputs for financial normalization, underwriting, LBO/forecast modeling, model audit, and deck QC.

For an amendment or waiver review, prefer the following document flow over forcing every generic covenant-package section:

1. executive conclusion and reliance posture;
2. two to four decision-gating questions that must be resolved before reliance;
3. document universe and operative amendment;
4. what the amendment or waiver covers;
5. what it does not waive or establish;
6. reporting deadlines and required deliverables;
7. covenant applicability and headroom gating analysis;
8. residual default, certificate, liquidity, and lender-action risks;
9. information request before reliance;
10. sources and posture conclusion.

Put the gating questions in a concise early callout or table before detailed deadline and headroom tables. For example: whether the reporting delivery occurred, whether required compliance certificates were delivered, whether the springing test applied, and whether the operative ratio calculation is supported. Keep later tables for evidence and mechanics rather than making the reader discover the decision gates there.

When consuming upstream structured context, use the canonical contracts in `../../references/handoff-contracts.md`:
- `capital_markets_issuance_to_covenant_package_analyzer`
- `private_credit_underwriting_to_covenant_package_analyzer`

Never treat proposed covenant capacity or proxy headroom as factual unless operative definitions, latest financials, debt schedule, basket usage, amendments, and prior usage are available or clearly caveated.

End with one posture label from the output reference: `decision-grade`, `diligence-grade`, `screening-only`, `not-supportable`, or `blocked`.

## Source And Evidence Posture

Prioritize user-provided and connected-source documents, then primary public filings and official sources, then trusted secondary sources, with general web search only as fallback. Ask for more only when a missing item changes the conclusion.

Use evidence labels from the source reference in analysis, structured support, and handoffs: `fact_primary`, `fact_secondary`, `management_claim`, `seller_claim`, `third_party_estimate`, `assumption`, `inference`, or `unsupported`. In a reader-facing memo, translate them into plain finance-side descriptions such as `Executed amendment`, `SEC filing`, `Company disclosure`, `Analyst inference`, or `Not yet supported`; do not display raw internal evidence codes as presentation labels unless the user requests them.

Never state that a borrower has covenant capacity unless the operative definition, latest financials, debt schedule, basket mechanics, and relevant prior usage are available or clearly caveated.

## Validated Handoffs

<!-- GENERATED: validated-handoffs START -->

Intake validation:
- From `capital-markets-issuance`: require `capital_markets_issuance_to_covenant_package_analyzer` and run `../../scripts/validate_handoff_payload.py capital_markets_issuance_to_covenant_package_analyzer handoffs/capital_markets_issuance_to_covenant_package_analyzer.json` before importing fields into this skill.
- From `private-credit-underwriting`: require `private_credit_underwriting_to_covenant_package_analyzer` and run `../../scripts/validate_handoff_payload.py private_credit_underwriting_to_covenant_package_analyzer handoffs/private_credit_underwriting_to_covenant_package_analyzer.json` before importing fields into this skill.

Use `../../references/handoff-contracts.md` for canonical field names and shared evidence semantics. Add `--strict` before any model, deck, committee, lender, board, or client-circulation use so placeholders, empty arrays, and empty objects fail instead of becoming assumptions.

Handoff payloads belong under `handoffs/` and must be listed in `manifest.json` as support or agent artifacts with `handoff_contract_name`, `schema_path`, `validator_status`, `validated_at`, and `consumer_skill`. They are never the hero deliverable unless the user explicitly asks for machine-readable output.

<!-- GENERATED: validated-handoffs END -->
## Script Map

- `scripts/scan_covenant_package.py`: first-pass scan of text, HTML, Markdown, JSON, CSV, and DOCX files for covenant terms, EBITDA terms, baskets, leakage terms, events of default, amendments, and issue candidates.
- `scripts/calculate_covenant_headroom.py`: compute headroom from a covenant test CSV when actual metrics and thresholds are available.

Treat scripts as triage aids. Always apply senior credit judgment and cite the governing document source before finalizing.

## HTML Evidence Readiness

For senior, client, committee, board, lender, or external postures, every material covenant threshold, deadline, defined term, waiver statement, compliance conclusion, estimate, assumption, and recommendation must have readable point-of-use citation support. Model-derived claims should cite workbook/sheet/cell or range where available. Unknown citation IDs, missing source registers, uncited material numeric claims, stale operative-document assumptions, or unsupported compliance/headroom conclusions are blocking readiness gaps: fix them, downgrade the posture, or surface them as explicit gaps.

For standalone HTML output, follow `../../references/html-artifact-standard.md` for shared professional styling, structure, accessibility, and local visual-QA requirements.

For a standalone HTML covenant memo:

- use a document-style hierarchy focused on the answer, operative provisions, residual risks, reliance gates, and evidence requests;
- foreground two to four decision-gating questions before detailed deadline or headroom tables in an amendment or waiver review;
- cite material terms and conclusions close to their use, but avoid repeating citation chips on every sentence or adding redundant section-source strips when the claim is already traceable;
- use reader-facing evidence language in visible tables and callouts, while retaining exact evidence codes only in support data or when explicitly requested;
- separate finance-side conclusions from legal questions requiring counsel;
- do not return the entire completed memo as inline Markdown when HTML is selected or defaulted; chat should point to the inspected HTML hero artifact and summarize the conclusion briefly;
- do not create dashboard render contracts, dashboard navigation, default copy/export controls, or related-file modules for ordinary covenant review work;
- render and visually inspect local HTML with local headless-browser screenshots, not the in-app Browser plugin, before delivery.

## Deliverable Format Standard

Follow `../../references/deliverable-format-policy.md` before creating files. For covenant review, amendment analysis, or waiver memo work, the hero deliverable is normally the polished standalone HTML memo. For computed headroom, basket capacity, or scenario work, use the workbook as hero and a standalone HTML summary only when useful. Do not create Markdown report files as the default rich deliverable. Do not present JSON contracts, manifests, run logs, or handoff payloads as the main user-facing output. Keep CSV files as backing ledgers/import layers unless the user explicitly asks for CSV, and explain whether each CSV contains new analysis or only support data.

Final responses should point the user to the hero deliverable first and then any meaningful companion. Mention internal support files only when requested or useful for an immediate next step.

## Reference Map

- Read `references/source-and-evidence.md` when gathering documents, resolving source conflicts, applying evidence labels, checking stale documents, or making data requests.
- Read `references/covenant-analysis-playbook.md` when classifying request type or performing clause-by-clause covenant, definition, collateral, reporting, default, amendment, or waiver review.
- Read `references/baskets-leakage-taxonomy.md` when analyzing EBITDA definition risk, basket mechanics, leakage paths, priming risk, or negotiation asks.
- Read `references/output-templates.md` when formatting the memo, issue log, source base, headroom table, leakage map, data requests, severity, or output posture.
- Read `references/investment-banking-integrations.md` when handing findings to financial normalization, private credit underwriting, LBO/three-statement modeling, model audit, capital markets, or deck QC.
