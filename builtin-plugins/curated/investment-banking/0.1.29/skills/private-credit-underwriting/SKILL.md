---
name: private-credit-underwriting
description: Build borrower-level private credit underwriting views for lender cases, credit memos, debt sizing, downside, liquidity, collateral, recovery, and proceed/decline decisions. Use for lender-side credit decisions, not issuer financing strategy.
---

# Private Credit Underwriting

## Skill Configuration

### Common Skill Instructions

MANDATORY: Before searching connectors, retrieving evidence, or drafting output, read and apply the shared runtime contract in `../investment-banking/SKILL.md## Cross-Skill Runtime Contract`. Then check the router skill map and `../../references/plugin-routing-playbook.md` for adjacent skills that should be sequenced with this workflow. Do not run user-context setup or inspection during ordinary workflow work; route only explicit saved-context, source-setup, onboarding, or automation-setup requests to `../user-context/SKILL.md`.

### Source Resolution

Load `../../references/workflow-source-resolution.md`. Resolve only the categories needed for this workflow: `deal_materials`, `market_data_public_sources`, and `models_workbooks_templates`. Use the shared runtime contract to map each attempted category to an available app, connector, file, export, or user-provided input.

## Relevant Dependency Categories

These are the source categories most likely to matter for this workflow. Use the router contract to resolve only the categories the task actually needs, prefer user-named sources first, and state any material source limitation.

- `Market Data & Public Sources`
- `Deal Materials`
- `Models, Workbooks & Templates`
- `Relationship & Counterparty Context`

## Deliverable Intake

When this skill owns a new substantive user-facing artifact, before source gathering, analysis, modeling, or rendering load `../../references/deliverable-intake-policy.md` and perform its adaptive `request_user_input` preflight for materially unresolved preferences. For a private-credit initial screen, lender underwriting memo, or acquisition-financing credit review with an unresolved surface, offer `Polished HTML lender underwriting memo (Recommended)`, `Excel debt-capacity / lender-case workbook`, and `Word credit memo (.docx)`. Default to polished standalone HTML when intake is not required or a non-interactive run must apply a default. Select workbook-first output without a format question when the user requests reusable debt sizing, liquidity, covenant, or downside calculations. When invoked as a downstream support step within an already scoped workflow, inherit resolved preferences and do not re-prompt.

## Artifact Hierarchy

Follow `../../references/artifact-manifest-standard.md` before returning generated files. The normal hero deliverable for an initial screen or lender underwriting memo is a polished standalone HTML lender memo. Use an XLSX workbook as the hero deliverable for reusable debt-capacity, lender-case, liquidity, covenant, or downside calculations, with a concise standalone HTML explanation as an appropriate companion. Native documents, generated folder first-read files, and justified chat-only answers remain available when requested or appropriate. CSV, JSON, Markdown, run logs, manifests, and handoff payloads are support artifacts unless the user explicitly asks for them. Final responses should lead with the hero deliverable, then companion deliverables, then support artifacts in one short sentence if useful.

## Plugin Workflow Routing

For broad transaction workflow prompts, read `../../references/plugin-routing-playbook.md` before selecting or sequencing skills. Use this skill as lead only in the workflows named there; when acting as support, preserve validated handoff fields, source IDs, routing metadata, and the artifact hierarchy so the hero deliverable remains the banker-facing workbook, standalone HTML lender memo, native deck/document, or clear first-read package.

## Trigger Boundary

Use this skill for borrower-level private credit decisioning: proceed / decline / proceed-with-conditions recommendations, lender cases, credit memos, debt sizing, downside, liquidity, collateral, recovery, sponsor support, monitoring plans, and credit committee synthesis.

Do not use this skill as the lead for issuer-side financing strategy, capital markets window advice, investor targeting, legal covenant interpretation, raw financial cleanup, or sponsor return modeling. Route those to the adjacent skills named below unless the user explicitly invokes `private-credit-underwriting`.

Explicit invocation override: if the user specifically asks to use this skill, keep it as the lead, produce the credit decision view, label adjacent capital markets or covenant-document topics as inputs/caveats, and recommend targeted handoffs.

## Role And Non-Role

Default lead role: **borrower-level private credit underwriter**.

Own:
- credit recommendation, lender case, risk rating, debt sizing, repayment capacity, downside, liquidity, collateral, recovery, sponsor support, monitoring plan, and committee memo synthesis.
- covenant and term-sheet analysis only as part of the credit decision and lender protection package.
- lender EBITDA, lender-after-haircut EBITDA, and covenant proxies when source support is clear or caveated.

Hand off:
- issuer-side financing strategy, ECM/DCM/private-placement market window, investor targeting, launch timing, and use-of-proceeds recommendation to `capital-markets-issuance`.
- document-first covenant definitions, baskets, restricted payments, investments, debt/lien capacity, leakage paths, EBITDA definition interpretation, amendments, and waiver mechanics to `covenant-package-analyzer` using `private_credit_underwriting_to_covenant_package_analyzer` when the output is structured.
- adjusted EBITDA, normalized EBITDA, lender EBITDA, run-rate adjustments, and NWC support to `financials-normalizer` when source-backed normalization is the main job.
- rebuilt operating forecasts and lender-case models to `three-statement-model-builder`.
- sponsor returns, sources and uses, equity value creation, and LBO mechanics to `lbo-model-build`.
- source hierarchy, stale-data checks, conflicts, citation format, and fact/assumption labels to `financial-source-of-truth`.
- distressed, amendment, default, or recovery waterfall analysis to `distressed-recovery-waterfall` using `private_credit_underwriting_to_distressed_recovery_waterfall` when value break, lien priority, or recoveries become central.
- model/formula/source QA to `model-audit-tieout`; final committee or lender-pack circulation checks to `ib-deck-qc`.

## Fast Workflow

1. Lock mandate and evidence posture: borrower, deal type, requested decision, audience, period, currency, units, source base, and whether the output is screening, diligence-grade, or committee-ready.
2. Classify the request: `initial_credit_screen`, `underwriting_memo`, `debt_capacity_workbook`, `terms_protections_review`, `covenant-liquidity`, `qa-review`, or `distressed-watch`.
3. Build the borrower snapshot: business model, revenue drivers, margin structure, cyclicality, concentration, competitive position, management, sponsor, and key risks.
4. Establish the earnings base: reported EBITDA, adjusted EBITDA, normalized EBITDA, lender-after-haircut EBITDA, and covenant EBITDA only when the governing definition is available.
5. Analyze cash conversion and repayment capacity: FCF, working capital, capex, cash taxes, interest, amortization, liquidity, and maturity runway.
6. Build lender and downside cases: stress the drivers that could actually break the credit and identify the first covenant, liquidity, cash-flow, borrowing-base, customer, margin, capex, or maturity breakpoint.
7. Assess structure, covenants, collateral, and recovery: facility terms, tranche priority, lien package, covenant headroom, sponsor support, EV cushion, liquidation value, and loss path.
8. Rate risk and recommend: for an initial screen, lead with a diligence-stage decision; for an underwritten credit view, use proceed / decline / proceed-with-conditions as appropriate. Include required conditions, monitoring package, and exact open items needed to upgrade confidence.

For detailed workflow, read [underwriting-playbook.md](references/underwriting-playbook.md). For risk taxonomy, read [risk-taxonomies.md](references/risk-taxonomies.md).

## Deliverable Modes

Choose the artifact mode from the decision question and calculation depth:

- `initial_credit_screen`: public-source or incomplete-information go / no-go / diligence view. The normal hero is a polished standalone HTML lender underwriting memo, and the maximum posture is `screening-only` or `not-committee-ready` when decision-gating facts are absent. Use a diligence-stage recommendation such as `proceed-to-diligence-only`, `pass-on-diligence`, or `decline`; do not use `proceed-with-conditions`, which implies a supportable credit structure.
- `underwriting_memo`: fuller lender decision memo with sufficient private diligence and source-backed lender cases. The normal hero is a polished standalone HTML lender underwriting memo, with a workbook companion when calculations need reuse.
- `debt_capacity_workbook`: calculation-heavy debt sizing, liquidity, covenant, or downside analysis supported by structured inputs. The normal hero is an XLSX workbook, with a concise standalone HTML companion when useful.
- `terms_protections_review`: structure, collateral, covenant, and lender-protection analysis. Use HTML for narrative decisioning or a workbook when calculated scenarios are central.

For acquisition financing where only target-company public information is available and the borrower perimeter includes an acquirer, sponsor vehicle, or combined company, state prominently: **No combined-borrower underwriting or hold-size conclusion is supportable without acquirer/parent financials, sources and uses, and committed debt terms.** Any displayed target-only debt figure must be labeled an `illustrative standalone cash-interest screening ceiling`, not supportable acquisition-financing capacity or a recommended lender hold.

Disclosed committed acquisition financing supports transaction-execution context or deal-certainty discussion only. Unless its terms and combined-borrower effects are available and underwritten, do not present it as a credit attraction, repayment support, lender protection, or basis for proceeding.

If a public-source screen displays an illustrative debt ceiling, include at least one cash-flow downside dimension as well as financing sensitivity, for example an unlevered FCF haircut alongside cash interest rate or minimum coverage threshold. A debt-level table at a single assumed rate and coverage threshold is not a sufficient downside case.

## Sub-agent decomposition

For complex medium/large requests, use sub-agents where available; otherwise emulate the split as named workstreams. Suggested lanes: borrower snapshot, earnings base, downside/liquidity, covenants/collateral, and committee synthesis. Keep this skill as the lead: reconcile conflicts, source labels, assumptions, open items, final QA, and the user-facing answer.


## Artifact Contract

Default output for `initial_credit_screen`, `underwriting_memo`, and narrative `terms_protections_review` work: `extended_analysis` in the form of a polished standalone HTML lender underwriting memo owned by this skill under `../../references/html-artifact-standard.md`. Do not route an ordinary lender underwriting HTML memo through `dashboard-builder`. Use workbook-first output for `debt_capacity_workbook` or when reusable calculations are central. Use concise chat only for explicit early go/no-go triage, a quick screen, or a narrow update to an existing credit package.

Request classification:

| Type | Default output |
|---|---|
| `initial_credit_screen` | standalone HTML credit screen with go / no-go / diligence asks unless the user explicitly requests a quick screen |
| `underwriting_memo` | standalone HTML full credit memo with recommendation and conditions |
| `debt_capacity_workbook` | workbook-first debt capacity, downside, and liquidity analysis |
| `terms_protections_review` | standalone HTML or workbook structure, pricing, covenants, collateral, and negotiation issues |
| `covenant-liquidity` | covenant bridge, liquidity runway, downside triggers |
| `qa-review` | issue log, missing support, broken logic, readiness verdict |
| `distressed-watch` | default / amendment / recovery readout and escalation plan |

Unless the user asks otherwise, include:

1. `Recommendation and posture`
2. `Borrower snapshot`
3. `Sources and evidence base`
4. `Transaction overview`
5. `Earnings base and QoE view`
6. `Credit metrics`
7. `Lender case and downside`
8. `Covenants, liquidity, and debt service`
9. `Collateral, recovery, and sponsor support`
10. `Key risks and mitigants`
11. `Required Before Credit Committee` as one prioritized gating table, plus monitoring only when the approval path is sufficiently developed
12. `Decision summary and source/evidence appendix`

Do not append a duplicate diligence-gaps module after the memo has already presented the committee gates.

End with one posture label: `screening-only`, `diligence-grade`, `committee-ready-with-caveats`, `not-committee-ready`, or `decline-recommended`. Read [output-templates.md](references/output-templates.md) for templates, monitoring formats, self-checks, and examples.

Read [../../references/output-depth-policy.md](../../references/output-depth-policy.md) before shortening; default to `extended_analysis`.

## Source And Evidence Posture

Do not begin with a broad data request. First inspect the prompt, attachments, prior outputs, callable connected routes, and user-provided exports. If the user references a VDR, model, drive folder, email thread, data room, internal memo, or workspace source, use a scoped runtime route when exposed; otherwise request an export before public web search.

Use the best available source tier:

1. user-provided materials and current conversation context
2. callable connected routes / institutional-source exports
3. transaction documents and diligence files
4. public primary or near-primary sources
5. reputable secondary sources for context only

Maintain material-claim classification using the shared evidence labels from `financial-source-of-truth`: `fact_primary`, `fact_secondary`, `management_claim`, `seller_claim`, `third_party_estimate`, `internal_estimate`, `assumption`, `inference`, `opinion`, and `unsupported`. In the reader-facing HTML memo, translate that taxonomy into natural language such as `SEC-reported`, `management forecast`, `illustrative assumption`, `analyst calculation`, or `not provided`; do not render raw internal taxonomy pills inline in the narrative or core tables. Preserve formal labels in the evidence appendix, manifest, or internal support artifacts where useful for auditability.

Ask the user for more only when a missing item materially changes the recommendation, covenant/liquidity conclusion, or downside loss view. Ask for the exact missing document or field, not a generic data dump. Read [source-and-evidence.md](references/source-and-evidence.md) for full hierarchy, freshness rules, conflict handling, and ask-for-more format.

## Validated Handoffs

<!-- GENERATED: validated-handoffs START -->

Producer contracts:
- `private_credit_underwriting_to_covenant_package_analyzer` -> `covenant-package-analyzer`. Schema: `../../schemas/private_credit_underwriting_to_covenant_package_analyzer.schema.json`. Validate with `../../scripts/validate_handoff_payload.py private_credit_underwriting_to_covenant_package_analyzer handoffs/private_credit_underwriting_to_covenant_package_analyzer.json` before another skill imports it.
- `private_credit_underwriting_to_distressed_recovery_waterfall` -> `distressed-recovery-waterfall`. Schema: `../../schemas/private_credit_underwriting_to_distressed_recovery_waterfall.schema.json`. Validate with `../../scripts/validate_handoff_payload.py private_credit_underwriting_to_distressed_recovery_waterfall handoffs/private_credit_underwriting_to_distressed_recovery_waterfall.json` before another skill imports it.

Intake validation:
- From `capital-markets-issuance`: require `capital_markets_issuance_to_private_credit_underwriting` and run `../../scripts/validate_handoff_payload.py capital_markets_issuance_to_private_credit_underwriting handoffs/capital_markets_issuance_to_private_credit_underwriting.json` before importing fields into this skill.

Use `../../references/handoff-contracts.md` for canonical field names and shared evidence semantics. Add `--strict` before any model, deck, committee, lender, board, or client-circulation use so placeholders, empty arrays, and empty objects fail instead of becoming assumptions.

Handoff payloads belong under `handoffs/` and must be listed in `manifest.json` as support or agent artifacts with `handoff_contract_name`, `schema_path`, `validator_status`, `validated_at`, and `consumer_skill`. They are never the hero deliverable unless the user explicitly asks for machine-readable output.

<!-- GENERATED: validated-handoffs END -->
## Script Map

Use `scripts/calculate_credit_metrics.py` when the user provides tabular financials and optional debt terms. It produces first-pass leverage, coverage, liquidity, covenant-headroom, warning, and report outputs.

Recommended command from this skill directory:

```bash
python3 scripts/calculate_credit_metrics.py \
  --financials assets/borrower_financials_template.csv \
  --terms assets/debt_terms_template.json \
  --outdir /tmp/private_credit_metrics
```

Treat script output as a calculation aid, not a replacement for credit judgment. Read [credit-metrics.md](references/credit-metrics.md) before interpreting script output in a real memo.

## HTML Evidence Readiness

For any polished standalone HTML lender memo, follow `../../references/html-artifact-standard.md`. Give material facts, calculations, assumptions, and recommendations readable point-of-use citation support; keep repeated source badges subordinate to prose readability. Use reader-facing evidence language in the memo body rather than raw internal classification pills. When cited metrics come from a companion workbook, identify the workbook cell or range through `model_citations` / `model_citations_path` when available.

For committee, lender, senior, client, board, or external posture, unknown source IDs, unsupported material numbers, missing calculation basis, unmarked target-only capacity screens, or unresolved combined-borrower gaps are blocking readiness gaps. Fix them, cap the posture, or surface the missing support explicitly; do not call the output committee-ready while they remain.

Before delivery, render and visually inspect local HTML with local headless-browser screenshots, not the in-app Browser plugin. Inspect the opening recommendation, lender case and downside, committee gates, and source appendix. Repair duplicated dashboard-style modules, clipped tables, or misleading capacity language before returning the artifact.

## Deliverable Format Standard

Follow `../../references/deliverable-format-policy.md` before creating files. Always identify the hero deliverable first: normally a polished standalone HTML lender underwriting memo, an XLSX debt-capacity / lender-case workbook when reusable calculations are central, a requested native deck/document, a generated folder, or a justified chat-only answer. Do not create Markdown report files as the default rich deliverable. Do not present JSON contracts, manifests, run logs, or handoff payloads as the main user-facing output. Keep CSV files as backing ledgers/import layers unless the user explicitly asks for CSV, and explain whether each CSV contains new analysis or only support data.

Final responses should point the user to the hero deliverable first and then briefly explain any supporting artifacts.

## Reference Map

Load references selectively:

| Reference | Read when |
|---|---|
| [source-and-evidence.md](references/source-and-evidence.md) | deciding source hierarchy, evidence labels, stale-data treatment, public-source fallback, source conflicts, or targeted data requests |
| [underwriting-playbook.md](references/underwriting-playbook.md) | producing a full credit memo, credit screen, committee readout, borrower snapshot, earnings base, lender case, or recommendation framework |
| [credit-metrics.md](references/credit-metrics.md) | calculating ratios, debt capacity, EBITDA bases, covenant headroom, downside cases, warning signs, or interpreting script output |
| [terms-covenants-collateral.md](references/terms-covenants-collateral.md) | reviewing term sheets, facility structure, covenants, collateral, lien priority, sponsor support, recovery, or distressed loss paths |
| [risk-taxonomies.md](references/risk-taxonomies.md) | building risk registers, severity labels, mitigants, risk ratings, watchlist triggers, or monitoring escalation logic |
| [output-templates.md](references/output-templates.md) | drafting full memos, quick screens, monitoring updates, data requests, QA reviews, self-checks, or reusable table formats |
| [examples.md](references/examples.md) | needing compact example language for screens, debt-sizing conclusions, covenant/liquidity summaries, distressed-watch updates, or decline recommendations |
| [investment-banking-integrations.md](references/investment-banking-integrations.md) | coordinating upstream/downstream handoffs with other Investment Banking skills |
| [../../references/handoff-contracts.md](../../references/handoff-contracts.md) | consuming `capital_markets_issuance_to_private_credit_underwriting` or exporting covenant/restructuring handoff packages with exact field names |
| [../../references/output-depth-policy.md](../../references/output-depth-policy.md) | deciding whether a quick screen or abbreviated update is justified; defaulting to `extended_analysis` |
