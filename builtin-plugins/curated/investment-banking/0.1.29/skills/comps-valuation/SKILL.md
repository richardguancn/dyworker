---
name: comps-valuation
description: Produce source-backed trading-comps valuation for Investment Banking in report or workbook mode. Use for peer selection, trading multiples, implied valuation, Excel or Sheets comps models, EV bridges, refreshes, pressure tests, and workbook QA. Do not use for DCF, LBO, merger, three-statement, or non-banker investment decisions.
---

# Comps Valuation

## Skill Configuration

### Common Skill Instructions

MANDATORY: Before searching connectors, retrieving evidence, or drafting output, read and apply the shared runtime contract in `../investment-banking/SKILL.md## Cross-Skill Runtime Contract`. Then check the router skill map and `../../references/plugin-routing-playbook.md` for adjacent skills that should be sequenced with this workflow. Do not run user-context setup or inspection during ordinary workflow work; route only explicit saved-context, source-setup, onboarding, or automation-setup requests to `../user-context/SKILL.md`.

### Source Resolution

Load `../../references/workflow-source-resolution.md`. Resolve only the categories needed for this workflow: `market_data_public_sources` and `models_workbooks_templates`. Use the shared runtime contract to map each attempted category to an available app, connector, file, export, or user-provided input.

## Relevant Dependency Categories

These are the source categories most likely to matter for this workflow. Use the router contract to resolve only the categories the task actually needs, prefer user-named sources first, and state any material source limitation.

- `Market Data & Public Sources`
- `Models, Workbooks & Templates`

## Deliverable Intake

When this skill owns a new substantive user-facing artifact, before source gathering, analysis, modeling, or rendering load `../../references/deliverable-intake-policy.md` and perform its adaptive `request_user_input` preflight for materially unresolved preferences. Downstream support steps inherit resolved preferences and do not re-prompt.

## Artifact Hierarchy

Follow `../../references/artifact-manifest-standard.md`. Preserve validated handoffs, source IDs, routing metadata, and the hero-deliverable hierarchy. Keep JSON, CSV, Markdown, logs, manifests, and handoff payloads secondary unless explicitly requested. Final responses should lead with the hero deliverable, then companion deliverables, then support artifacts when useful.

## Plugin Workflow Routing

For broad transaction workflows, read `../../references/plugin-routing-playbook.md` before selecting or sequencing skills. Keep `comps-valuation` as the comps owner in either mode while preserving routing metadata and the artifact hierarchy of any larger banker-facing package.

## Artifact Contract

Default to `extended_analysis` for a substantive comps request; read `../../references/output-depth-policy.md` before shortening. A report-mode hero is normally a polished standalone HTML valuation report with readable evidence support; a workbook-mode hero is an XLSX workbook with visible source, QA, and valuation support. Use chat-only output only when the user explicitly requests a quick or narrow answer.

Follow `../../references/deliverable-format-policy.md` before creating files. Always identify the hero deliverable first and keep manifests, model-citation ledgers, handoff payloads, CSV imports, and run logs as support artifacts unless explicitly requested.

## Mode Selection

Select the mode from the prompt and available context; do not ask merely because both modes exist.

- `report` mode: peer-set rationale, trading comps read-through, implied valuation, concise peer review, valuation memo/table, or substantial standalone HTML report where no editable or refreshable workbook is requested.
- `workbook` mode: Excel, Google Sheets, XLSX, exported table, refreshable/model-ready comps, linked source tabs, EV bridge formulas, sensitivity tables, update/extend of an existing workbook, or formula/model pressure test.
- If an existing workbook is supplied and the requested result depends on changing or validating it, use `workbook` mode.
- Ask one targeted question only when report and workbook deliverables are both genuinely plausible and selecting the wrong one would cause material rework or prevent the requested use. When possible, state the inferred default and allow correction rather than blocking.

## Common Workflow

1. Identify target, transaction use, valuation date, currency, fiscal basis, sector/module, and required decision output.
2. Inspect supplied files and callable sources before asking for missing details.
3. Build or challenge the peer universe and label exclusions.
4. Validate dates, currency, period basis, EV bridge, denominators, adjustments, outliers, and source posture.
5. Select a valuation range only after peer and metric quality are explicit.
6. Apply the selected mode's output and QA contract.

## Report Mode

Read only as needed:

- `references/workflow-and-qa.md`
- `references/source-and-staleness-rules.md`
- `references/peer-selection.md`
- `references/module-rules.md`
- `references/valuation-readthrough.md`
- `references/output-templates.md`
- `references/investment-banking-integrations.md`

Use `scripts/build_comps_report.py` when deterministic report materialization from structured inputs is appropriate. Substantial analysis defaults to a polished standalone HTML valuation report following `../../references/html-artifact-standard.md`; chat is appropriate only for narrow checks or explicitly quick answers.

## Standalone HTML Path

When HTML is requested or selected for `report` mode, produce a polished standalone HTML comps valuation report following `../../references/html-artifact-standard.md`. This skill owns its report hierarchy, tables, valuation judgment, and evidence presentation. Do not route an ordinary trading-comps HTML report through `dashboard-builder`, create a dashboard render contract, or force the analysis into fixed dashboard modules.

For an initial strategic-alternatives pitch or implied-valuation request, use this first-read hierarchy:

1. Valuation conclusion and output posture: state the selected framework, implied value range, as-of date, and whether it is screening-only, usable-with-caveats, or decision-useful.
2. Selected peer framework: identify the target trading baseline, primary external comparable anchors, context peers, and excluded or outlier names separately.
3. Implied valuation range: show the selected multiple set, target denominator, enterprise-to-equity bridge, share basis, and premium or discount to the observed target price.
4. Premium and discount discussion: distinguish observable public trading support from strategic/control premium scenarios requiring transaction or buyer-specific support.
5. Comparability and normalization issues: explain accounting, lease, FX, period-basis, estimate-vintage, or business-mix limitations that affect the metric selection.
6. Diligence items and sources: state exactly what must be verified before client or external use and provide readable evidence support.

Keep calculation schedules, evidence ledgers, structured data imports, and manifests as support artifacts unless requested. Keep the first-read report table-forward where valuation comparison is central, but do not add generic dashboard navigation, reader-action bars, repeated export controls, visible render contracts, or source-popover machinery merely because the output is HTML.

## Valuation Framing Discipline

- A target company's current trading multiple is a market baseline or reference point, not external peer evidence. Label it separately from comparable-company anchors.
- When only one true external comparable influences the range, describe the selected range as judgmental, screening-oriented, or single-anchor-supported; do not present it as a statistically supported market range.
- When showing a midpoint interpolated between the target baseline and a single external anchor, label it `Illustrative Midpoint`, not `Screening Mid` or language that suggests an independently observed market point.
- In headline metrics, call the baseline-to-external-anchor percentage `Public Comps Uplift` or `Uplift To External Anchor`, not `Premium Range`; reserve premium terminology for a clearly separate strategic/control-premium scenario analysis.
- Keep secondary or mixed-model peers visible as context when helpful, but do not let them drive the selected multiple without an explicit reason.
- Present strategic or control premium scenarios separately from the public trading range unless transaction evidence supports including them in the selected valuation conclusion.
- When lease-accounting, definition, period, currency, or share-basis differences prevent clean comparison, surface the limitation before relying on the affected multiple.

## Workbook Mode

Read only as needed:

- `references/workbook/comps-framework.md`
- `references/workbook/data-sourcing-and-connectors.md`
- `references/workbook/model-workbook-spec.md`
- `references/workbook/qa-and-pressure-testing.md`
- `references/workbook/review-memo-template.md`
- `references/workbook/dashboard-map.md`

Use `scripts/create_comps_template.py` to create workbook scaffolding and `scripts/audit_comps_workbook.py` for mechanical QA support. Preserve functioning user workbook structure before rebuilding. Workbook mode owns build, extend, refresh, and pressure-test variants.

## Validated Handoffs

Before importing seller or management fields from `cim-teardown` into a workbook-mode comps model, require `cim_teardown_to_model_builder` and run `../../scripts/validate_handoff_payload.py cim_teardown_to_model_builder handoffs/cim_teardown_to_model_builder.json`. Use `../../references/handoff-contracts.md` for canonical field names and add `--strict` before model, deck, committee, lender, board, or client-circulation use.

Handoff payloads belong under `handoffs/` and must be listed in `manifest.json` as support or agent artifacts with validator status and consumer metadata. They are never the hero deliverable unless the user explicitly asks for machine-readable output.

## HTML Evidence Readiness

For senior, client, committee, board, lender, or external postures, every material number, estimate, date-sensitive fact, sourced claim, assumption, and recommendation must have readable point-of-use citation support. Model-derived claims should cite workbook, sheet, and cell or range where available.

Unknown citation IDs, missing source registers, uncited material numeric claims, unsupported selected multiples, or unnormalized comparability issues are blocking readiness gaps. Fix them, downgrade the posture, or state the missing support; do not call the output senior/client/committee/board/external-ready while those gaps remain.

For a standalone HTML comps report, provide compact point-of-use citations in the opening valuation conclusion and any headline metric strip for the pricing date, baseline price or multiple, external anchor multiple, and derived implied-value range. Cite complete figures, periods, and metric statements rather than fragmenting linked text or adding repeated citation clutter. Verify that decision-critical public source links used for pricing, filings, and selected-anchor support resolve to the intended source before delivery; when a load-bearing link cannot be validated, identify it as unverified and downgrade the posture or request a replacement source. Keep internal support mechanics out of the visible report; and render and visually inspect local HTML with local headless-browser screenshots, not the in-app Browser plugin, before delivery.

## Boundaries

Use `financials-normalizer` for messy deal financials before reliance, `model-audit-tieout` when standalone model audit is the actual job, and `ib-deck-qc` for final client or committee circulation checks. Do not present legal, tax, fairness, solvency, or formal valuation opinions.
