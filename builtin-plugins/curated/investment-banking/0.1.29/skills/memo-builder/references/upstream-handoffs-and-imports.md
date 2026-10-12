# Upstream Handoffs And Imports

Use this reference when the memo depends on outputs from other Investment Banking skills, models, trackers, diligence workstreams, or source-of-truth records.

## Table Of Contents

- [Core Import Rule](#core-import-rule)
- [Source Packet Inputs](#source-packet-inputs)
- [Upstream Skill Map](#upstream-skill-map)
- [Company Tearsheet Import](#company-tearsheet-import)
- [CIM Teardown Import](#cim-teardown-import)
- [Meeting Prep Import](#meeting-prep-import)
- [Distressed Recovery Import](#distressed-recovery-import)
- [Style Guide Adapter Import](#style-guide-adapter-import)
- [Missing Payload Fields](#missing-payload-fields)

## Core Import Rule

Pull only the pieces that affect the memo's decision, recommendation, process status, diligence position, financing view, or next step. Preserve source dates, scenario labels, model status, warning flags, and upstream caveats.

Do not turn an upstream handoff into a recommendation if the upstream skill did not make one. Use upstream outputs as evidence, not as authority.

When an upstream package becomes an automation boundary, validate exact field names with `../../../scripts/validate_handoff_payload.py <contract_name> <payload.json>`. Keep extra upstream fields when they contain deal-specific judgment, caveats, or source context; do not rename canonical fields.

## Source Packet Inputs

Build the source packet from user-provided files, prior outputs, connected apps, models, decks, trackers, notes, and source-of-truth records before asking for more. For each source, capture date, author/source system where available, status, and whether it is reported fact, management claim, seller claim, model output, banker judgment, or assumption.

## Upstream Skill Map

Use this map to decide what to pull from installed IB and Financial Markets skills:

- `company-tearsheet`: company, borrower, issuer, buyer, or counterparty profile.
- `cim-builder`: sell-side narrative, CIM section plan, source log, management story, and draft materials.
- `cim-teardown`: claims ledger, diligence questions, red flags, evidence gaps, and underwriting implications.
- `meeting-prep`: meeting objectives, question list, follow-ups, objections, and live-call implications.
- `buyer-investor-list`: buyer/lender/investor rationale, prioritization, outreach logic, and counterparty notes.
- `deal-process-tracker`: process stage, outreach funnel, NDA/IOI/LOI status, diligence status, deadlines, and owners.
- `comps-valuation`: peer rationale, valuation range, EV bridge, multiples, and caveats.
- `dcf-model-builder`: intrinsic valuation, WACC/terminal assumptions, sensitivity outputs, and status.
- `lbo-model-build`: sources/uses, debt schedule, sponsor returns, covenant/liquidity, downside, and value creation bridge.
- `merger-model-builder`: pro forma EPS, ownership, purchase accounting, synergies, financing, and accretion/dilution.
- `three-statement-model-builder`: operating forecast, cash flow, balance sheet, liquidity, and checks.
- `model-audit-tieout`: formula issues, source tie-outs, hardcodes, checks, and readiness findings that must be reflected in the memo.
- `scenario-sensitivity-generator`: valuation, financing, covenant, downside, returns, and breakeven sensitivities.
- `private-credit-underwriting`: borrower view, repayment capacity, downside, risk rating, and lender recommendation.
- `covenant-package-analyzer`: covenant definitions, basket capacity, leakage, headroom, and negotiation flags.
- `capital-markets-issuance`: market window, issuance options, investor targeting, comparable deals, and execution risk.
- `distressed-recovery-waterfall`: claims, recoveries, fulcrum security, value break, alternatives, and stakeholder leverage.
- `style-guide-adapter`: style profile and restyle change log after source/content QA is stable.

## Company Tearsheet Import

Consume the canonical `company_tearsheet_to_memo_builder` contract in `../../../references/handoff-contracts.md`. Expect:

- `entity_profile`
- `one_line_business_description`
- `business_model`
- `sector`
- `ownership_status`
- `key_metrics`
- `recent_developments`
- `source_as_of_dates`
- `fact_vs_assumption_labels`
- `risks_and_gaps`
- `open_questions`
- `recommended_next_step`
- `circulation_caveats`

Use this as the company snapshot and source-backed fact base, not as an investment recommendation.

When the upstream artifact is native `company-tearsheet` JSON rather than the memo package, first map it with `../../company-tearsheet/scripts/map_tearsheet_to_memo_handoff.py <input_json> <output_json>` from this reference file's directory context, or `skills/company-tearsheet/scripts/map_tearsheet_to_memo_handoff.py <input_json> <output_json>` from the plugin root. Then validate the mapped payload with `../../../scripts/validate_handoff_payload.py company_tearsheet_to_memo_builder <payload.json>`.

## CIM Teardown Import

Consume the canonical `cim_teardown_to_memo_builder` contract in `../../../references/handoff-contracts.md`. Expect:

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

Preserve `C-`, `Q-`, and `RF-` IDs in the memo so diligence points remain traceable.

## Meeting Prep Import

Consume the canonical `meeting_prep_to_memo_builder` contract in `../../../references/handoff-contracts.md`. Expect:

- `package_type`
- `meeting_objective`
- `meeting_type`
- `audience`
- `decision_needed`
- `known_facts`
- `assumptions`
- `priority_questions`
- `likely_pushbacks`
- `answers_received`
- `new_facts`
- `changed_assumptions`
- `diligence_implications`
- `follow_ups`
- `owners`
- `due_dates`
- `source_note`
- `circulation_caveats`

Use prep output for meeting context and action implications; use debrief output for decisions, commitments, and process updates.

## Distressed Recovery Import

Consume the canonical `distressed_recovery_waterfall_to_memo_builder` contract in `../../../references/handoff-contracts.md`. Expect:

- `mandate_context`
- `client_or_stakeholder_perspective`
- `jurisdiction_and_process_stage`
- `capital_structure_summary`
- `claim_register`
- `legal_entity_guarantor_collateral_map`
- `valuation_cases`
- `distributable_value_bridge`
- `recovery_waterfall_summary`
- `recovery_ranges_by_class`
- `value_break_class`
- `fulcrum_security`
- `stakeholder_leverage_map`
- `restructuring_alternatives`
- `recommended_path`
- `diligence_gaps`
- `counsel_review_flags`
- `specialist_review_flags`
- `key_numbers_to_tie`
- `circulation_caveats`

Keep legal-entitlement economics, negotiated plan economics, collateral/liquidation waterfalls, and enterprise-value waterfalls separate in the memo.

## Style Guide Adapter Import

Consume `style_profile_package` and `style_change_log_package` only after source/content QA is stable. These packages follow `style_guide_adapter_style_profile` and `style_guide_adapter_change_log` in `../../../references/handoff-contracts.md`.

Style provenance does not support factual claims or recommendations. If `visual_review_status` is incomplete, preserve the memo's posture below final circulation readiness.

## Missing Payload Fields

If any upstream handoff is missing source dates, evidence labels, or circulation caveats, keep the memo at `screen-grade` or `senior-review-ready` and list the missing fields in `open_items`.
