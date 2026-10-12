---
name: three-statement-model-builder
description: Use when building integrated three-statement operating model exports with linked IS, BS, CF, drivers, checks, scenarios, or formula templates.
---

# Three Statement Model Builder

## Skill Configuration

### Common Skill Instructions

MANDATORY: Before searching connectors, retrieving evidence, or drafting output, read and apply the shared runtime contract in `../investment-banking/SKILL.md## Cross-Skill Runtime Contract`. Then check the router skill map and `../../references/plugin-routing-playbook.md` for adjacent skills that should be sequenced with this workflow. Do not run user-context setup or inspection during ordinary workflow work; route only explicit saved-context, source-setup, onboarding, or automation-setup requests to `../user-context/SKILL.md`.

## Relevant Dependency Categories

These are the source categories most likely to matter for this workflow. Use the router contract to resolve only the categories the task actually needs, prefer user-named sources first, and state any material source limitation.

- `Models, Workbooks & Templates`
- `Deal Materials`
- `Market Data & Public Sources`

## Deliverable Intake

When this skill owns a new substantive user-facing artifact, before source gathering, analysis, modeling, or rendering load `../../references/deliverable-intake-policy.md` and perform its adaptive `request_user_input` preflight for materially unresolved preferences. When invoked as a downstream support step within an already scoped workflow, inherit resolved preferences and do not re-prompt.
## Plugin Workflow Routing

For broad transaction workflow prompts, read `../../references/plugin-routing-playbook.md` before selecting or sequencing skills. Use this skill as lead only in the workflows named there; when acting as support, preserve validated handoff fields, source IDs, routing metadata, and the artifact hierarchy so the hero deliverable remains the banker-facing workbook, an explicitly requested standalone HTML companion, native deck/document, or clear first-read package.

Use for linked IS, BS, CF, working capital, PP&E/D&A, debt, cash sweep, liquidity, covenants, scenarios, sensitivities, and checks. Do not use for audit, LBO, DCF/comps/merger, memo, or deck work.

## Artifact Hierarchy

Follow `../../references/artifact-manifest-standard.md` before returning generated files. For substantive three-statement modeling work, the normal hero deliverable is a polished banker-readable workbook with an insight-led first visible tab. Create a standalone HTML operating-model summary only when the user explicitly requests HTML or a narrative companion; the workbook remains the model source of truth. CSV, JSON, Markdown, run logs, manifests, model-citation ledgers, and handoff payloads are support artifacts unless the user explicitly asks for them. Final responses should lead with the hero deliverable, then companion deliverables, then support artifacts in one short sentence if useful.

## Workflow
1. Classify: template, partial-context screen, full financial package, deterministic export, formula workbook, or handoff.
2. Read only needed references; usually `plan-schema.md`, `output-spec.md`, and integrations.
3. Create or locate `plan.json`; preserve raw files, formulas, assumptions, and labels.
4. Validate, run the requested export, read the run log, and build the first-read workbook view around operating drivers, cash conversion, liquidity, downside pressure, source posture, and open diligence.
5. Keep calculation integrity and decision readiness separate: balance-sheet, cash and formula checks may be `OK` while source readiness remains `OPEN` or `screen-grade`.
6. Render and visually inspect the workbook summary, driver/assumptions, scenario, statements, sources and checks tabs before reporting artifacts.
7. Hard failures mean `not-decision-ready`. Placeholder- or analyst-assumption-driven conclusions mean open with `Screen-grade only; operating, liquidity, or covenant assumptions require validation.`

## Sub-agent decomposition

For complex medium/large requests, use sub-agents where available; otherwise emulate the split as named workstreams. Suggested lanes: source support, historical normalization, operating drivers, balance sheet/cash flow, scenarios, and QA. Keep this skill as the lead: reconcile conflicts, source labels, assumptions, open items, final QA, and the user-facing answer.


## Artifacts
`deterministic_export`: write to the selected `--output-dir` (default `./output` from the caller's current working directory). The hero deliverable is `model.xlsx`, opening on a banker-readable `Cover`, `Executive Summary`, or `Dashboard` tab per `../../references/workbook-first-tab-standard.md`. Agent-facing support artifacts are `plan.json`, `run_log.json`, `model_citations.json`, and `manifest.json`. Write legacy `report.md` only when explicitly requested with `--write-report-md`.

`banker_formula_workbook`: formula workbook plus separate run log, `model_citations.json`, and manifest; not arbitrary formula generation. Any renamed, restyled, or otherwise substituted human-deliverable workbook must receive a citation ledger generated against that exact workbook; do not present a deterministic-control ledger as evidence for a different hero workbook.

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

The workbook is the analytical source of truth. For senior, client, committee, board, lender, or external postures, every material input and derived output must be traceable through readable source/assumption notes and `model_citations` / `model_citations_path` records down to the delivered workbook sheet/cell or range where available.

Unknown source IDs, missing hero-workbook cell provenance for headline revenue, EBITDA, FCF, liquidity or leverage outputs, unsupported financing or covenant inputs, unexplained working-capital or capex improvement, or citation records pointing to a different workbook than the delivered hero artifact are blocking readiness gaps. Fix them, cap posture at `screen-grade`, or surface them explicitly; do not call a workbook senior/client/committee/board/external-ready while they remain.

The first visible tab must clearly distinguish `Calculation integrity` from `Decision readiness`; do not leave that distinction only on a later checks sheet. A model may balance and pass formula checks while still being only an internal screen because operating assumptions, inventory/capex diligence, debt capacity, revolver availability, or covenant definitions are unresolved.

For public-source strategic alternatives work, make the operating driver bridge, cash conversion, leverage or liquidity trajectory, and linked downside pressure visible in the first-read view. If debt documents or covenant definitions are not provided, label any cash sweep, debt draw, headroom, or minimum-cash construct as illustrative and do not show an unqualified overall `OK`.

Before delivery, visually inspect the first visible tab, driver/control view, scenario view, statement schedules, sources/readiness view, and checks view. Search all visible status labels, including `Model status`, `Overall`, `QA posture`, `Calculation integrity`, and `Decision readiness`; no sheet may display an unqualified overall `OK` when decision readiness is `screen-grade`, `partial`, or `not-decision-ready`. Keep mechanical outcomes under `Calculation integrity` and make the reliance posture consistent with the first-read summary. Record formula-error scan outcomes as an explicit result or match count in the run log rather than referring only to transient console output.

## Optional HTML Companion

When the user explicitly requests an HTML report or visual operating-model summary, keep this skill as the analytical owner and produce a polished standalone HTML companion following `../../references/html-artifact-standard.md`. Do not route an ordinary three-statement-model HTML summary through `dashboard-builder`, create a dashboard render contract, or force workbook-derived operating and liquidity findings into fixed dashboard modules.

In that HTML companion, cite workbook-derived financial-statement, ratio, scenario, liquidity and forecast outputs to exact cells/ranges in the delivered workbook through `model_citations` or `model_citations_path` wherever available. Do not collapse model outputs to a generic `model-output` citation when the workbook location is known. Render and visually inspect local HTML with local headless-browser screenshots, not the in-app Browser plugin, before delivery.

Do not expose raw JSON, Markdown report files, model-citation ledgers, or run logs as the default final artifact.

## Deliverable Format Standard

Follow `../../references/deliverable-format-policy.md` before creating files. Always identify the hero deliverable first: XLSX workbook, HTML report, HTML dashboard, native deck/document, generated folder, or justified chat-only answer. Do not create Markdown report files as the default rich deliverable. Do not present JSON contracts, manifests, run logs, or handoff payloads as the main user-facing output. Keep CSV files as backing ledgers/import layers unless the user explicitly asks for CSV, and explain whether each CSV contains new analysis or only support data.

Final responses should point the user to the hero deliverable first and then briefly explain any supporting artifacts.

## Reference Map
- `../../references/workbook-first-tab-standard.md`: required first-read workbook decision view.
- `../../references/html-artifact-standard.md`: optional standalone HTML companion and visual QA standard.
- `plan-schema.md`, `output-spec.md`, `banker-formula-workbook-contract.md`: contracts.
- `model-math.md`, `model-architecture.md`, `forecast-judgment-guide.md`: mechanics.
- `integrity-controls.md`, `industry-playbooks.md`, `output-and-review.md`, `qa-checks.md`: review.

## Runtime Artifact Path

Default deterministic outputs are `model.xlsx`, `manifest.json`, `run_log.json`, and `model_citations.json`; formula mode emits `banker_formula_workbook.xlsx` with the same shared manifest and citation ledger. The workbook is the primary human deliverable and must open on `Cover`, `Executive Summary`, or `Dashboard`. Run logs, plans, and `model_citations.json` are support artifacts; any narrative companion must cite statement, ratio, scenario, forecast, liquidity and leverage outputs through records that point to the exact delivered workbook. Senior-ready status requires source-backed operating assumptions, workbook/cell provenance, checks, and no unresolved liquidity or covenant evidence gaps.
