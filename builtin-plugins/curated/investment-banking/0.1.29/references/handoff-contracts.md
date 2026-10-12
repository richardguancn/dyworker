# Investment Banking Handoff Contracts

Use this shared contract when one Investment Banking skill exports structured context for another. Producers and consumers must use the exact field names below. If a field is unavailable, preserve the field with `unknown`, `not_provided`, or an empty value, and list the gap in `open_items`; do not silently rename or drop it.

If a skill has native field names, keep them inside the native artifact and add an explicit mapping to the canonical field names here. Preserve native evidence labels and add `canonical_evidence_category`; do not overwrite local labels.

Machine-readable schemas for automation boundaries live in `../schemas/`. Use `../scripts/validate_handoff_payload.py <contract_name> <payload.json>` before treating any cross-skill handoff as an import. The validator checks exact field-name presence, nested support records, arrays, enum values, ID prefixes, and selected workflow-specific gates while intentionally allowing extra fields so local banker notes and deal-specific nuance can travel with the package.

## Table Of Contents

- [Common record components](#common-record-components)
- [Machine-readable schemas](#machine-readable-schemas)
- [`buyer_investor_list_to_deal_process_tracker`](#buyer_investor_list_to_deal_process_tracker)
- [`meeting_prep_to_deal_process_tracker`](#meeting_prep_to_deal_process_tracker)
- [`company_tearsheet_to_memo_builder`](#company_tearsheet_to_memo_builder)
- [`meeting_prep_to_memo_builder`](#meeting_prep_to_memo_builder)
- [`cim_teardown_to_memo_builder`](#cim_teardown_to_memo_builder)
- [`cim_builder_to_ib_deck_qc`](#cim_builder_to_ib_deck_qc)
- [`pitch_deck_builder_to_ib_deck_qc`](#pitch_deck_builder_to_ib_deck_qc)
- [`cim_teardown_to_model_builder`](#cim_teardown_to_model_builder)
- [`style_guide_adapter_style_profile`](#style_guide_adapter_style_profile)
- [`style_guide_adapter_change_log`](#style_guide_adapter_change_log)
- [`capital_markets_issuance_to_private_credit_underwriting`](#capital_markets_issuance_to_private_credit_underwriting)
- [`capital_markets_issuance_to_covenant_package_analyzer`](#capital_markets_issuance_to_covenant_package_analyzer)
- [`private_credit_underwriting_to_covenant_package_analyzer`](#private_credit_underwriting_to_covenant_package_analyzer)
- [`private_credit_underwriting_to_distressed_recovery_waterfall`](#private_credit_underwriting_to_distressed_recovery_waterfall)
- [`distressed_recovery_waterfall_to_memo_builder`](#distressed_recovery_waterfall_to_memo_builder)
- [`distressed_recovery_waterfall_to_pitch_deck_builder`](#distressed_recovery_waterfall_to_pitch_deck_builder)
- [`distressed_recovery_waterfall_to_ib_deck_qc`](#distressed_recovery_waterfall_to_ib_deck_qc)

## Common record components

Use these nested field names wherever a package includes the matching component.

`source_log`: `source_id`, `source_name`, `source_type`, `source_date`, `document_date`, `accessed_date`, `as_of_date`, `source_pointer`, `freshness_status`, `conflict_status`, `confidence`, `native_evidence_label`, `canonical_evidence_category`, `treatment`, `limitations`.

`evidence_register`: `source_id`, `source_type`, `as_of_date`, `native_evidence_label`, `canonical_evidence_category`, `freshness_status`, `conflict_status`, `confidence`, `treatment`, `open_items`.

`key_numbers_to_tie`: `metric`, `period`, `unit`, `scale`, `value`, `value_basis`, `page_references`, `slide_references`, `source_id`, `related_model_output`, `tie_out_status`, `variance_explanation`.

`claim_register`: `claim_id`, `buyer_facing_claim`, `claim_type`, `native_evidence_label`, `canonical_evidence_category`, `source_id`, `caveat`, `confidence`, `status`.

`chart_and_visual_register`: `location`, `chart_or_visual`, `metric_or_claim`, `source_id`, `unit`, `period`, `visual_review_status`, `tie_out_status`, `issue`, `suggested_remediation`.

`open_items`: `item_id`, `description`, `why_it_matters`, `owner`, `status`, `due_date`, `blocks_circulation`, `suggested_remediation`.

## Machine-readable schemas

Use these only when a handoff becomes an automation boundary or needs deterministic validation:

- `../schemas/cim_teardown_to_memo_builder.schema.json`
- `../schemas/cim_builder_to_ib_deck_qc.schema.json`
- `../schemas/pitch_deck_builder_to_ib_deck_qc.schema.json`
- `../schemas/cim_teardown_to_model_builder.schema.json`
- `../schemas/style_guide_adapter_style_profile.schema.json`
- `../schemas/style_guide_adapter_change_log.schema.json`
- `../schemas/capital_markets_issuance_to_private_credit_underwriting.schema.json`
- `../schemas/capital_markets_issuance_to_covenant_package_analyzer.schema.json`
- `../schemas/private_credit_underwriting_to_covenant_package_analyzer.schema.json`
- `../schemas/private_credit_underwriting_to_distressed_recovery_waterfall.schema.json`
- `../schemas/distressed_recovery_waterfall_to_memo_builder.schema.json`
- `../schemas/distressed_recovery_waterfall_to_pitch_deck_builder.schema.json`
- `../schemas/distressed_recovery_waterfall_to_ib_deck_qc.schema.json`
- `../schemas/buyer_investor_list_to_deal_process_tracker.schema.json`
- `../schemas/meeting_prep_to_deal_process_tracker.schema.json`
- `../schemas/company_tearsheet_to_memo_builder.schema.json`
- `../schemas/meeting_prep_to_memo_builder.schema.json`
- `../schemas/handoff_common.schema.json` for shared nested record definitions.

Validation command:

```bash
../scripts/validate_handoff_payload.py <contract_name> <payload.json>
```

Use `--strict` when a handoff is about to become a model, deck, committee, or client-circulation input. Strict mode treats placeholders such as `unknown`, `not_provided`, empty arrays, and empty objects as failures rather than warnings.

## `buyer_investor_list_to_deal_process_tracker`

Required record fields:

`process_context`, `party_id`, `party_name`, `parent_or_platform`, `party_type`, `sector_fit`, `geography`, `relevant_assets_or_holdings`, `tier`, `priority_score`, `recommended_wave`, `rationale`, `ability_to_transact`, `likely_objections`, `key_risks`, `relationship_owner`, `known_contacts`, `contact_path`, `confidentiality_flags`, `conflict_flags`, `do_not_contact_flag`, `recommended_next_action`, `next_action_owner`, `target_date`, `outreach_status`, `required_materials`, `source_ids`, `source_as_of_dates`, `confidence`, `open_questions`, `notes_for_process_tracker`.

Separate `holds_and_exclusions` fields:

`party_name`, `reason`, `approval_needed`, `reconsideration_trigger`.

## `meeting_prep_to_deal_process_tracker`

Required tracker-delta fields:

`meeting_id`, `meeting_date`, `counterparty`, `attendees`, `process_stage`, `decision_or_signal`, `status_change`, `materials_requested`, `diligence_requests`, `commitments`, `next_actions`, `owners`, `due_dates`, `dependencies`, `source_note`, `confidence`.

Optional field for non-status impressions:

`qualitative_signal`.

## `company_tearsheet_to_memo_builder`

Required memo-package fields:

`entity_profile`, `one_line_business_description`, `business_model`, `sector`, `ownership_status`, `key_metrics`, `recent_developments`, `source_as_of_dates`, `fact_vs_assumption_labels`, `risks_and_gaps`, `open_questions`, `recommended_next_step`, `circulation_caveats`.

## `meeting_prep_to_memo_builder`

Required memo-package fields:

`package_type`, `meeting_objective`, `meeting_type`, `audience`, `decision_needed`, `known_facts`, `assumptions`, `priority_questions`, `likely_pushbacks`, `answers_received`, `new_facts`, `changed_assumptions`, `diligence_implications`, `follow_ups`, `owners`, `due_dates`, `source_note`, `circulation_caveats`.

`package_type` must be one of `pre_meeting_plan`, `live_notes`, or `post_meeting_debrief`.

## `cim_teardown_to_memo_builder`

Required memo-package fields:

`transaction_context`, `asset_type`, `source_scope`, `source_as_of_dates`, `ic_60_second_view`, `top_claims`, `material_red_flags`, `underwriting_implications`, `diligence_questions`, `seller_data_requests`, `open_evidence_gaps`, `management_follow_ups`, `risk_mitigants`, `recommended_next_step`, `circulation_caveats`.

Claims, questions, and red flags must preserve `C-`, `Q-`, and `RF-` identifiers so downstream memos can cite the diligence trail.

## `cim_builder_to_ib_deck_qc`

Required QC package fields:

`artifact_type`, `artifact_version`, `circulation_posture`, `audience`, `transaction_context`, `last_updated`, `page_plan`, `source_log`, `key_numbers_to_tie`, `claim_register`, `chart_and_visual_register`, `financial_tie_outs`, `style_profile_package`, `style_change_log_package`, `confidentiality_and_disclosure_flags`, `open_items`.

Use this for CIMs, teasers, management presentations, lender presentations, and buyer-facing CIM sections. Missing `source_log`, `key_numbers_to_tie`, or `claim_register` is a material circulation issue.

## `pitch_deck_builder_to_ib_deck_qc`

Required QC package fields:

`artifact_type`, `artifact_version`, `circulation_posture`, `audience`, `deck_metadata`, `md_storyline`, `page_plan`, `source_log`, `key_numbers_to_tie`, `claim_register`, `chart_and_visual_register`, `slide_blueprint`, `appendix`, `style_profile_package`, `style_change_log_package`, `qa_status`, `open_items`.

The `page_plan` is the user-facing deck plan/storyboard. The `slide_blueprint` is a lower-level construction spec and must not replace unresolved storyline, sourcing, or senior-review issues.

## `cim_teardown_to_model_builder`

Required row fields:

`handoff_id`, `target_skill`, `transaction_context`, `deal_name`, `asset_type`, `as_of_date`, `source_scope`, `claim_id`, `evidence_id`, `red_flag_id`, `question_id`, `task_id`, `workstream`, `model_area`, `model_subarea`, `metric_or_driver`, `metric_definition`, `definition_status`, `period`, `segment_or_scope`, `currency`, `unit`, `scale`, `reported_value`, `adjusted_value`, `normalized_value`, `value_basis`, `calculation_method`, `source_id`, `supporting_source_ids`, `source_name`, `source_type`, `source_pointer`, `source_as_of_date`, `native_evidence_label`, `canonical_evidence_category`, `source_quality`, `freshness_status`, `conflict_status`, `confidence`, `evidence_gap`, `required_source_to_resolve`, `recommended_model_treatment`, `case_mapping`, `sensitivity_to_run`, `first_breach_or_failure_mode`, `diligence_owner`, `notes_for_model_builder`.

Optional extension fields:

`ebitda_basis`, `adjustment_type`, `recurrence_status`, `cash_non_cash`, `run_rate_status`, `working_capital_treatment`, `ev_to_equity_bridge_treatment`, `debt_like_item_flag`, `covenant_definition_status`, `synergy_type`, `synergy_status`, `purchase_accounting_area`, `timing_curve`, `probability_weight`, `model_blocker_flag`.

Model builders should consume this handoff before importing seller claims. Do not collapse reported EBITDA, adjusted EBITDA, normalized EBITDA, lender EBITDA, covenant EBITDA, and transaction EBITDA into one unqualified field.

## `style_guide_adapter_style_profile`

Required style profile package fields:

`style_profile_id`, `target_style_scope`, `artifact_type`, `style_source_records`, `source_basis_summary`, `style_provenance_labels`, `visual_system`, `layout_grammar`, `exhibit_conventions`, `writing_voice`, `citation_and_footnote_norms`, `artifact_specific_rules`, `do_not_change_rules`, `style_assumptions`, `style_conflicts`, `open_style_questions`, `style_confidence`, `style_freshness_status`, `visual_review_status`, `style_limitations`, `circulation_caveats`.

`style_source_records` fields:

`source_id`, `source_name`, `source_type`, `source_priority`, `source_scope`, `source_date_or_period`, `freshness`, `relevance`, `confidence`, `limitations`.

## `style_guide_adapter_change_log`

Required change log package fields:

`change_log_id`, `style_profile_id`, `source_artifact`, `output_artifact`, `artifact_type`, `artifact_version`, `mode`, `style_sources_used`, `changes_made`, `preserved_elements`, `substantive_edits`, `data_formula_source_integrity_status`, `visual_review_status`, `visual_review_notes`, `open_items`, `non_client_ready_reasons`, `downstream_qc_required`, `circulation_caveats`.

`changes_made` fields:

`location`, `area`, `change`, `basis`, `provenance_label`, `confidence`, `content_impact`.

Style provenance supports style choices only. It must not be used as factual evidence for business, financial, market, valuation, covenant, or recommendation claims.

## `capital_markets_issuance_to_private_credit_underwriting`

Required package fields:

`issuer_context`, `borrower_or_issuer_name`, `sponsor_or_owner`, `transaction_objective`, `use_of_proceeds`, `recommended_instrument`, `proposed_facility_or_security`, `target_raise_amount`, `minimum_viable_size`, `base_size`, `stretch_size`, `maximum_advisable_size`, `indicative_pricing_terms`, `fees_oid_call_protection`, `maturity_tenor`, `amortization_or_cash_pay_terms`, `collateral_guarantee_summary`, `pro_forma_capitalization`, `pro_forma_leverage`, `pro_forma_coverage`, `liquidity_impact`, `market_window_status`, `market_clearing_assumptions`, `investor_lender_targeting_summary`, `expected_lender_objections`, `execution_risks`, `fallback_alternatives`, `decision_requested`, `source_log`, `source_as_of_dates`, `evidence_register`, `covenant_or_rating_caveats`, `open_items`, `circulation_caveats`.

Capital markets views on market clearing are not lender approval. Private credit must re-underwrite borrower risk, downside, collateral, conditions, and recommendation.

## `capital_markets_issuance_to_covenant_package_analyzer`

Required package fields:

`issuer_context`, `transaction_objective`, `instrument_or_facility`, `proposed_size`, `use_of_proceeds`, `existing_capital_structure`, `pro_forma_capitalization`, `debt_incurrence_need`, `restricted_payment_or_leakage_need`, `liens_and_guarantees_needed`, `collateral_summary`, `ratings_objective`, `covenant_capacity_assumption`, `debt_document_universe`, `known_document_gaps`, `target_covenants_or_baskets`, `covenant_capacity_questions`, `restricted_payments_questions`, `investment_basket_questions`, `debt_lien_capacity_questions`, `ebitda_definition_questions`, `amendment_waiver_or_consent_questions`, `execution_timeline`, `source_log`, `source_as_of_dates`, `evidence_register`, `legal_counsel_review_flags`, `open_items`, `circulation_caveats`.

Do not present covenant capacity or headroom as factual unless operative definitions, latest financials, basket usage, amendments, and relevant documents are available or clearly caveated.

## `private_credit_underwriting_to_covenant_package_analyzer`

Required package fields:

`borrower_context`, `credit_recommendation`, `risk_rating`, `facility_structure`, `proposed_exposure`, `debt_sizing_case`, `selected_ebitda_basis`, `lender_after_haircut_ebitda`, `covenant_ebitda_proxy`, `covenant_questions`, `ratio_definitions_needed`, `financial_covenant_tests`, `thresholds_requested`, `headroom_or_proxy_headroom`, `first_breach_or_breakpoint`, `liquidity_trough`, `collateral_guarantee_concerns`, `basket_leakage_concerns`, `reporting_monitoring_needs`, `amendment_waiver_or_control_needs`, `recommended_lender_protections`, `conditions_precedent`, `source_log`, `source_as_of_dates`, `evidence_register`, `legal_counsel_review_flags`, `open_items`, `circulation_caveats`.

## `private_credit_underwriting_to_distressed_recovery_waterfall`

Required package fields:

`borrower_context`, `credit_status`, `watchlist_or_distressed_trigger`, `client_or_lender_perspective`, `facility_structure`, `debt_stack_summary`, `claim_amounts_by_tranche`, `maturity_wall`, `liquidity_trough`, `first_breakpoint`, `default_or_amendment_status`, `covenant_breach_details`, `lender_case`, `downside_case`, `severe_downside_case`, `collateral_value_summary`, `lien_priority_summary`, `guarantor_summary`, `borrowing_base_or_appraisal_basis`, `enterprise_value_cushion`, `expected_recovery_range`, `first_loss_driver`, `sponsor_support_evidence`, `new_money_or_rescue_need`, `restructuring_alternatives_to_test`, `source_log`, `source_as_of_dates`, `evidence_register`, `legal_counsel_review_flags`, `valuation_specialist_review_flags`, `open_items`, `circulation_caveats`.

## `distressed_recovery_waterfall_to_memo_builder`

Required package fields:

`mandate_context`, `client_or_stakeholder_perspective`, `jurisdiction_and_process_stage`, `source_scope`, `source_log`, `source_as_of_dates`, `evidence_register`, `capital_structure_summary`, `claim_register`, `legal_entity_guarantor_collateral_map`, `valuation_cases`, `distributable_value_bridge`, `recovery_waterfall_summary`, `recovery_ranges_by_class`, `value_break_class`, `fulcrum_security`, `fulcrum_sensitivity`, `stakeholder_leverage_map`, `restructuring_alternatives`, `recommended_path`, `diligence_gaps`, `counsel_review_flags`, `specialist_review_flags`, `key_numbers_to_tie`, `open_items`, `circulation_caveats`.

## `distressed_recovery_waterfall_to_pitch_deck_builder`

Required package fields:

`mandate_context`, `client_or_stakeholder_perspective`, `jurisdiction_and_process_stage`, `source_scope`, `source_log`, `source_as_of_dates`, `evidence_register`, `capital_structure_summary`, `claim_register`, `legal_entity_guarantor_collateral_map`, `valuation_cases`, `distributable_value_bridge`, `recovery_waterfall_summary`, `recovery_ranges_by_class`, `value_break_class`, `fulcrum_security`, `fulcrum_sensitivity`, `stakeholder_leverage_map`, `restructuring_alternatives`, `recommended_path`, `diligence_gaps`, `counsel_review_flags`, `specialist_review_flags`, `key_numbers_to_tie`, `page_plan_guidance`, `open_items`, `circulation_caveats`.

## `distressed_recovery_waterfall_to_ib_deck_qc`

Required package fields:

`artifact_type`, `artifact_version`, `circulation_posture`, `review_scope`, `mandate_context`, `client_or_stakeholder_perspective`, `jurisdiction_and_process_stage`, `source_scope`, `source_log`, `source_as_of_dates`, `evidence_register`, `capital_structure_summary`, `claim_register`, `legal_entity_guarantor_collateral_map`, `valuation_cases`, `distributable_value_bridge`, `recovery_waterfall_summary`, `recovery_ranges_by_class`, `value_break_class`, `fulcrum_security`, `fulcrum_sensitivity`, `stakeholder_leverage_map`, `restructuring_alternatives`, `recommended_path`, `diligence_gaps`, `counsel_review_flags`, `specialist_review_flags`, `key_numbers_to_tie`, `financial_tie_outs`, `waterfall_tie_outs`, `valuation_case_tie_outs`, `scenario_outputs`, `assumption_register`, `model_status`, `qa_checks`, `confidentiality_and_disclosure_flags`, `open_items`, `circulation_caveats`.

Distressed outputs must not collapse strict legal-entitlement economics, negotiated plan economics, collateral/liquidation waterfalls, and enterprise-value waterfalls into one number. Counsel-review items remain counsel-review items.
