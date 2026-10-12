# Investment Banking Integrations

DCF owns intrinsic valuation and DCF exports only.

Route source normalization, evidence refresh, and filing/current-market pulls to source-of-truth skills when available. Route existing-workbook QA to model audit. Route comps-only valuation to comps. Route LBO, merger, private credit, memo, and deck work to their dedicated skills.

CIM or management-case handoffs should use the shared `cim_teardown_to_model_builder` contract in `../../../references/handoff-contracts.md` when available. Map rows into DCF `historicals`, `forecast`, `wacc`, `terminal_value`, `ev_to_equity_bridge`, `scenarios`, and `sensitivities`.

Preserve `metric_definition`, `period`, `segment_or_scope`, `currency`, `unit`, `scale`, `source_pointer`, `native_evidence_label`, `canonical_evidence_category`, `freshness_status`, `conflict_status`, `recommended_model_treatment`, and `case_mapping`. Do not use seller claims marked `exclude`, `placeholder`, `blocker`, or `sensitivity only` as base-case inputs without an explicit override.

For downstream handoff, return `p0_handoff` plus native DCF evidence labels and canonical taxonomy labels where useful. Do not replace native labels inside `plan.json`.
