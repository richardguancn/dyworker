---
name: model-audit-tieout
description: audit existing financial models and workbook outputs. use when the user asks to check formulas, sources, assumptions, sensitivities, links, or model readiness. do not use to build a new model from scratch.
---

# Model Audit Tie-out

## Skill Configuration

### Common Skill Instructions

MANDATORY: Before searching connectors, retrieving evidence, or drafting output, read and apply the shared runtime contract in `../investment-banking/SKILL.md## Cross-Skill Runtime Contract`. Then check the router skill map and `../../references/plugin-routing-playbook.md` for adjacent skills that should be sequenced with this workflow. Do not run user-context setup or inspection during ordinary workflow work; route only explicit saved-context, source-setup, onboarding, or automation-setup requests to `../user-context/SKILL.md`.

## Relevant Dependency Categories

These are the source categories most likely to matter for this workflow. Use the router contract to resolve only the categories the task actually needs, prefer user-named sources first, and state any material source limitation.

- `Models, Workbooks & Templates`
- `Deal Materials`
- `Market Data & Public Sources`

## Deliverable Intake

When this skill owns a new substantive user-facing artifact, before source gathering, analysis, modeling, or rendering load `../../references/deliverable-intake-policy.md` and perform its adaptive `request_user_input` preflight for materially unresolved format, depth, audience/use, or focus choices. For a review of an attached workbook, preserve `.xlsx` as the default presentation surface by producing a separate audit workbook; do not edit the source model unless the user explicitly asks for remediation. When invoked as a downstream support step within an already scoped workflow, inherit resolved preferences and do not re-prompt.

## Artifact Hierarchy

Follow `../../references/artifact-manifest-standard.md` before returning generated files. For a substantive review of an existing financial model, the normal hero deliverable is a polished banker-readable workbook audit pack. Use a standalone HTML audit summary only when the user explicitly requests HTML or the resolved format choice requires a narrative companion. CSV, JSON, Markdown, run logs, manifests, and handoff payloads are support artifacts unless the user explicitly asks for them. Final responses should lead with the hero deliverable, then companion deliverables, then support artifacts in one short sentence if useful.

## Plugin Workflow Routing

For broad transaction workflow prompts, read `../../references/plugin-routing-playbook.md` before selecting or sequencing skills. Use this skill as lead only in the workflows named there; when acting as support, preserve validated handoff fields, source IDs, routing metadata, and the artifact hierarchy so a standalone model-review request results in a banker-facing audit workbook, while a committee memo or deck workflow can consume the audit findings without displacing its own hero deliverable.

## Trigger Boundary

Use this skill to audit an existing financial model, workbook, forecast, valuation file, sensitivity deck, or model-derived output. It is the quality-control layer for formula integrity, workbook structure, source support, assumptions, sensitivities, links, and decision readiness.

Use it when the user asks to check:
- formulas, hardcodes, broken links, circularity, hidden sheets, or workbook hygiene.
- whether model outputs tie to sources, decks, memos, assumptions, or cited documents.
- whether scenarios, downside cases, sensitivities, or model outputs are decision-useful.
- whether a model is ready for IC, credit committee, client delivery, board review, or diligence.

Do not use it to build a new model from scratch. Route new-build work to the relevant builder skill, and only edit or remediate a workbook when the user explicitly asks for changes.

## Role And Non-Role

Role: map the model, diagnose issues, trace outputs to sources, prioritize decision-impacting breaks, and produce an audit pack or fix list.

Non-role: replace DCF, LBO, comps, three-statement, underwriting, memo, deck, or data-cleaning skills. Use those skills after the audit if remediation or synthesis is requested.

## Fast Workflow

1. Define the audit mandate: model type, decision context, materiality threshold, files reviewed, and required output.
2. If a workbook is available, run the workbook audit script unless the task is purely conceptual; if no workbook is available, manually review the excerpts, screenshots, formulas, outputs, or assumptions provided.
3. Map the key outputs and decision drivers to workbook tabs, cells/ranges, formulas, source tabs, and source documents.
4. Apply formula and workbook controls for consistency, hardcodes, external links, hidden sheets, volatility, circularity, and schedule checks.
5. Tie material assumptions and outputs to evidence; use `financial-source-of-truth` standards when source hierarchy, staleness, conflicts, or evidence labels control the answer.
6. Review scenarios and sensitivities for coherent cases, relevant downside drivers, and false precision.
7. Where a clearly identified error affects a material output, create a formula-driven `audit-indicative` diagnostic bridge using stated or sourced inputs to quantify the effect; label it as a diagnostic rather than a remediated model.
8. Build a risk-ranked issue log with severity, category, location, finding, decision impact, recommended fix, and owner.
9. Deliver the requested audit artifact and stop before remediation unless the user asks you to make changes.

## Sub-agent decomposition

For complex medium/large requests, use sub-agents where available; otherwise emulate the split as named workstreams. Suggested lanes: formula controls, source tie-out, scenario review, output consistency, and issue severity. Keep this skill as the lead: reconcile conflicts, source labels, assumptions, open items, final QA, and the user-facing answer.


## Artifact Contract

Default to `extended_analysis` for model review. Use rapid-screen depth only when the user explicitly asks for a quick view, red flags, top issues only, meeting triage, or a narrow follow-up to an existing full audit:
- **Full audit pack:** polished workbook with executive summary, output bridge or material diagnostic where applicable, issue log, formula/workbook controls, source tie-out findings, assumption and scenario critique, remediation sequence, diligence asks, and scope appendix.
- **Rapid screen:** model health score, readiness posture, top issues, must-fix items, and missing files or questions.
- **Formula audit:** formula exception log plus workbook-control findings and recommended fixes.
- **Source tie-out:** source tie-out ledger with model location, model value, source value, tie status, evidence label, as-of date, decision impact, and action.
- **IC-ready audit pack:** executive summary, readiness posture, issue log, formula/workbook controls, source tie-out findings, assumption and scenario critique, remediation sequence, diligence asks, and scope appendix.

Use direct readiness language: `ready for decision`, `ready with caveats`, `not ready`, or `not assessable`.

For a full workbook audit pack, use an insight-led first visible sheet and organize the workbook around these tabs when applicable: `Executive Summary`, `Output Bridge`, `Issue Log`, `Source Tie-Out`, `Formula Controls`, `Model Map`, and `Scope / Evidence / Limitations`. Apply `../../references/workbook-first-tab-standard.md`.

Keep two readiness conclusions distinct: whether the audit pack is complete and usable for internal review, and whether the audited source model is reliable enough for the requested decision. A completed audit pack may properly conclude that the audited model is `not ready`.

Read `../../references/output-depth-policy.md` before shortening.

## Source And Evidence Posture

Material outputs and key assumptions must be traceable to a model tab, cell/range, source document, or explicit user assumption. A model can be mechanically clean but still not decision-ready if its core value, credit, liquidity, covenant, or return drivers are stale, unsupported, contradictory, or assumption-led.

Keep model mechanics separate from investment judgment. Formula errors, stale market data, unsupported add-backs, weak downside cases, and weak source support are different issue types and should be labeled separately.

Keep model-stated assumptions, primary-source facts, model-extracted values, and `audit-indicative` diagnostic calculations distinct. A diagnostic calculation may quantify an identified inconsistency using visible model or sourced inputs, but must not be described as a corrected transaction model, fully remediated output, or client/committee-ready conclusion. When the diagnostic incorporates only part of a disclosed or benchmark amount, separately label the adjustment incorporated and any residual unresolved gap in the executive summary and final response; do not present the residual gap as the diagnostic change.

## Script Map

- `scripts/audit_workbook.py`: static xlsx inspection for a cover-first mechanical-screen workbook, workbook map, formula inventory, issue log, and audit summary JSON. It supports, but does not replace, a judgmental source tie-out and diagnostic audit pack.
- `scripts/requirements.txt`: local script dependencies for workbook inspection.

Run the audit script from the skill directory or pass explicit paths:

```bash
python scripts/audit_workbook.py path/to/model.xlsx --out-dir audit_output
```

`scripts/audit_workbook.py --help` and argument parsing should work without `openpyxl`, but actual workbook inspection requires it. If dependencies cannot be installed or the script cannot run, state that clearly and use the manual audit workflow instead.

## Workbook Evidence Readiness

For internal transaction review, IC, client, committee, board, lender, or external postures, every material output, diagnostic adjustment, date-sensitive fact, sourced assumption, and readiness conclusion must be traceable at the point of use to a workbook tab and cell/range, source document location, or explicit assumption label. Include readable source IDs and as-of dates in the source tie-out ledger; use `model_citations` or an equivalent cell/range citation ledger when a workbook-derived output is used in another artifact.

Separate `Calculation integrity` from `Decision readiness`. A clean static scan, visible model PASS check, or formula tie-out is not evidence that material financing scope, synergy timing, purchase accounting, source support, or decision outputs are reliable. Unsupported material outputs, unexplained conflicts, diagnostic outputs presented as corrected results, or missing source/cell provenance are blocking readiness gaps.

For a workbook audit pack, render and visually inspect the executive summary and each material diagnostic, issue-log, source tie-out, and formula-control sheet before delivery. State explicitly when formulas and cached outputs were inspected without native Excel recalculation.

## Optional HTML Companion

When the user expressly requests HTML, produce a polished standalone audit summary following `../../references/html-artifact-standard.md`, grounded in workbook cell/range provenance and source tie-outs. Keep the workbook as the hero deliverable for model-heavy audit work unless the user explicitly selects a narrative-only surface. Do not route an ordinary model audit or HTML audit summary through `dashboard-builder`, create a dashboard render contract, or force the output into dashboard modules.

## Deliverable Format Standard

Follow `../../references/deliverable-format-policy.md` before creating files. Always identify the hero deliverable first: for ordinary model review, a polished banker-readable XLSX audit pack; for expressly requested narrative explanation, an optional standalone HTML companion or selected narrative-only artifact; otherwise a justified alternate surface. Do not create Markdown report files as the default rich deliverable. Do not present JSON contracts, manifests, run logs, or handoff payloads as the main user-facing output. Keep CSV files as backing ledgers/import layers unless the user explicitly asks for CSV, and explain whether each CSV contains new analysis or only support data.

Final responses should point the user to the hero deliverable first and then briefly explain any supporting artifacts.

## Reference Map

- `references/audit-playbook.md`: read when choosing audit mode, defining the mandate, mapping key outputs, applying model-specific focus areas, or setting readiness posture.
- `references/formula-and-workbook-controls.md`: read when checking formulas, hardcodes, hidden sheets, external links, circularity, schedule controls, or manual checks beyond the script.
- `references/tieout-and-source-checks.md`: read when tracing outputs or assumptions to sources, evidence labels, tie statuses, stale data, and source conflicts.
- `references/issue-taxonomy.md`: read when assigning severity, issue category, owner, escalation level, or rapid-screen health score.
- `references/output-templates.md`: read when producing a rapid screen, full audit memo, issue log, formula exception log, source tie-out ledger, or remediation plan.
- `references/investment-banking-integrations.md`: read when routing to or from other Investment Banking skills after the audit.
- `../../references/workbook-first-tab-standard.md`: required for substantive workbook audit packs.
- `../../references/html-artifact-standard.md`: read only when a standalone HTML audit companion is explicitly requested or selected.
- `../../references/output-depth-policy.md`: read when deciding whether rapid-screen depth is justified; default to `extended_analysis`.
