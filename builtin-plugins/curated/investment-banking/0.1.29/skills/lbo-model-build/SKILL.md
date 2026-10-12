---
name: lbo-model-build
description: Build sponsor LBO models for sources and uses, debt, sweep, liquidity, returns, and downside underwriting. Use for take-privates, acquisition financing, or leverage screens; not DCF-only work.
---

# LBO Model Build

## Skill Configuration

### Common Skill Instructions

MANDATORY: Before searching connectors, retrieving evidence, or drafting output, read and apply the shared runtime contract in `../investment-banking/SKILL.md## Cross-Skill Runtime Contract`. Then check the router skill map and `../../references/plugin-routing-playbook.md` for adjacent skills that should be sequenced with this workflow. Do not run user-context setup or inspection during ordinary workflow work; route only explicit saved-context, source-setup, onboarding, or automation-setup requests to `../user-context/SKILL.md`.

## Relevant Dependency Categories

These are the source categories most likely to matter for this workflow. Use the router contract to resolve only the categories the task actually needs, prefer user-named sources first, and state any material source limitation.

- `Deal Materials`
- `Models, Workbooks & Templates`
- `Market Data & Public Sources`
- `Relationship & Counterparty Context`

## Deliverable Intake

When this skill owns a new substantive user-facing artifact, before source gathering, analysis, modeling, or rendering load `../../references/deliverable-intake-policy.md` and perform its adaptive `request_user_input` preflight for materially unresolved preferences. For an initial sponsor LBO model, take-private screen, or acquisition-financing model with an unresolved surface, offer `Excel sponsor LBO workbook (Recommended)`, `Polished HTML underwriting summary`, and `Inline screening view`. Default to the banker-readable workbook when intake is not required or a non-interactive model-build run must apply a default. When invoked as a downstream support step within an already scoped workflow, inherit resolved preferences and do not re-prompt.
## Plugin Workflow Routing

For broad transaction workflow prompts, read `../../references/plugin-routing-playbook.md` before selecting or sequencing skills. Use this skill as lead only in the workflows named there; when acting as support, preserve validated handoff fields, source IDs, routing metadata, and the artifact hierarchy so the hero deliverable remains the banker-facing workbook, an explicitly requested standalone HTML underwriting summary, native deck/document, or clear first-read package.

Use for sponsor underwriting, acquisition financing, take-private screens, carve-outs, debt capacity, covenant headroom, liquidity survival, reverse stress, and XLSX exports. Do not use for DCF-only work, pure explainers, legal covenant interpretation, independent workbook audit, or final deck QC.

Rules: identify the decision lens; use available context before asking; keep EBITDA bases separate; do not present covenant EBITDA without the governing definition; label material inputs as `sourced_fact`, `management_assumption`, `seller_claim`, `sponsor_assumption`, `lender_case`, `analog_proxy`, `fallback_assumption`, or `unsupported`; default to `deterministic_export`. When final funded debt, commitment papers, or closing funds flow is unavailable, call the modeled financing an `illustrative financing case` or `public-source screening case`, cap posture at `screen-grade`, and make financing uncertainty visible in the first-read view.

## Artifact Hierarchy

Follow `../../references/artifact-manifest-standard.md` before returning generated files. For substantive LBO work, the normal hero deliverable is a polished banker-readable workbook with an insight-led first visible tab. Create a standalone HTML underwriting summary only when the user explicitly requests HTML or a narrative companion; the workbook remains the model source of truth. CSV, JSON, Markdown, run logs, manifests, model-citation ledgers, and handoff payloads are support artifacts unless the user explicitly asks for them. Final responses should lead with the hero deliverable, then companion deliverables, then support artifacts in one short sentence if useful.

## Workflow Modes

- `screening_model`: public-source take-private or acquisition-financing screen where final funded debt, closing funds flow, covenant definitions, or validated sponsor operating assumptions are unavailable. Use a workbook hero, label assumed financing prominently, and do not exceed `screen-grade`.
- `underwriting_model`: source-supported sponsor model with financing structure, operating case, cash sweep, returns, sensitivities, downside and controls. Use a workbook hero and apply readiness gates before any senior or committee characterization.
- `html_companion`: explicitly requested narrative executive view of workbook outputs. Keep the workbook as the calculation source of truth and create standalone HTML only as a companion or selected first-read narrative surface.

For public-source screening cases, do not limit sensitivities to operating realization and exit multiple when financing terms are assumed. A completed banker-readable workbook must include: an operating/exit-value returns sensitivity; a financing uncertainty view that varies opening debt or leverage and interest pricing and reports returns plus liquidity impact; and a revolver-capacity or incremental-equity-cure view when a stress case draws or exhausts assumed liquidity. A single integrated downside case may support, but may not replace, these financing sensitivity views.

## Sub-agent decomposition

For complex medium/large requests, use sub-agents where available; otherwise emulate the split as named workstreams. Suggested lanes: operating case, sources and uses, debt/sweep/covenants, returns, downside, and audit. Keep this skill as the lead: reconcile conflicts, source labels, assumptions, open items, final QA, and the user-facing answer.


Run from the skill directory:

```bash
python3 scripts/validate_plan.py output/plan.json
python3 scripts/run_pipeline.py output/plan.json --output-dir output --print-report
```

`scripts/*.py` are short executable maps. Runtime source lives in `scripts/runtime/`; full support assets live under `assets/deep/`; `assets/plan_template.json` is a compact runnable example.

Outputs go to the selected `--output-dir` (default `./output` from the caller's current working directory). Treat `model.xlsx` as the hero human deliverable, opening on a banker-readable `Cover`, `Executive Summary`, or `Dashboard` tab per `../../references/workbook-first-tab-standard.md`; treat `plan.json`, `run_log.json`, `model_citations.json`, and `manifest.json` as agent-facing support artifacts. `model_citations.json` maps material output ids to exact workbook cells/ranges for evidence and any narrative companion. Write legacy `report.md` only when explicitly requested with `--write-report-md`. Verify hard failures, S&U, debt roll-forward, revolver/min cash, covenants, exit equity, reverse stress, value bridge, stated hold-period return timing, and periodicity/annualization. If deterministic output fails a QA check and another workbook path is used, disclose that fallback in the first-read tab and the user-facing cover note rather than silently presenting a substituted output. End with `decision-grade`, `senior-review-ready`, `screen-grade`, `not-decision-ready`, or `blocked`.
## Validated Handoffs

<!-- GENERATED: validated-handoffs START -->

Intake validation:
- From `cim-teardown`: require `cim_teardown_to_model_builder` and run `../../scripts/validate_handoff_payload.py cim_teardown_to_model_builder handoffs/cim_teardown_to_model_builder.json` before importing fields into this skill.

Use `../../references/handoff-contracts.md` for canonical field names and shared evidence semantics. Add `--strict` before any model, deck, committee, lender, board, or client-circulation use so placeholders, empty arrays, and empty objects fail instead of becoming assumptions.

Handoff payloads belong under `handoffs/` and must be listed in `manifest.json` as support or agent artifacts with `handoff_contract_name`, `schema_path`, `validator_status`, `validated_at`, and `consumer_skill`. They are never the hero deliverable unless the user explicitly asks for machine-readable output.

<!-- GENERATED: validated-handoffs END -->
## Workbook Evidence Readiness

The workbook is the analytical source of truth. For senior, client, committee, board, lender, or external postures, every material input and derived output must be traceable through readable source/assumption notes and `model_citations` / `model_citations_path` records down to workbook sheet/cell or range where available.

Unknown source IDs, missing cell provenance for headline returns or leverage outputs, unsupported financing inputs, absent closing sources-and-uses support, unresolved covenant definitions, or unreported QA fallback paths are blocking readiness gaps. Fix them, cap posture at `screen-grade`, or surface them explicitly; do not call a workbook decision-grade or senior/committee-ready while they remain.

The first visible tab must clearly distinguish `Calculation integrity` from `Decision readiness`; do not leave that distinction only on a later checks sheet. A model may balance and pass formula checks while still being only a public-source screen because financing, covenant, cash-conversion, management-dilution, or closing-balance-sheet evidence is missing.

Before delivery, visually inspect the first visible tab, returns view, sensitivities view and checks/readiness view. Repair the workbook before returning it if the first tab lacks both readiness labels, the financing sensitivity views above are missing from a public-source screen, or a hold period renders as a multiple such as `5.0x` rather than as years.

## Optional HTML Companion

When the user explicitly requests an HTML report or visual underwriting summary, keep this skill as the analytical owner and produce a polished standalone HTML companion following `../../references/html-artifact-standard.md`. Do not route an ordinary LBO HTML summary through `dashboard-builder`, create a dashboard render contract, or force sponsor return findings into fixed dashboard modules.

In that HTML companion, cite workbook-derived outputs to exact workbook cell/range records through `model_citations` or `model_citations_path` wherever available. Render and visually inspect local HTML with local headless-browser screenshots, not the in-app Browser plugin, before delivery.

Do not expose raw JSON, Markdown report files, model-citation ledgers, or run logs as the default final artifact.

## Deliverable Format Standard

Follow `../../references/deliverable-format-policy.md` before creating files. Always identify the hero deliverable first: normally the XLSX sponsor LBO workbook; an explicitly requested standalone HTML underwriting summary; native deck/document; generated folder; or justified chat-only answer. Do not create Markdown report files as the default rich deliverable. Do not present JSON contracts, manifests, run logs, model-citation ledgers, or handoff payloads as the main user-facing output. Keep CSV files as backing ledgers/import layers unless the user explicitly asks for CSV, and explain whether each CSV contains new analysis or only support data.

Final responses should point the user to the hero deliverable first and then briefly explain any supporting artifacts.

## Runtime Artifact Path

Default deterministic outputs are `model.xlsx`, `manifest.json`, `run_log.json`, and `model_citations.json`. The workbook is the primary human deliverable; support artifacts include plan, run log, model citation ledger, and any optional legacy report requested explicitly. Sponsor/committee-ready status requires full sources and uses, source-supported financing terms, debt schedule, returns, covenants, operating case, sensitivities, checks, periodicity/annualization QA, and workbook/cell provenance for every material model number reused in a memo or deck.
