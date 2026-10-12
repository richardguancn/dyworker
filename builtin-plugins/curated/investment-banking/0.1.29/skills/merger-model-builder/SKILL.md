---
name: merger-model-builder
description: Build merger and accretion/dilution models for consideration, pro forma ownership, synergies, purchase accounting, financing mix, or EPS impact. Use for strategic M&A modeling; not standalone DCF or LBO work.
---

# Merger Model Builder

## Skill Configuration

### Common Skill Instructions

MANDATORY: Before searching connectors, retrieving evidence, or drafting output, read and apply the shared runtime contract in `../investment-banking/SKILL.md## Cross-Skill Runtime Contract`. Then check the router skill map and `../../references/plugin-routing-playbook.md` for adjacent skills that should be sequenced with this workflow. Do not run user-context setup or inspection during ordinary workflow work; route only explicit saved-context, source-setup, onboarding, or automation-setup requests to `../user-context/SKILL.md`.

## Relevant Dependency Categories

These are the source categories most likely to matter for this workflow. Use the router contract to resolve only the categories the task actually needs, prefer user-named sources first, and state any material source limitation.

- `Market Data & Public Sources`
- `Models, Workbooks & Templates`
- `Deal Materials`

## Deliverable Intake

When this skill owns a new substantive user-facing artifact, before source gathering, analysis, modeling, or rendering load `../../references/deliverable-intake-policy.md` and perform its adaptive `request_user_input` preflight for materially unresolved preferences. For a merger model, accretion/dilution screen, or pro forma ownership model with an unresolved surface, offer `Excel merger / accretion workbook (Recommended)`, `Polished HTML transaction summary`, and `Inline screening view`. Default to the banker-readable workbook when intake is not required or a non-interactive model-build run must apply a default. When invoked as a downstream support step within an already scoped workflow, inherit resolved preferences and do not re-prompt.

## Plugin Workflow Routing

For broad transaction workflow prompts, read `../../references/plugin-routing-playbook.md` before selecting or sequencing skills. Use this skill as lead only in the workflows named there; when acting as support, preserve validated handoff fields, source IDs, routing metadata, and the artifact hierarchy so the hero deliverable remains the banker-facing workbook, an explicitly requested standalone HTML transaction summary, native deck/document, or clear first-read package.

Produce M&A model artifacts that answer whether the consideration structure, ownership transfer, synergies and accounting/financing effects support the deal rationale. For substantive merger-model work, the normal hero deliverable is a polished banker-readable workbook with an insight-led first visible tab. Use the full deterministic or formula engine when the input set supports its accounting scope; do not manufacture PPA or GAAP inputs merely to make a public-source adjusted-EPS screen fit a full-schema engine.

## Scope

Own sources/uses, consideration mix, PPA, financing, synergies, PF earnings, shares, ownership, EPS accretion/dilution, sensitivities, checks, and posture. Route sourcing, normalization, financing/covenant work, memo/deck polish, and independent workbook audit to the adjacent finance/IB skills.

## Rules

Use available prompt/files/connectors first; use placeholders only when the user wants a model despite gaps. Never overwrite user source files. Generated outputs go to a new or user-specified output directory.

Every material input needs a native evidence label from `references/plan-schema.md`. For partial context, the first user-facing output starts with:

> **SCREEN-GRADE: adjusted EPS analysis based on disclosed projections and modeled assumptions; GAAP accretion/dilution is not presented without complete PPA and post-close actualization support.**

Use this warning when ownership, disclosed projections, or synergy analysis can be completed but PPA, GAAP EPS, post-close share actualization, or refinancing effects cannot. List those items as readiness gates and keep the model `screen-grade`; do not describe disclosed source inputs as placeholders. Use explicit placeholder language only when an input included in the displayed metric is actually estimated or inserted to keep the model runnable.

## Workflow Modes

- `adjusted_eps_screen`: public-source merger model where transaction terms, ownership mechanics, disclosed projections, or synergy data support adjusted-EPS analysis but complete PPA, GAAP EPS, post-close denominator actualization, or financing economics do not. Use a workbook hero, omit unsupported GAAP conclusions, and do not exceed `screen-grade`.
- `gaap_accretion_model`: source-supported merger model with PPA, amortization, integration-cost treatment, financing effects and denominator support sufficient to show GAAP and adjusted EPS. Use a workbook hero and apply readiness gates before senior or committee characterization.
- `html_companion`: explicitly requested narrative executive view of workbook outputs. Keep the workbook as the calculation source of truth and create standalone HTML only as a companion or selected narrative surface.

For `adjusted_eps_screen`, classify each synergy measure by provenance: disclosed gross run-rate synergies; disclosed pretax net synergies when provided; disclosed costs to achieve when provided; or clearly labeled `implied cost-to-achieve` only when derived from disclosed gross and net synergy figures. Distinguish any model-derived after-tax benefit using a stated tax assumption. Do not call a disclosed pretax net synergy figure model-derived or an implied cost-to-achieve amount disclosed. Require sensitivity views for synergy realization and cost-to-achieve overrun or delayed capture, together with EPS breakeven against the selected pretax net synergy basis. In a fixed-ratio all-stock transaction, do not prioritize share-price sensitivity for ownership or EPS denominator mechanics unless the user asks for purchase-price or PPA-value analysis.

## Validated Handoffs

<!-- GENERATED: validated-handoffs START -->

Intake validation:

- From `cim-teardown`: require `cim_teardown_to_model_builder` and run `../../scripts/validate_handoff_payload.py cim_teardown_to_model_builder handoffs/cim_teardown_to_model_builder.json` before importing fields into this skill.

Use `../../references/handoff-contracts.md` for canonical field names and shared evidence semantics. Add `--strict` before any model, deck, committee, lender, board, or client-circulation use so placeholders, empty arrays, and empty objects fail instead of becoming assumptions.

Handoff payloads belong under `handoffs/` and must be listed in `manifest.json` as support or agent artifacts with `handoff_contract_name`, `schema_path`, `validator_status`, `validated_at`, and `consumer_skill`. They are never the hero deliverable unless the user explicitly asks for machine-readable output.

<!-- GENERATED: validated-handoffs END -->

## Script Map

Visible scripts are executable shims. Internals live in `scripts/runtime/` and should be opened only for debugging.

```bash
python3 scripts/validate_plan.py assets/plan_template.json
python3 scripts/run_pipeline.py assets/plan_template.json --output-dir output --print-report
python3 scripts/build_banker_formula_workbook.py assets/plan_template.json --output-dir output
```

`scripts/skill_core.py` imports the full-schema engine. `run_pipeline.py` writes `model.xlsx`, `plan.json`, `run_log.json`, `manifest.json`, and optional `report.md` only when explicitly requested. Formula mode materializes the bundled XLSX template and writes a separate formula log plus `manifest.json`. Treat `model.xlsx` as the hero human deliverable, opening on a banker-readable `Cover`, `Executive Summary`, or `Dashboard` tab per `../../references/workbook-first-tab-standard.md`; write legacy `report.md` only when explicitly requested. When a public-source `adjusted_eps_screen` intentionally omits PPA/GAAP fields that the bundled full-schema engine requires, build a formula-driven workbook limited to supported metrics rather than substituting placeholder purchase accounting. Treat logs, normalized plans, model-citation ledgers and manifests as support artifacts. Deep tests are archived outside the prompt-facing test wrappers; run them when changing internals.

## Artifact Hierarchy

Follow `../../references/artifact-manifest-standard.md` before returning generated files. For substantive merger-model work, the normal hero deliverable is a polished banker-readable workbook with an insight-led first visible tab. Create a standalone HTML transaction summary only when the user explicitly requests HTML or a narrative companion; the workbook remains the model source of truth. CSV, JSON, Markdown, run logs, manifests, model-citation ledgers, and handoff payloads are support artifacts unless the user explicitly asks for them. Final responses should lead with the hero deliverable, then companion deliverables, then support artifacts in one short sentence if useful.

## Workflow

Triage the deal and select the workflow mode before modeling. Build or ingest `plan.json` where the selected engine supports the requested metrics; otherwise build the bounded `adjusted_eps_screen` workbook without unsupported PPA/GAAP calculations. Review hard failures, warnings, source posture, EPS with/without synergies, ownership, synergy provenance, PPA/GAAP readiness, financing effects and downside breaks. Deliver paths plus a banker conclusion and one posture label: `decision-grade`, `senior-review-ready`, `screen-grade`, `not-decision-ready`, or `blocked`.

## Sub-agent decomposition

For complex medium/large requests, use sub-agents where available; otherwise emulate the split as named workstreams. Suggested lanes: standalone inputs, transaction assumptions, financing/purchase accounting, synergies, accretion/dilution, and QA. Keep this skill as the lead: reconcile conflicts, source labels, assumptions, open items, final QA, and the user-facing answer.

## Workbook Evidence Readiness

The workbook is the analytical source of truth. For senior, client, committee, board, lender, or external postures, every material input and derived output must be traceable through readable source/assumption notes and `model_citations` / `model_citations_path` records down to workbook sheet/cell or range where available.

Unknown source IDs, missing model citations for headline ownership or EPS outputs, unsupported synergy classification, unavailable PPA or GAAP inputs, unresolved denominator actualization, or unreported model substitutions are blocking readiness gaps. Fix them, cap posture at `screen-grade`, or surface them explicitly; do not call a workbook senior/client/committee/board/external-ready while they remain.

The first visible tab must separately label `Calculation integrity` and `Decision readiness`. An adjusted-EPS model can calculate correctly while remaining only a screen because GAAP/PPA, post-close shares, financing economics, synergy execution or tax support remains incomplete.

Before delivery, visually inspect the first visible tab, ownership, EPS bridge, synergies, sensitivities and checks/readiness views. Repair the workbook before returning it if it calls a model-derived net benefit `disclosed`, displays GAAP accretion/dilution without complete supporting inputs, or leaves the readiness distinction only on a later checks sheet.

## Optional HTML Companion

When the user explicitly requests an HTML report or visual transaction summary, keep this skill as the analytical owner and produce a polished standalone HTML companion following `../../references/html-artifact-standard.md`. Do not route an ordinary merger-model HTML summary through `dashboard-builder`, create a dashboard render contract, or force workbook-derived ownership and accretion findings into fixed dashboard modules.

In that HTML companion, cite workbook-derived ownership, synergy, PPA, financing and accretion/dilution outputs to exact workbook cell/range records through `model_citations` or `model_citations_path` wherever available. Render and visually inspect local HTML with local headless-browser screenshots, not the in-app Browser plugin, before delivery.

Do not expose raw JSON, Markdown report files, model-citation ledgers, or run logs as the default final artifact.

## Deliverable Format Standard

Follow `../../references/deliverable-format-policy.md` before creating files. Always identify the hero deliverable first: normally the XLSX merger/accretion workbook; an explicitly requested standalone HTML transaction summary; native deck/document; generated folder; or justified chat-only answer. Do not create Markdown report files as the default rich deliverable. Do not present JSON contracts, manifests, run logs, model-citation ledgers, or handoff payloads as the main user-facing output. Keep CSV files as backing ledgers/import layers unless the user explicitly asks for CSV, and explain whether each CSV contains new analysis or only support data.

Final responses should point the user to the hero deliverable first and then briefly explain any supporting artifacts.

## Reference Map

- `plan-schema.md`: required keys, labels, source posture.
- `output-spec.md`: files, sheets, report/log shape.
- `workflow-and-mode-selection.md`: adjusted-EPS screen versus GAAP-capable model routing.
- `model-math.md`: core formulas and breakeven.
- `qa-checks.md`: failures, warnings, senior red flags.
- `banker-formula-workbook-contract.md`: formula template limits.
- `investment-banking-integrations.md`: handoffs.
- `evals.md`: smoke prompts and expected behavior.

## Runtime Artifact Path

Default deterministic outputs are `model.xlsx`, `manifest.json`, `run_log.json`, and `model_citations.json`; formula mode emits `banker_formula_workbook.xlsx` with the same shared manifest and citation ledger. The workbook is the primary human deliverable. Support artifacts include plans, run logs, and citation ledgers. Senior-ready status requires transaction assumptions, pro forma ownership, accretion/dilution, clearly classified synergy evidence, financing, PPA/GAAP support when presented, checks, and cell/range provenance for material model outputs.
