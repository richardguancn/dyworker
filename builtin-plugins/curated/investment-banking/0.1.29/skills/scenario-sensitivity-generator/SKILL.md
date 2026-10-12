---
name: scenario-sensitivity-generator
description: create scenario, sensitivity, stress-test, and breakeven frameworks for ib analyses. use when the user asks to pressure-test model drivers, cases, downside paths, or decision thresholds. do not build base models.
---

# Scenario & Sensitivity Generator

## Skill Configuration

### Common Skill Instructions

MANDATORY: Before searching connectors, retrieving evidence, or drafting output, read and apply the shared runtime contract in `../investment-banking/SKILL.md## Cross-Skill Runtime Contract`. Then check the router skill map and `../../references/plugin-routing-playbook.md` for adjacent skills that should be sequenced with this workflow. Do not run user-context setup or inspection during ordinary workflow work; route only explicit saved-context, source-setup, onboarding, or automation-setup requests to `../user-context/SKILL.md`.

## Relevant Dependency Categories

These are the source categories most likely to matter for this workflow. Use the router contract to resolve only the categories the task actually needs, prefer user-named sources first, and state any material source limitation.

- `Models, Workbooks & Templates`
- `Market Data & Public Sources`
- `Deal Materials`
- `Process Updates`

## Deliverable Intake

When this skill owns a new substantive user-facing artifact, before source gathering, analysis, modeling, or rendering load `../../references/deliverable-intake-policy.md` and perform its adaptive `request_user_input` preflight for materially unresolved preferences. For a scenario or sensitivity analysis with an unresolved surface, offer `Excel sensitivity workbook (Recommended)`, `Polished HTML sensitivity summary`, and `Inline screening view`. Default to the banker-readable workbook when intake is not required or a non-interactive analysis run must apply a default. When invoked as a downstream support step within an already scoped workflow, inherit resolved preferences and do not re-prompt.

## Artifact Hierarchy

Follow `../../references/artifact-manifest-standard.md` before returning generated files. For substantive sensitivity work, the normal hero deliverable is a polished banker-readable workbook with an insight-led first visible tab. Create a standalone HTML sensitivity summary only when the user explicitly requests HTML or a narrative companion; keep the workbook as the calculation source of truth when one exists. CSV, JSON, Markdown, run logs, manifests, and handoff payloads are support artifacts unless the user explicitly asks for them. Final responses should lead with the hero deliverable, then companion deliverables, then support artifacts in one short sentence if useful.

## Plugin Workflow Routing

For broad transaction workflow prompts, read `../../references/plugin-routing-playbook.md` before selecting or sequencing skills. Use this skill as lead only in the workflows named there; when acting as support, preserve validated handoff fields, source IDs, routing metadata, and the artifact hierarchy so the hero deliverable remains the banker-facing workbook, an explicitly requested standalone HTML sensitivity summary, native deck/document, or clear first-read package.

## Purpose

Turn an existing IB transaction model or analysis into a banker-ready sensitivity pack. Preserve the base model, change only explicit drivers, quantify what moved, identify what breaks first, and translate the output into deal actions.

This is not an FP&A scenario-planning skill. It is for transaction sensitivities: valuation, debt capacity, covenant headroom, financing terms, merger-model outputs, downside/breakage, sponsor returns, restructuring recoveries, and target backsolves.

## Use This Skill When

- The user has an existing DCF, comps, LBO, merger model, financing case, covenant model, credit case, or recovery waterfall and wants to stress outputs.
- The decision depends on price, valuation range, leverage, covenant cushion, liquidity, financing cost, dilution, accretion/dilution, IRR/MOIC, or recovery value.
- The user asks for base/upside/downside cases, a sensitivity table, a target backsolve, a break-even, a breakpoint, or a “what breaks first?” analysis.

Do not use this skill to build the underlying model. Route model construction to `dcf-model-builder`, `comps-valuation`, `lbo-model-build`, `merger-model-builder`, `three-statement-model-builder`, `covenant-package-analyzer`, `private-credit-underwriting`, `capital-markets-issuance`, or `distressed-recovery-waterfall` as appropriate.

## Fast Workflow

1. **Route the request.** Pick the transaction mode using `references/transaction-mode-router.md`: valuation, debt capacity, covenant headroom, financing terms, merger model, downside, returns, restructuring, or target backsolve.
2. **Classify the sensitivity basis.** Identify the baseline as `supplied model`, `corrected scenario-ready base`, `audit-indicative diagnostic overlay`, or `not suitable for sensitivity reliance`. Record embedded corrections or adjustments and unresolved items excluded from the analysis. If known material errors would contaminate the displayed base without an expressly labeled diagnostic or corrected overlay, stop and route to the relevant model or audit skill.
3. **Check model readiness and define the artifact.** Confirm the base has clear source dates, editable drivers, stable formulas, visible checks, and traceable output metrics. For substantive analysis, use a workbook sensitivity pack organized around the decision question: valuation range, debt/covenant stress, financing terms, merger-model sensitivity, LBO returns, downside/breakage, restructuring recovery, or target backsolve.
4. **Create the overlay.** List each changed driver by case using `references/scenario-overlay-contract.md`. Separate source facts, model-derived values, banker assumptions, market proxies, and placeholders.
5. **Materialize tables.** Use `scripts/materialize_sensitivity_pack.py` for deterministic starter tables across valuation, debt capacity, covenant headroom, financing terms, merger model, downside, and returns. See `references/deterministic-materializer.md`.
6. **Interpret results.** Explain what moved, why it moved, the key breakpoint, and the action the deal team should take.
7. **Verify and hand off cleanly.** Check that base sensitivity cells reconcile to the selected basis, render and visually inspect the workbook's first-read and material analysis tabs, and state the calculation-integrity and decision-readiness posture separately. Route an independent model audit to `model-audit-tieout` when requested or when material source/model reliability must be independently tested; route client decks or memos to `pitch-deck-builder`, `memo-builder`, and final `ib-deck-qc`.

## Sub-agent decomposition

For complex medium/large requests, use sub-agents where available; otherwise emulate the split as named workstreams. Suggested lanes: base-model handoff, scenario design, sensitivity math, output grids, and QA. Keep this skill as the lead: reconcile conflicts, source labels, assumptions, open items, final QA, and the user-facing answer.


## Artifact Contract

Produce these sections unless the user asks for a different format:

Default reader-facing artifact: a polished banker-readable workbook with an insight-led first visible tab following `../../references/workbook-first-tab-standard.md`. Use chat only for narrow breakpoints, quick follow-ups, or a cover note for a richer artifact. Use a standalone HTML companion only when explicitly requested.

- **Executive summary:** headline conclusion, most sensitive drivers, first breakage point, recommended deal action.
- **Sensitivity basis and readiness:** classify the baseline as `supplied model`, `corrected scenario-ready base`, `audit-indicative diagnostic overlay`, or `not suitable for sensitivity reliance`; state embedded corrections, excluded unresolved issues, source/as-of dates, earnings basis, calculation integrity, and decision readiness.
- **Case summary:** base/upside/downside/stress outputs for the relevant transaction metrics.
- **Assumption overlay:** exact driver changes, timing, provenance, controllability, owner, and caveat.
- **Sensitivity tables:** compact one-way, two-way, or tornado-style outputs that directly answer the transaction question.
- **Breakpoints and triggers:** thresholds for price, leverage, covenant cushion, liquidity, rates/spreads, dilution, accretion/dilution, IRR/MOIC, or recoveries.
- **Driver-to-action table:** driver, impact, controllability, deal action, owner, timing, expected protection or upside.
- **Target backsolve:** target metric, locked constraints, allowed levers, required path, feasibility label, and what must be true.
- **Transaction implications memo:** what the client, sponsor, lender, committee, or deal team should do next.

## Deterministic Resources

Use these local assets when the user needs structured outputs or when another skill/model should consume the scenario work:

- `scripts/materialize_sensitivity_pack.py`: creates a deterministic workbook-first sensitivity scaffold with backing CSV/JSON support files.
- `assets/sensitivity_pack_modes.json`: canonical mode definitions for `valuation`, `debt_capacity`, `covenant_headroom`, `financing_terms`, `merger_model`, `downside`, and `returns`.
- `assets/scenario_overlay_template.csv`: overlay schema for driver changes.
- `assets/sensitivity_matrix_template.csv`: generic sensitivity table schema.
- `assets/target_backsolve_template.csv`: target-backsolve schema.
- `assets/trigger_metrics_template.csv`: trigger and contingency schema.
- `assets/deal_action_register_template.csv`: action register schema.

Recommended command:

```bash
python3 scripts/materialize_sensitivity_pack.py \
  --mode all \
  --entity ExampleCo \
  --transaction-version "Base model v1" \
  --output-dir /tmp/exampleco_sensitivity_pack
```

## Quality Rules

- Keep scenarios decision-useful: change a few meaningful drivers, not dozens of cosmetic assumptions.
- Show absolute outputs, not only deltas.
- Label EBITDA, earnings, covenant EBITDA, cash, debt, share count, FX, and market-data bases clearly.
- Do not mix as-of dates without flagging the mismatch.
- Do not present covenant headroom without covenant definitions or a clearly labeled proxy.
- Do not call illustrative outputs decision-grade.
- Do not hide formula changes inside scenario cases.
- Do not describe a corrected scenario-ready base or audit-indicative overlay as the unmodified source model.
- Show embedded base corrections and material excluded items prominently on the first-read tab and in the final response.
- Always name the first breakpoint and the action it triggers when downside, financing, covenant, merger, returns, or restructuring risk matters.

## Workbook Evidence Readiness

The workbook is the analytical source of truth for substantive sensitivity work. For internal transaction review, client, committee, board, lender, or external postures, every material input, modeled output, breakpoint, scenario adjustment, backsolve, and action recommendation must be traceable to a workbook cell/range, source document location, or explicit assumption label. Use readable source IDs and as-of dates in the source/assumption ledger; use `model_citations` or an equivalent cell/range citation ledger when workbook-derived outputs feed another artifact.

Keep `Calculation integrity` distinct from `Decision readiness`. A sensitivity grid can calculate correctly while the analysis remains only an internal screen because the base model, financing terms, synergy support, covenant definitions, forecast support, share count, purchase accounting, or integration-cost treatment is incomplete.

For a merger or accretion/dilution sensitivity pack, require a formula-driven tie-out of the base sensitivity cell to the selected EPS bridge, breakeven synergy and financing-cost backsolves when relevant, and prominent disclosure of whether the financing and synergy inputs are sourced, assumed, or corrected for scenario use. Do not leave the sensitivity-basis classification only on a later detail or checks tab.

Before delivery, render and visually inspect the first visible tab and each material sensitivity, scenario-overlay, trigger/action, checks, and source/assumption view. State explicitly when formulas and cached outputs were inspected without native Excel recalculation.

## Optional HTML Companion

When the user explicitly requests HTML, keep this skill as the analytical owner and produce a polished standalone sensitivity summary following `../../references/html-artifact-standard.md`, grounded in workbook cell/range provenance and source/assumption tie-outs. Keep the workbook as the hero deliverable for model-heavy sensitivity work unless the user explicitly selects a narrative-only surface. Do not route an ordinary sensitivity pack or HTML sensitivity summary through `dashboard-builder`, create a dashboard render contract, or force the analysis into fixed dashboard modules.

In an HTML companion, cite workbook-derived scenario outputs, target-backsolve cells, sensitivities, or bridge values to exact cell/range records wherever available. Render and visually inspect local HTML with local headless-browser screenshots, not the in-app Browser plugin, before delivery. Do not expose raw JSON, Markdown report files, model-citation ledgers, or run logs as the default final artifact.

## Deliverable Format Standard

Follow `../../references/deliverable-format-policy.md` before creating files. Always identify the hero deliverable first: ordinarily the XLSX sensitivity workbook; an explicitly requested standalone HTML sensitivity summary; native deck/document; generated folder; or justified chat-only answer. Do not create Markdown report files as the default rich deliverable. Do not present JSON contracts, manifests, run logs, or handoff payloads as the main user-facing output. Keep CSV files as backing ledgers/import layers unless the user explicitly asks for CSV, and explain whether each CSV contains new analysis or only support data.

Final responses should point the user to the hero deliverable first and then briefly explain any supporting artifacts.

## Reference Map

- `references/sensitivity-taxonomy.md`: detailed IB driver taxonomy, standard tables, breakpoints, and failure modes.
- `references/transaction-mode-router.md`: mode selection and routing rules.
- `references/deterministic-materializer.md`: how to use and extend the deterministic materializer.
- `references/scenario-overlay-contract.md`: overlay schema for workbook and skill handoffs.
- `references/target-backsolve-rubric.md`: feasibility labels and execution-realism checks.
- `references/output-templates.md`: trigger metrics, action register, QA checklist, and handoff outputs.
- `references/ib-integration.md`: ownership matrix and adjacent-skill boundaries.
- `../../references/workbook-first-tab-standard.md`: required for substantive workbook sensitivity packs.
- `../../references/html-artifact-standard.md`: read only when a standalone HTML sensitivity companion is explicitly requested or selected.
