---
name: dcf-model-builder
description: Use when building code-backed DCF exports, WACC/terminal value work, EV-to-equity bridges, sensitivities, or price targets; not comps-only.
---

# DCF Model Builder

## Skill Configuration

### Common Skill Instructions

MANDATORY: Before searching connectors, retrieving evidence, or drafting output, read and apply the shared runtime contract in `../investment-banking/SKILL.md## Cross-Skill Runtime Contract`. Then check the router skill map and `../../references/plugin-routing-playbook.md` for adjacent skills that should be sequenced with this workflow. Do not run user-context setup or inspection during ordinary workflow work; route only explicit saved-context, source-setup, onboarding, or automation-setup requests to `../user-context/SKILL.md`.

## Relevant Dependency Categories

These are the source categories most likely to matter for this workflow. Use the router contract to resolve only the categories the task actually needs, prefer user-named sources first, and state any material source limitation.

- `Market Data & Public Sources`
- `Models, Workbooks & Templates`
- `Deal Materials`

## Deliverable Intake

When this skill owns a new substantive user-facing artifact, before source gathering, analysis, modeling, or rendering load `../../references/deliverable-intake-policy.md` and perform its adaptive `request_user_input` preflight for materially unresolved preferences. When invoked as a downstream support step within an already scoped workflow, inherit resolved preferences and do not re-prompt.
## Plugin Workflow Routing

For broad transaction workflow prompts, read `../../references/plugin-routing-playbook.md` before selecting or sequencing skills. Use this skill as lead only in the workflows named there; when acting as support, preserve validated handoff fields, source IDs, routing metadata, and the artifact hierarchy so the hero deliverable remains the banker-facing workbook or an explicitly requested standalone HTML valuation summary, native deck/document, or clear first-read package.

Use for DCF, intrinsic value, FCFF/FCFE, WACC, terminal value, EV-to-equity, per-share value, and price-target work. Do not use for comps-only, audits, LBO, merger, memo, or deck-QC work.

## Artifact Hierarchy

Follow `../../references/artifact-manifest-standard.md` before returning generated files. For substantive DCF work, the normal hero deliverable is a polished banker-readable workbook with an insight-led first visible tab. Create a standalone HTML valuation summary only when the user explicitly requests HTML or a narrative companion; the workbook remains the model source of truth. CSV, JSON, Markdown, run logs, manifests, model-citation ledgers, and handoff payloads are support artifacts unless the user explicitly asks for them. Final responses should lead with the hero deliverable, then companion deliverables, then support artifacts in one short sentence if useful.

## Workflow
1. Classify: template, partial-context screen, full-plan run, deterministic export, formula workbook, or handoff.
2. Read only needed references; usually `plan-schema.md`, `output-spec.md`, and integrations.
3. Create or locate `plan.json`; preserve user assumptions and source labels.
4. Validate, run the requested export, read the run log, and build the first-read workbook view around valuation range, market read-through, drivers, source posture, and open items.
5. Keep calculation integrity and decision readiness separate: formula/control tie-outs may be `OK` while source readiness remains `OPEN` or `screen-grade`.
6. Render and visually inspect the workbook summary, valuation, assumptions/sources, sensitivities, and checks tabs before reporting artifacts.
7. Hard failures mean `not-decision-ready`. Estimate- or placeholder-driven value means open with `Screen-grade only; forecast, WACC, and terminal assumptions require review.`

## Sub-agent decomposition

For complex medium/large requests, use sub-agents where available; otherwise emulate the split as named workstreams. Suggested lanes: source support, historical normalization, forecast drivers, WACC/terminal value, sensitivities, and audit. Keep this skill as the lead: reconcile conflicts, source labels, assumptions, open items, final QA, and the user-facing answer.


## Artifacts
`deterministic_export`: write to the selected `--output-dir` (default `./output` from the caller's current working directory). The hero deliverable is `model.xlsx`, opening on a banker-readable `Cover`, `Executive Summary`, or `Dashboard` tab per `../../references/workbook-first-tab-standard.md`. Agent-facing support artifacts are `plan.json`, `run_log.json`, and `manifest.json`. Write legacy `report.md` only when explicitly requested with `--write-report-md`.

`banker_formula_workbook`: formula workbook plus separate run log and manifest; not arbitrary formula generation.

## Validated Handoffs

<!-- GENERATED: validated-handoffs START -->

Intake validation:
- From `cim-teardown`: require `cim_teardown_to_model_builder` and run `../../scripts/validate_handoff_payload.py cim_teardown_to_model_builder handoffs/cim_teardown_to_model_builder.json` before importing fields into this skill.

Use `../../references/handoff-contracts.md` for canonical field names and shared evidence semantics. Add `--strict` before any model, deck, committee, lender, board, or client-circulation use so placeholders, empty arrays, and empty objects fail instead of becoming assumptions.

Handoff payloads belong under `handoffs/` and must be listed in `manifest.json` as support or agent artifacts with `handoff_contract_name`, `schema_path`, `validator_status`, `validated_at`, and `consumer_skill`. They are never the hero deliverable unless the user explicitly asks for machine-readable output.

<!-- GENERATED: validated-handoffs END -->
## Script Map
- `scripts/validate_plan.py path/to/plan.json`
- `scripts/run_pipeline.py path/to/plan.json --output-dir output --print-report`
- `scripts/build_banker_formula_workbook.py path/to/plan.json --output-dir output`
- `scripts/*_runtime`: private engine internals; inspect only while debugging scripts.

## Workbook Evidence Readiness

The workbook is the analytical source of truth. For senior, client, committee, board, lender, or external postures, every material input and derived output must be traceable through readable source notes and `model_citations` / `model_citations_path` records down to workbook sheet/cell or range where available.

Unknown source IDs, missing model citations for headline valuation outputs, stale market or bridge inputs, unsupported terminal assumptions, or uncited material numeric claims are blocking readiness gaps. Fix them, cap the posture at `screen-grade`, or surface the gaps explicitly; do not call a workbook senior/client/committee/board/external-ready while they remain.

The first visible tab must display two explicitly labeled status fields in its first-read status block: `Calculation integrity` and `Decision readiness`. Do not summarize a workbook as `OK` merely because formula and tie-out checks pass when forecast, WACC, terminal value, equity bridge, or share-count evidence remains open.

For public-company strategic alternatives or market-reference work, make the current trading reference, premium or discount, terminal-value concentration, and unresolved bridge/share-count choices visible in the first-read view. When current trading materially diverges from base value, include a controlled numeric reverse-DCF output: hold the base valuation framework constant while solving for an operating assumption, or hold base operating assumptions constant while solving for WACC or terminal growth. Do not treat proximity to a composite downside or upside scenario as a substitute for that test.

For headline derived outputs such as enterprise value, equity value, per-share value, premium/discount, or a market-implied solved assumption, model-citation records must include the material upstream operating, WACC, terminal-value, EV-to-equity bridge, share-count, and market-reference dependencies used in the calculation. Record formula-error scan outcomes in the run log as an explicit result or match count; do not defer this evidence only to transient console output.

## Optional HTML Companion

When the user explicitly requests an HTML report or visual valuation summary, keep this skill as the analytical owner and produce a polished standalone HTML companion following `../../references/html-artifact-standard.md`. Do not route an ordinary DCF HTML summary through `dashboard-builder`, create a dashboard render contract, or force workbook-derived valuation findings into fixed dashboard modules.

In that HTML companion, cite workbook-derived valuation outputs to exact workbook cell/range records through `model_citations` or `model_citations_path` wherever available. Do not collapse DCF outputs to a generic `model-output` citation when the workbook location is known. Render and visually inspect local HTML with local headless-browser screenshots, not the in-app Browser plugin, before delivery.

Do not expose raw JSON, Markdown report files, model-citation ledgers, or run logs as the default final artifact.

## Deliverable Format Standard

Follow `../../references/deliverable-format-policy.md` before creating files. Always identify the hero deliverable first: normally the XLSX valuation workbook; an explicitly requested standalone HTML valuation summary; native deck/document; generated folder; or justified chat-only answer. Do not create Markdown report files as the default rich deliverable. Do not present JSON contracts, manifests, run logs, model-citation ledgers, or handoff payloads as the main user-facing output. Keep CSV files as backing ledgers/import layers unless the user explicitly asks for CSV, and explain whether each CSV contains new analysis or only support data.

Final responses should point the user to the hero deliverable first and then briefly explain any supporting artifacts.

## Reference Map
- `../../references/workbook-first-tab-standard.md`: required first-read workbook decision view.
- `../../references/html-artifact-standard.md`: optional standalone HTML companion and visual QA standard.
- `plan-schema.md`, `output-spec.md`, `banker-formula-workbook-contract.md`: contracts.
- `model-math.md`, `dcf-architecture.md`, `cash-flow-methods.md`, `wacc-terminal-value.md`: methods.
- `valuation-judgment.md`, `sensitivity-and-scenarios.md`, `integrity-controls.md`, `industry-playbooks.md`, `output-and-review.md`, `qa-checks.md`: review.

## Runtime Artifact Path

Default deterministic outputs are `model.xlsx`, `manifest.json`, `run_log.json`, and `model_citations.json`; formula mode emits `banker_formula_workbook.xlsx` with the same shared manifest and citation ledger. The workbook is the primary human deliverable and must open on `Cover`, `Executive Summary`, or `Dashboard`. Run logs, plans, and `model_citations.json` are support artifacts; dashboards and memos should cite model outputs through the ledger rather than generic model citations. Senior-ready status requires source-backed assumptions, workbook/cell provenance, checks, and no unresolved citation gaps.
