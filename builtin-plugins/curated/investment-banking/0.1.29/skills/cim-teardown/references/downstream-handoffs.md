# Downstream Handoffs (Memo + Model Builders)

## Table of contents
1. Purpose
2. Handoff to `memo-builder`
3. Handoff to model builders
4. Control rules

---

## 1) Purpose
Use this reference when a CIM teardown feeds another skill or artifact. Export synthesis and control fields, not raw CIM claims without evidence labels.

## 2) Handoff to `memo-builder`
Export memo-ready diligence synthesis using the canonical `cim_teardown_to_memo_builder` contract in `../../../references/handoff-contracts.md`.

Required fields:
- `transaction_context`
- `asset_type`
- `source_scope`
- `source_as_of_dates`
- `ic_60_second_view`
- `top_claims`
- `material_red_flags`
- `underwriting_implications`
- `diligence_questions`
- `seller_data_requests`
- `open_evidence_gaps`
- `management_follow_ups`
- `risk_mitigants`
- `recommended_next_step`
- `circulation_caveats`

Each claim or red flag must keep its `C-`, `Q-`, and `RF-` identifiers so the memo can cite the diligence trail.

Separate:
- source-backed facts
- seller claims
- management assertions
- banker judgment

Do not let `memo-builder` promote a seller claim into a recommendation without the evidence label.

## 3) Handoff to model builders
When the teardown feeds `three-statement-model-builder`, `dcf-model-builder`, `comps-valuation`, `lbo-model-build`, or `merger-model-builder`, export a `model_input_handoff` table using the canonical `cim_teardown_to_model_builder` contract in `../../../references/handoff-contracts.md`.

Required fields:
- `handoff_id`, `target_skill`, `transaction_context`, `deal_name`, `asset_type`, `as_of_date`, `source_scope`
- `claim_id`, `evidence_id`, `red_flag_id`, `question_id`, `task_id`, `workstream`, `model_area`, `model_subarea`
- `metric_or_driver`, `metric_definition`, `definition_status`, `period`, `segment_or_scope`, `currency`, `unit`, `scale`
- `reported_value`, `adjusted_value`, `normalized_value`, `value_basis`, `calculation_method`
- `source_id`, `supporting_source_ids`, `source_name`, `source_type`, `source_pointer`, `source_as_of_date`
- `native_evidence_label`, `canonical_evidence_category`, `source_quality`, `freshness_status`, `conflict_status`, `confidence`
- `evidence_gap`, `required_source_to_resolve`, `recommended_model_treatment`, `case_mapping`, `sensitivity_to_run`, `first_breach_or_failure_mode`, `diligence_owner`, `notes_for_model_builder`

Optional extension fields include `ebitda_basis`, `adjustment_type`, `recurrence_status`, `cash_non_cash`, `run_rate_status`, `working_capital_treatment`, `ev_to_equity_bridge_treatment`, `debt_like_item_flag`, `covenant_definition_status`, `synergy_type`, `synergy_status`, `purchase_accounting_area`, `timing_curve`, `probability_weight`, and `model_blocker_flag`.

Allowed `model_area` values:
- revenue
- margin
- EBITDA
- add-backs
- working capital
- capex
- taxes
- debt
- covenants
- valuation
- synergies
- purchase accounting
- exit
- returns

Allowed `recommended_model_treatment` values:
- use
- exclude
- haircut
- sensitivity only
- downside case only
- placeholder
- blocker

Allowed `case_mapping` values:
- base
- management
- lender
- downside
- upside
- break case

## 4) Control rules
- Model builders should consume this table as an evidence and assumption control sheet.
- Model builders should not ingest CIM claims directly when a teardown handoff exists.
- Keep IDs stable across chat memo, exports, and downstream handoffs.
- Preserve `CIM ...`, `WEB ...`, or `CITATION_TBD` pointers in the handoff whenever a source-backed field is used.
- Keep EBITDA bases, working capital treatments, debt-like items, synergy claims, purchase accounting items, and covenant definitions distinct instead of merging them into generic values.
