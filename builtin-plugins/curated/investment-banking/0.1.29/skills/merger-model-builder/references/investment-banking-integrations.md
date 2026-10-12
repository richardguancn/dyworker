# Integration Map

Use adjacent skills for sourcing, normalization, CIM teardown, comps/DCF,
financing, credit, covenants, LBO context, audit, memo, deck QC, and style.

Consume `cim-teardown` `model_input_handoff` before seller claims using the shared `cim_teardown_to_model_builder` contract in `../../../references/handoff-contracts.md`.

Map rows into target/acquirer standalone data, consideration, financing, purchase accounting, synergies, transaction fees, pro forma ownership, accretion/dilution, breakeven, and sensitivities. Preserve `source_pointer`, `native_evidence_label`, `canonical_evidence_category`, `synergy_type`, `synergy_status`, `purchase_accounting_area`, `timing_curve`, `probability_weight`, `recommended_model_treatment`, and `case_mapping`.

Pass `plan.json`, `model.xlsx`, `run_log.json`, status, failures/warnings, value, premium, mix, ownership, accretion, breakeven, financing, and caveats.
