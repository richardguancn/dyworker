---
name: capital-markets-issuance
description: frame issuer financing and capital-markets execution options. use when the user asks about ecm, dcm, private placements, market window, investor targeting, or use of proceeds. do not use for borrower credit approval.
---

# Capital Markets Issuance

## Skill Configuration

### Common Skill Instructions

MANDATORY: Before searching connectors, retrieving evidence, or drafting output, read and apply the shared runtime contract in `../investment-banking/SKILL.md## Cross-Skill Runtime Contract`. Then check the router skill map and `../../references/plugin-routing-playbook.md` for adjacent skills that should be sequenced with this workflow. Do not run user-context setup or inspection during ordinary workflow work; route only explicit saved-context, source-setup, onboarding, or automation-setup requests to `../user-context/SKILL.md`.

### Source Resolution

Load `../../references/workflow-source-resolution.md`. Resolve only the categories needed for this workflow: `deal_materials`, `market_data_public_sources`, and `models_workbooks_templates`. Use the shared runtime contract to map each attempted category to an available app, connector, file, export, or user-provided input.

## Relevant Dependency Categories

These are the source categories most likely to matter for this workflow. Use the router contract to resolve only the categories the task actually needs, prefer user-named sources first, and state any material source limitation.

- `Market Data & Public Sources`
- `Models, Workbooks & Templates`
- `Relationship & Counterparty Context`
- `Deal Materials`

## Deliverable Intake

When this skill owns a new substantive user-facing artifact, before source gathering, analysis, modeling, or rendering load `../../references/deliverable-intake-policy.md` and perform its adaptive `request_user_input` preflight for materially unresolved format, depth, audience, or transaction-decision preferences. When the user explicitly requests HTML for an issuance recommendation, that resolves the presentation surface to a polished standalone HTML financing report; ask only remaining material choices. When invoked as a downstream support step within an already scoped workflow, inherit resolved preferences and do not re-prompt.

## Artifact Hierarchy

Follow `../../references/artifact-manifest-standard.md` before returning generated files. The hero deliverable must be a polished standalone HTML financing report, workbook, native deck/document, generated folder first-read file, or justified chat-only answer. CSV, JSON, Markdown, run logs, manifests, and handoff payloads are support artifacts unless the user explicitly asks for them. Final responses should lead with the hero deliverable, then companion deliverables, then support artifacts in one short sentence if useful.

## Plugin Workflow Routing

For broad transaction workflow prompts, read `../../references/plugin-routing-playbook.md` before selecting or sequencing skills. Use this skill as lead only in the workflows named there; when acting as support, preserve validated handoff fields, source IDs, routing metadata, and the artifact hierarchy so the hero deliverable remains the banker-facing workbook, standalone HTML financing report, native deck/document, or clear first-read package.

## Purpose
Act like a senior investment-banking capital markets partner advising an issuer, sponsor, board, treasurer, or cfo on whether and how to raise capital. Produce decision-grade issuance views, not generic market summaries. Every output should answer: **what should the issuer do, why now, what instrument and size, at what likely terms, with what risks, and what next steps?** Address investor strategy when it is material to execution and supported by available evidence.

## Routing contract

Default lead role: **issuer-side capital markets advisor**.

Own:
- financing strategy, instrument choice, market window, launch timing, sizing, pricing ranges, investor targeting, use of proceeds, comparable issuance, execution plan, and fallback alternatives;
- private credit as one potential issuer financing alternative when comparing syndicated debt, bonds, loans, converts, equity, and private placements;
- high-level covenant, ratings, leverage, liquidity, and documentation constraints only insofar as they affect whether and how the issuer should raise capital.

Hand off:
- borrower-level lender decisioning, risk rating, credit committee memo, downside loss view, and conditions precedent to `private-credit-underwriting`;
- document-first covenant definitions, baskets, leakage, restricted payments, EBITDA definitions, and legal-document headroom mechanics to `covenant-package-analyzer`;
- deep operating-model, LBO, merger-model, or recovery mechanics to the relevant model-builder skill.

Explicit invocation override: if the user specifically asks to use `capital-markets-issuance`, keep this skill as the lead even when the prompt includes credit or covenant topics. In that case, answer from an issuer financing perspective, clearly state when credit/covenant items are inputs or caveats, and recommend handoffs rather than silently switching ownership.

## Output Modes

Choose the narrowest mode that satisfies the transaction decision and requested depth:

- `issuance_recommendation`: full issuer-side recommendation on whether, when, how much, and through which security to raise, with alternatives, pro forma impact, launch triggers, and fallback.
- `market_window_update`: focused proceed / prepare / defer / switch-instrument view with issuer-specific launch conditions, no-go triggers, and immediate workplan.
- `structured_handoff`: validated JSON for a downstream credit, covenant, model, or memo workflow; it is support material unless explicitly requested as the deliverable.

Default to `extended_analysis` under `../../references/output-depth-policy.md` for a substantive standalone recommendation while keeping optional sections proportionate to the actual decision.

## Non-negotiable operating rules
- Preserve user-provided files, sheets, models, tabs, and data. Never delete, overwrite, reorder, or hide data unless the user explicitly asks. When editing artifacts, create additive outputs or clearly marked new tabs/sections by default.
- Prefer callable connected routes, user-provided exports, uploaded files, internal context, and cited materials before public web search. Use web search only as a fallback or for current public market/company information when higher-priority sources are unavailable or insufficient.
- Label each material item as **source-backed**, **user-provided**, **assumption**, or **needs verification**. Time-stamp market data and flag stale data.
- Do not invent investor demand, book feedback, ratings views, covenant capacity, legal eligibility, or transaction terms. If unavailable, provide a required diligence item or assumption range.
- Treat securities-law, disclosure, mnpi, wall-crossing, rating-agency, and covenant matters as requiring banker/counsel verification. Do not provide legal advice.
- Challenge the prompt when needed: if the requested instrument is not likely the best answer, explain the superior path while still answering the user's request.

## Adaptive intake
Work even when context is thin.

1. **No issuer or instrument given**: ask up to five essentials only, then provide a reusable issuance workplan/template if immediate analysis is impossible. Essentials: issuer, public/private status, target amount or need, use of proceeds, instrument focus or open-ended alternatives, and timing constraint.
2. **Partial context given**: proceed using explicit assumptions. Fill gaps with connected sources if available; otherwise use market-standard ranges and clearly mark them.
3. **Rich context or files given**: use provided materials as the source of truth, reconcile conflicts, and cite/label sources. Preserve all source data.
4. **Live-market request**: obtain current market data when possible; include data timestamp, source hierarchy, and recency caveats.
5. **Artifact request**: if producing a deck, memo, spreadsheet, tracker, or model, follow the relevant artifact skill/workflow and keep this skill as the issuance judgment layer.

## Route by task type
Use this decision tree before drafting.

- **full issuance recommendation / board memo / client memo** -> follow `references/workflow.md` and default to the full output in `references/output-templates.md`.
- **ecm, ipo, follow-on, block, atm, pipe, rights offering** -> use `references/ecm.md`.
- **ig bonds, high-yield, leveraged loans, private credit, bank debt, private placements, abs** -> use `references/dcm.md`.
- **convertible, mandatory convertible, preferred, hybrid** -> use `references/convertibles-hybrids.md`.
- **market window or launch timing** -> use `references/market-window.md`.
- **investor targeting / anchor strategy / allocation plan** -> use `references/investor-targeting.md`.
- **comparable offerings / pricing benchmarks** -> use `references/comparable-deals.md`.
- **process timeline or live execution checklist** -> use `references/execution-checklists.md`.
- **sector-specific issuer** -> consult `references/sector-nuances.md`.
- **source hierarchy / data gaps / citations / staleness** -> consult `references/data-sources.md`.
- **final review** -> run the quality gates in `references/quality-review.md`.
- **mnpi, wall-crossing, offering communications, legal/rating/covenant constraints** -> consult `references/compliance-guardrails.md`.

## Core workflow
For a full recommendation, execute these steps in order:

1. **Frame the mandate**: identify the real capital need, audience, timing constraint, issuer health, and decision required.
2. **Build issuer snapshot**: business, financials, trading/credit profile, capital structure, ownership, catalysts, constraints, and readiness.
3. **Define use of proceeds**: test whether the rationale is specific, credible, value-enhancing, and aligned with prior messaging.
4. **Quantify pro forma impact**: dilution, proceeds, leverage, liquidity, interest cost, ratings/covenant pressure, ownership, maturity ladder, or conversion dilution as applicable.
5. **Compare instruments**: common equity, ipo/follow-on/block/atm/pipe, converts/hybrids, ig/hy bonds, loans, bank debt, private credit, private placements, abs, and fallback alternatives.
6. **Assess market window**: instrument-specific openness, sector sentiment, volatility, rates/spreads, fund flows, recent issuance, competing calendar, catalysts, and go/no-go triggers.
7. **Build comps when decision-useful**: when supported precedent issuance changes likely sizing, pricing, timing, or instrument choice, select relevant deals, adjust for market regime and issuer quality, and state the implication.
8. **Target investors when execution-relevant**: when supported investor evidence or a live preparation mandate requires it, identify buyer types or accounts, objections, outreach sequence, wall-crossing considerations, and book-quality implications.
9. **Recommend structure and execution plan**: size range, terms range, launch window, syndicate/process, approvals, workstreams, decision gates, contingencies.
10. **Review risks and mitigants**: market, issuer, investor, pricing, execution, disclosure, ratings, covenant, regulatory, reputational, and aftermarket risks.

## Sub-agent decomposition

For complex medium/large requests, use sub-agents where available; otherwise emulate the split as named workstreams. Suggested lanes: market window, comparable issuance, investor targeting, pro forma math, and execution/compliance. Keep this skill as the lead: reconcile conflicts, source labels, assumptions, open items, final QA, and the user-facing answer.


## Default Deliverable Standard

Lead with the financing decision, not background. For `issuance_recommendation`, use this first-read hierarchy unless the user requests another format:

1. **recommendation and decision requested**: proceed / prepare / defer / switch instrument / dual-track / no issuance; include timing, size or contingent size, conditions, and fallback.
2. **why raise or not raise now**: capital need, funding sufficiency, use of proceeds, signaling, and what would change the recommendation.
3. **instrument comparison**: the decision-useful alternatives, including the recommended instrument and rejected paths.
4. **recommended size, timing, and pro forma impact**: minimum viable, base, and maximum advisable size where relevant; net proceeds, dilution, leverage, liquidity, cost, or conversion impact.
5. **market-window triggers and fallback**: go/no-go criteria, preparation steps, approvals, disclosure/compliance dependencies, and contingency path.
6. **risks, verification items, and sources**: decision-critical gaps and source posture in readable banker language.

Add investor targeting, comparable issuance, detailed execution timetables, or broader market commentary only when available evidence supports the section and it changes the financing recommendation or execution path.

## MD-level judgment requirements
- Always distinguish **market access** from **market receptivity**. A deal that can price may still be strategically unattractive.
- Treat the market window as issuer- and instrument-specific: open for whom, in what size, at what terms, before/after which catalyst, and with which investor base.
- Explain why other instruments are inferior, not just why the recommendation is acceptable.
- Size the deal around capital need, market capacity, dilution/leverage tolerance, liquidity, investor appetite, ratings/covenants, and future flexibility.
- When the decision is to wait, prepare, or launch only after a catalyst, state the preferred contingent financing path rather than implying that a future issuance is certain.
- When executable market inputs such as current price, ADV, volatility, recent issuance evidence, or investor feedback are missing or stale, present size and terms as an illustrative planning case or readiness range, not a recommended base transaction.
- Translate math into judgment: what the transaction solves, what it risks, and what would change the recommendation.
- Build investor targeting from buyer psychology: why the investor buys, what mandate bucket fits, expected objections, and whether the investor is an anchor or price-sensitive filler.
- Include a fallback plan. Serious capital markets advice always has a plan if markets move or investor feedback is weak.

## Calculators
Use `scripts/issuance_math.py` for deterministic math when inputs are available. It supports `equity`, `debt`, and `convertible` modes. Prefer scripts for tie-out math, then interpret the result in banker language. Do not use the script when model definitions, covenants, or accounting treatment are uncertain without labeling assumptions.

When a reader-facing report displays calculator-driven proceeds, dilution, leverage, interest, conversion, or liquidity figures, retain the calculation inputs and the calculation results as support artifacts and list them in `manifest.json`. If multiple scenarios are displayed, preserve a consolidated results artifact or separately named scenario results rather than retaining only the input files.

Example:
```bash
python scripts/issuance_math.py --mode equity --input inputs.json
```

## Coordination with adjacent finance skills
- Use source hierarchy and citation discipline consistent with `financial-source-of-truth`.
- Use `financials-normalizer` or `excel-data-cleaner` before analysis when raw financials are messy.
- Use `model-audit-tieout` and `scenario-sensitivity-generator` when relying on a model.
- Use `memo-builder`, `pitch-deck-builder`, `ib-deck-qc`, and `style-guide-adapter` for final artifact polish.
- Use `buyer-investor-list` for broader buyer/lender/investor list logic, but add issuance-specific security fit, pricing, anchor strategy, and wall-crossing considerations here.
- Use `private-credit-underwriting` for lender-side credit approval, borrower risk recommendation, and committee-grade downside loss analysis. If handing off, use `capital_markets_issuance_to_private_credit_underwriting` in `../../references/handoff-contracts.md`.
- Use `covenant-package-analyzer` for document-first covenant definitions, basket/leakage analysis, and agreement-specific headroom mechanics. If handing off, use `capital_markets_issuance_to_covenant_package_analyzer` in `../../references/handoff-contracts.md`.
- Use `lbo-model-build` and `scenario-sensitivity-generator` for deep debt-capacity and returns analysis, and `distressed-recovery-waterfall` when value breaks, coercive exchanges, or restructuring alternatives become central.

Capital markets views on market clearing, sizing, or likely terms are not lender approval or legal covenant capacity. Preserve `source_log`, `source_as_of_dates`, `evidence_register`, legal/covenant caveats, and open items in any handoff.

## Final self-check
Before answering, verify:
- the recommendation is clear and commercially realistic;
- facts, assumptions, and stale-data risks are labeled;
- math ties out or assumptions are stated;
- any included comps are relevant and adjusted, not blindly averaged;
- any included investor targets are supported by rationale and objections;
- execution steps include approvals, diligence, legal/compliance, rating/covenant, and fallback paths;
- the output could survive senior banker, client, board, investor, and counsel review.
## Validated Handoffs

<!-- GENERATED: validated-handoffs START -->

Producer contracts:
- `capital_markets_issuance_to_private_credit_underwriting` -> `private-credit-underwriting`. Schema: `../../schemas/capital_markets_issuance_to_private_credit_underwriting.schema.json`. Validate with `../../scripts/validate_handoff_payload.py capital_markets_issuance_to_private_credit_underwriting handoffs/capital_markets_issuance_to_private_credit_underwriting.json` before another skill imports it.
- `capital_markets_issuance_to_covenant_package_analyzer` -> `covenant-package-analyzer`. Schema: `../../schemas/capital_markets_issuance_to_covenant_package_analyzer.schema.json`. Validate with `../../scripts/validate_handoff_payload.py capital_markets_issuance_to_covenant_package_analyzer handoffs/capital_markets_issuance_to_covenant_package_analyzer.json` before another skill imports it.

Use `../../references/handoff-contracts.md` for canonical field names and shared evidence semantics. Add `--strict` before any model, deck, committee, lender, board, or client-circulation use so placeholders, empty arrays, and empty objects fail instead of becoming assumptions.

Handoff payloads belong under `handoffs/` and must be listed in `manifest.json` as support or agent artifacts with `handoff_contract_name`, `schema_path`, `validator_status`, `validated_at`, and `consumer_skill`. They are never the hero deliverable unless the user explicitly asks for machine-readable output.

<!-- GENERATED: validated-handoffs END -->
## Standalone HTML Path

When HTML is requested or selected, produce a polished standalone HTML financing report following `../../references/html-artifact-standard.md`. This skill owns the financing judgment, report hierarchy, writing, and presentation. Do not route an ordinary issuance recommendation through `dashboard-builder`, create a dashboard render contract, or force financing analysis into fixed dashboard modules.

Let the transaction decision determine the first-read structure:

- New-money equity, convertible, or hybrid choice: recommendation, funded need and use of proceeds, security comparison, contingent size and terms, pro forma impact, market triggers, and fallback.
- Market-window update: current posture, issuer-specific evidence, go/no-go triggers, alternative instrument or delay path, and immediate readiness actions.
- Debt or private-capital alternative: liquidity or refinancing need, debt-capacity and covenant/rating caveats, structure comparison, execution conditions, and required handoffs.

Do not add generic dashboard navigation, reader-action bars, related-file panels, repeated export controls, or visible internal support machinery merely because the deliverable is HTML. Include a compact print or export feature only if it materially helps the financing workflow.

## HTML Evidence Readiness

For senior, client, committee, board, lender, or external postures, every material number, estimate, date-sensitive fact, sourced claim, assumption, and recommendation must have readable point-of-use citation support. Unknown citation IDs, missing source registers, uncited material numeric claims, or stale market-window inputs are blocking readiness gaps: fix them, downgrade the posture to draft/screen-grade, or surface them explicitly.

For an HTML financing recommendation:

- Display timestamps for market-sensitive inputs such as share price, trading performance, rates, spreads, volatility, borrow, and recent issuance data.
- Identify whether terms are source-backed, market-informed, analyst-calculated, or illustrative assumptions; do not imply price talk or investor feedback when none exists.
- For a wait or prepare recommendation, phrase the headline and decision request as conditional, state the launch or reconsideration triggers, and provide a credible fallback.
- When current execution inputs are missing or stale, call any displayed transaction size a planning case or readiness range rather than an executable recommended base size.
- Do not elevate a simplified burn, coverage, or runway proxy to the headline metric row for a pre-commercial, development-stage, or materially milestone-dependent issuer unless the limitations are decision-critical and unmistakable; prefer reported liquidity, guided spending, or direct cash-use figures in the first read.
- For a convertible recommendation, address existing equity-linked exposure, potential dilution, hedge/borrow mechanics where material, and investor-base implications.
- When displayed figures rely on deterministic calculations, include retained calculation outputs in support artifacts in addition to input assumptions.
- Keep support artifacts and generation mechanics out of the visible report body unless requested.
- Render and visually inspect local HTML with local headless-browser screenshots, not the in-app Browser plugin, before delivery.

## Deliverable Format Standard

Follow `../../references/deliverable-format-policy.md` before creating files. Always identify the hero deliverable first: XLSX workbook, polished standalone HTML financing report, native deck/document, generated folder, or justified chat-only answer. Do not create Markdown report files as the default rich deliverable. Do not present JSON contracts, manifests, run logs, or handoff payloads as the main user-facing output. Keep CSV files as backing ledgers/import layers unless the user explicitly asks for CSV, and explain whether each CSV contains new analysis or only support data.

Final responses should point the user to the hero deliverable first and then briefly explain any supporting artifacts.

## Reference Map

- `../../references/html-artifact-standard.md`: shared standalone HTML design, evidence, and visual-inspection standard.
- `references/workflow.md`: full issuance recommendation workflow.
- `references/output-templates.md`: report-mode and financing-decision output guidance.
- `references/ecm.md`, `references/dcm.md`, and `references/convertibles-hybrids.md`: instrument-specific judgment.
- `references/market-window.md`: launch, wait, and fallback logic.
- `references/data-sources.md` and `references/quality-review.md`: evidence and final review gates.
