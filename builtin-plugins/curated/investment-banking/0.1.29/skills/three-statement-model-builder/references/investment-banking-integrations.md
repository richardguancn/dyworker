# Investment Banking Integrations

Three-statement builder owns integrated operating-model exports only.

Route source refresh and normalization to source-of-truth skills when available. Route existing-workbook QA to model audit. Route DCF, comps, LBO, merger, private credit, memo, and deck work to dedicated skills.

CIM/management-case handoffs should use the shared `cim_teardown_to_model_builder` contract in `../../../references/handoff-contracts.md` when available. Map rows into operating-model `historicals`, `revenue`, `costs`, `working_capital`, `ppe`, `debt`, `tax`, `equity`, and `scenarios`.

Preserve `metric_definition`, `period`, `segment_or_scope`, `currency`, `unit`, `scale`, `source_pointer`, `native_evidence_label`, `canonical_evidence_category`, `freshness_status`, `conflict_status`, `recommended_model_treatment`, and `case_mapping`. Keep seller/management assumptions separate from analyst overrides.

For downstream handoff, return model status, paths, sources, key drivers, liquidity/covenant items, and caveats. Preserve native evidence labels in the plan and add canonical labels only for cross-skill handoff.
