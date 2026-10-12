# Banker Runtime Readiness Standard

Investment Banking skills should not rely on instructions alone when a banker would expect a usable artifact. This standard classifies each skill's executable maturity and defines what must exist before a workflow can be called banker-operational, senior-ready, client-ready, committee-ready, board-ready, or external-ready.

## Runtime Maturity Levels

- `instruction_only`: the skill has guidance, templates, or prose standards but no deterministic runtime path.
- `support_script`: the skill has a helper script that produces support data, validation, or a scaffold only.
- `deterministic_human_artifact`: the skill can create a repeatable workbook, HTML report/dashboard, native document/deck, or generated package with a clear first-read artifact.
- `banker_operational`: the deterministic artifact includes controls, open items, source posture, next actions, and support artifacts hidden behind the manifest hierarchy.
- `senior_ready`: the artifact passes source/model/deck gates and can be reviewed by a VP/MD without obvious missing evidence, citation, model, or visual checks.
- `external_ready`: the artifact is suitable for client, lender, board, committee, or external circulation after required banker/legal/specialist review gates are cleared.

## Required Runtime Declaration

Every skill should be trackable with these fields:

- `skill`
- `runtime_maturity`
- `default_human_artifact`
- `deterministic_runtime_exists`
- `native_office_output_exists`
- `dashboard_builder_output_exists`
- `model_citations_supported`
- `source_gate_supported`
- `senior_ready_blockers`
- `runtime_script`
- `primary_test`
- `eval_prompt_ids`

## Senior-Ready Blocking Principles

Senior/client/committee/board/external-ready posture must be blocked or downgraded when:

- material numbers lack source IDs or workbook cell/range citations;
- model outputs cannot be traced to a workbook, sheet, and cell/range;
- the source register is missing or unresolved;
- deck/page visual review has not been performed where the artifact is a deck, board package, pitch, or PDF-derived output;
- PDF/OCR extraction confidence is weak or image-only content was not reviewed;
- legal, covenant, collateral, intercreditor, tax, or ratings matters are incomplete for credit/restructuring/capital-markets outputs;
- the runtime can only produce support artifacts or scaffolds.

## Artifact Hierarchy

Runtime maturity never changes the deliverable hierarchy:

1. Human hero artifact first: XLSX, HTML dashboard/report, native PPTX/DOCX, or generated package with first-read file.
2. Companion artifact second: issue log, dashboard companion, workbook, native deck/document, or source/readiness summary.
3. Support artifacts last: JSON, CSV, Markdown, logs, render contracts, handoffs, and debug files.

Final responses should lead with the hero deliverable, then companion deliverables, then mention support artifacts only briefly unless the user requests them.
