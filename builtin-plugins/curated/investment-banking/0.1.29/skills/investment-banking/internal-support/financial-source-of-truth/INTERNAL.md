---
name: financial-source-of-truth
description: enforce evidence discipline for investment-banking outputs. use when facts, assumptions, citations, source conflicts, stale data, or diligence asks must be labeled. do not use to build models, memos, decks, or valuations.
---

# Financial Source of Truth

> Internal support playbook. Load through `internal-support/policy.md`; this evidence-control capability is bundled with the visible router rather than exposed as a skill entrypoint.

## Deliverable Intake

When this skill owns a new substantive user-facing artifact, before source gathering, analysis, modeling, or rendering load `../../../../references/deliverable-intake-policy.md` and perform its adaptive `request_user_input` preflight for materially unresolved preferences. When invoked as a downstream support step within an already scoped workflow, inherit resolved preferences and do not re-prompt.

## Artifact Hierarchy

Follow `../../../../references/artifact-manifest-standard.md` before returning generated files. The hero deliverable must be a workbook, HTML report/dashboard, native deck/document, generated folder first-read file, or justified chat-only answer. CSV, JSON, Markdown, run logs, manifests, and handoff payloads are support artifacts unless the user explicitly asks for them. Final responses should lead with the hero deliverable, then companion deliverables, then support artifacts in one short sentence if useful.

## Plugin Workflow Routing

For broad transaction workflow prompts, read `../../../../references/plugin-routing-playbook.md` before selecting or sequencing skills. Use this skill as lead only in the workflows named there; when acting as support, preserve validated handoff fields, source IDs, routing metadata, and the artifact hierarchy so the hero deliverable remains the banker-facing workbook, HTML report/dashboard, native deck/document, or clear first-read package.

## Trigger Boundary

Use this skill as the evidence-control layer for investment-banking and deal analysis when the task turns on source quality, citation support, stale data, conflicting sources, diligence asks, or fact/assumption labels.

Use it to:
- rank sources and decide what evidence controls a claim.
- label facts, assumptions, estimates, management statements, seller claims, stale items, and conflicts.
- produce source inventories, evidence ledgers, assumption registers, conflict registers, and diligence asks.
- QA another Investment Banking skill before its output is treated as decision-grade.

Do not use it to build models, memos, decks, valuations, credit packages, or deal theses. Route that work to the relevant builder, memo, underwriting, or deck skill, then return here for source discipline when needed.

## Fast Workflow

1. Define the decision context: work product, decision being supported, material claims, and minimum evidence needed.
2. Inventory sources with short IDs, owner, date, period, as-of date, access date, version status, and intended use.
3. Apply the right source hierarchy; prefer the source closest to the claim and explain any lower-tier override.
4. Check freshness and conflicts; stale or unresolved items become caveats, sensitivities, or diligence asks.
5. Label each material claim using the shared evidence taxonomy while preserving any skill-local label required by a schema, workbook, or validator.
6. Attach native citations where available; otherwise use source IDs and the ledger format.
7. Close with the evidence posture, open gaps, and any handoff needed for the next Investment Banking skill.

## Sub-agent decomposition

For complex medium/large requests, use sub-agents where available; otherwise emulate the split as named workstreams. Suggested lanes: source hierarchy, stale-data checks, assumption labels, source conflicts, and evidence register. Keep this skill as the lead: reconcile conflicts, source labels, assumptions, open items, final QA, and the user-facing answer.


## Artifact Contract

Default to `extended_analysis` when multiple claims, sources, assumptions, conflicts, or diligence asks matter. Use the shorter evidence-note format only when the user asks a narrow source-control question, explicitly requests a quick answer, or another richer artifact already carries the full ledger:
- **Extended evidence answer:** evidence posture block plus the source inventory, evidence ledger, assumption register, conflict register, and diligence asks that matter.
- **Narrow evidence note:** posture, controlling support, key caveat, and next source ask for one claim or metric.
- **Handoff artifact:** preserve `native_evidence_label`, add `canonical_evidence_category`, and include source ID, source type, as-of date, freshness status, conflict status, confidence, and treatment when available.

Evidence posture options are `decision-grade`, `diligence-grade`, `preliminary`, `assumption-led`, and `not supportable`. Read `../../../../references/output-depth-policy.md` before shortening; do not drop material caveats, conflicts, or next actions merely to save space.

## Source And Evidence Posture

Treat every material statement as one of:

`verified_fact`, `reported_fact`, `seller_claim`, `management_statement`, `pro_forma_adjustment`, `assumption`, `inference`, `estimate`, `stale`, `contradicted`, or `unknown`.

Never let an assumption, seller claim, management statement, stale source, inference, or unsupported model output masquerade as a verified fact.

Always cite or label hard numbers, dates, quotes, market data, guidance, consensus, covenants, valuation inputs, leverage metrics, EBITDA adjustments, debt terms, and diligence findings. User-provided material can be source support, but do not imply independent verification unless you actually verified it.

## Script Map

- `scripts/validate_evidence_ledger.py`: validates CSV or JSON evidence ledgers for missing labels, source IDs, freshness fields, as-of dates, and high-impact assumptions.

Run it when a task produces or receives a structured evidence ledger:

```bash
python scripts/validate_evidence_ledger.py path/to/evidence_ledger.csv
```

The script is a QA aid only; still apply judgment from this router and the references.

## Dashboard Citation Readiness

<!-- GENERATED: dashboard-citation-readiness START -->

For senior, client, committee, board, lender, or external postures, every material number, estimate, date-sensitive fact, sourced claim, assumption, and recommendation must have inline citation support at the point of use before rendering through `dashboard-builder`. Model-derived claims should cite `model_citations_path` records down to workbook/sheet/cell or range where available.

Unknown citation IDs, missing source registers, or uncited material numeric claims are blocking readiness gaps under `../../../../references/dashboard-citation-readiness-policy.md`. Fix them, downgrade the posture to draft/screen-grade, or surface the missing support as explicit source gaps; do not call the output senior/client/committee/board/external-ready while those gaps remain.

<!-- GENERATED: dashboard-citation-readiness END -->

## Dashboard Handoff

When the user asks for an HTML dashboard, HTML report, MD dashboard, cockpit, command center, visual diligence overview, or a more readable version of a memo/report, keep this skill as the analytical owner and add a `dashboard-builder` packaging step. Build an internal source-aware render contract and render through `dashboard-builder` using `dashboard`, `report_only`, or `hybrid` mode. The internal contract is not the user-facing deliverable. Use the generated HTML as the reader-facing report/dashboard and include blocked-output context plus supporting-artifact explanations inside the page.

Do not fork or maintain separate HTML/CSS/JS inside this skill. Do not expose raw JSON or Markdown report files as the default final artifact.

## Deliverable Format Standard

Follow `../../../../references/deliverable-format-policy.md` before creating files. Always identify the hero deliverable first: XLSX workbook, HTML report, HTML dashboard, native deck/document, generated folder, or justified chat-only answer. Do not create Markdown report files as the default rich deliverable. Do not present JSON contracts, manifests, run logs, or handoff payloads as the main user-facing output. Keep CSV files as backing ledgers/import layers unless the user explicitly asks for CSV, and explain whether each CSV contains new analysis or only support data.

Final responses should point the user to the hero deliverable first and then briefly explain any supporting artifacts.

## Reference Map

- `../../../../references/evidence-label-taxonomy.md`: read when mapping skill-local labels to canonical evidence categories or preparing cross-skill handoffs.
- `references/evidence-hierarchy.md`: read when ranking sources by work product, choosing the controlling source, or explaining a source override.
- `references/staleness-and-conflicts.md`: read when dates, as-of periods, source versions, or conflicting values affect the conclusion.
- `references/fact-assumption-labeling.md`: read when labeling claims, assumptions, inferences, estimates, or work-product-specific evidence states.
- `references/citation-and-ledger-format.md`: read when formatting citations, source inventories, evidence ledgers, assumption registers, posture blocks, compact evidence notes, or final QA.
- `references/investment-banking-integrations.md`: read when coordinating this evidence layer with other Investment Banking skills.
- `../../../../references/output-depth-policy.md`: read when deciding whether a narrow evidence note is enough; default to `extended_analysis`.
