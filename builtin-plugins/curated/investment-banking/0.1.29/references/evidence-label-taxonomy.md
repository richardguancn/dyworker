# Investment Banking Evidence Label Taxonomy

This is the shared evidence-label taxonomy for Investment Banking skill handoffs. It does not require every skill to rename its internal labels or validator enums. Use it to translate skill-local labels into a common evidence posture when outputs move between financials normalization, decks, models, diligence, memos, and source-of-truth review.

## How to use this crosswalk

1. Preserve the producing skill's internal `evidence_label` when that label is part of a schema, validator, workbook, deck plan, or run log.
2. Add or infer the canonical category during handoff, review, or final QA.
3. If a local label could map to more than one canonical category, use the source context, citation strength, freshness, and conflict status to choose the most conservative category.
4. Do not upgrade seller, management, assumption, estimate, stale, contradicted, or unknown items into verified facts merely because they appear in a model, deck, or normalized table.

Recommended handoff fields:

| Field | Purpose |
|---|---|
| `native_evidence_label` | The label emitted by the source skill or file; `local_evidence_label` is an acceptable legacy alias. |
| `canonical_evidence_category` | One of the canonical categories below. |
| `source_id` | Source ledger ID, model source ID, or deck source-register ID. |
| `source_type` | Filing, audited statement, VDR, CIM, management case, connector, data provider, web source, user input, estimate, or other source type. |
| `as_of_date` | Date or period the evidence supports. |
| `freshness_status` | `current`, `acceptable_for_period`, `preliminary`, `stale`, or `unknown`. |
| `conflict_status` | `none`, `contradicted`, `unresolved`, or `not_checked`. |
| `confidence` | High, medium, or low based on source quality and fit for purpose. |
| `treatment` | Use normally, attribute, sensitize, haircut, diligence ask, placeholder, exclude, or unresolved. |

## Canonical categories

| Canonical category | Definition | Typical treatment |
|---|---|---|
| `verified_fact` | Directly supported by an authoritative source that is appropriate for the claim and fresh enough for the decision. | Use normally with citation, source date, period, units, and any scope limit. |
| `reported_fact` | Stated in a source or data provider but not independently verified, standardized by a provider, or lower in the source hierarchy than an available primary source. | Attribute to the source; verify against primary evidence when material. |
| `seller_claim` | Asserted by seller, broker, sponsor, CIM, teaser, lender presentation, management presentation, or VDR summary without independent support. | Treat as a claim to test; route to diligence, sensitivity, or caveat. |
| `management_statement` | Spoken or written management statement, guidance explanation, budget, management case, KPI commentary, or meeting/transcript comment. | Attribute carefully; do not treat as proof of causality or outcome. |
| `pro_forma_adjustment` | Adjustment, add-back, reclassification, normalization, synergy, dis-synergy, standalone cost, purchase-accounting item, or other change to reported results or metrics. | Show bridge, support level, owner, recurrence, cash/non-cash treatment, and accepted/rejected/pending status. |
| `assumption` | User, client, sponsor, lender, analyst, or modeler input chosen for analysis rather than proven by evidence. | Label visibly, show owner, and sensitize if material. |
| `inference` | Analyst or banker conclusion drawn from evidence but not explicitly stated in a source. | Cite underlying facts, state confidence, and avoid proof language. |
| `estimate` | Calculated, approximated, consensus, benchmark, analog, model-derived, or source-derived value with method dependence. | Show formula, inputs, as-of date, method, and sensitivity where relevant. |
| `stale` | Source exists but is likely superseded, outside the requested period, missing a current as-of date, or too old for market-sensitive use. | Flag as stale; avoid decision-grade reliance unless the user requested the historical period. |
| `contradicted` | Supported by at least one source but disputed by another source, definition, period, currency, scale, or version. | Preserve both values, identify controlling source if possible, and escalate unresolved conflicts. |
| `unknown` | Needed for the analysis but not sourced, not accessible, not determined, or intentionally left as placeholder. | Convert to a diligence ask, source request, placeholder, or explicit caveat. |

## Category precedence

Use the most conservative applicable category when multiple labels fit:

1. `contradicted` if material sources disagree and the conflict is unresolved.
2. `stale` if the evidence is likely superseded for the requested decision.
3. `unknown` if the item is missing or unsupported.
4. `seller_claim`, `management_statement`, `pro_forma_adjustment`, or `assumption` if the source posture is claim-based, adjustment-based, or chosen rather than proven.
5. `estimate` or `inference` if the item depends on calculation or judgment.
6. `reported_fact` if source-stated but not verified against the controlling source.
7. `verified_fact` only when the authoritative source directly supports the exact claim.

Staleness and conflict can also be tracked as overlays through `freshness_status` and `conflict_status`. If a handoff has only one label field, use `stale` or `contradicted` as the canonical category when either condition changes the conclusion.

## Crosswalk: financials-normalizer

| Local label | Canonical category | Handoff note |
|---|---|---|
| `fact_source_reported` | `verified_fact` or `reported_fact` | Use `verified_fact` for primary/controlling source values; use `reported_fact` for lower-control or user-provided extracts not independently checked. |
| `fact_provider_standardized` | `reported_fact` | Provider-standardized values are source-stated but may differ from primary filings due to standardization. |
| `derived_calculation` | `estimate` | Preserve formula and cited inputs; upgrade only the input facts, not the derived output. |
| `management_adjusted` | `pro_forma_adjustment` or `management_statement` | Use `pro_forma_adjustment` for adjusted metrics/add-backs; use `management_statement` for budget or management-case commentary. |
| `analyst_adjusted` | `pro_forma_adjustment`, `assumption`, or `estimate` | Depends on whether the adjustment is supported, chosen, or formula-derived. |
| `assumption_user_provided` | `assumption` | Preserve user/client ownership. |
| `assumption_inferred` | `inference` or `assumption` | Use `inference` when evidence-backed reasoning exists; otherwise `assumption`. |
| `estimate_consensus` | `estimate` or `reported_fact` | Consensus is usually an estimate; treat as `reported_fact` only when the claim is "consensus is X" with provider citation. |
| `missing_required_source` | `unknown` | Convert to a source request or diligence ask. |

## Crosswalk: pitch-deck-builder

| Local label or status | Canonical category | Handoff note |
|---|---|---|
| `fact` | `verified_fact` or `reported_fact` | Choose based on source hierarchy and whether the exact claim is directly supported. |
| `source_derived_estimate` | `estimate` | Preserve method and input source IDs. |
| `model_derived_estimate` | `estimate` | Cite model/run output and upstream source posture. |
| `banker_judgment` | `inference` | Keep underlying facts visible; avoid certainty language. |
| `client_assumption` | `assumption` | Preserve owner and deck caveat. |
| `external_assumption` | `assumption` | Low-confidence until replaced by evidence. |
| `placeholder` | `unknown` | Keep as `needs_source` or open item. |
| `unknown` | `unknown` | Convert to source request. |
| `supported` | Keep mapped local category | Status only; use the underlying label to pick the canonical category. |
| `needs_source` | `unknown` | Do not polish into a factual claim. |
| `assumption` | `assumption` | Status-level assumption; preserve source owner if known. |

## Crosswalk: model builders

### DCF model builder

| Local label | Canonical category | Handoff note |
|---|---|---|
| `reported` | `verified_fact` or `reported_fact` | Use `verified_fact` for cited filings/authoritative historicals; otherwise `reported_fact`. |
| `company_guidance` | `management_statement` | Guidance is management-stated; cite date and scope. |
| `consensus` | `estimate` | Treat as market estimate; cite provider and as-of date. |
| `management_case` | `management_statement` or `assumption` | Management-owned forecast unless supported by contracts/backlog. |
| `user_provided` | `assumption`, `reported_fact`, or `verified_fact` | Depends on whether the user provided a source document, explicit assumption, or governing model. |
| `connected_app` | `verified_fact` or `reported_fact` | Depends on system-of-record status and scope. |
| `web_research` | `reported_fact` | Do not treat as verified unless corroborated by primary evidence. |
| `analyst_estimate` | `estimate` or `assumption` | Use `estimate` when method-driven; use `assumption` when chosen. |
| `placeholder` | `unknown` | Screen-grade at best if material. |
| `derived` | `estimate` | Preserve formula and inputs. |

### Three-statement model builder

| Local label | Canonical category | Handoff note |
|---|---|---|
| `source_reported` | `verified_fact` or `reported_fact` | Choose based on source quality and directness. |
| `company_provided` | `reported_fact`, `management_statement`, or `seller_claim` | Company files may be reported facts; management cases are management statements; CIM/VDR assertions can be seller claims. |
| `connector_sourced` | `verified_fact` or `reported_fact` | Depends on whether the connector is a scoped system of record. |
| `public_filing` | `verified_fact` | Use for the exact filed claim with period and citation. |
| `web_verified` | `reported_fact` | Public web support is usually reported unless corroborated by primary source. |
| `management_guidance` | `management_statement` | Cite date, period, and guidance basis. |
| `analyst_estimate` | `estimate` or `assumption` | Method-driven estimates map to `estimate`; chosen forecast inputs map to `assumption`. |
| `benchmark` | `estimate` or `reported_fact` | Benchmarks are estimate/proxy unless the claim is the benchmark value itself. |
| `assumption` | `assumption` | Preserve owner and sensitivity. |
| `placeholder` | `unknown` | Keep as open item until replaced. |

### LBO model builder

| Local label | Canonical category | Handoff note |
|---|---|---|
| `sourced_fact` | `verified_fact` or `reported_fact` | Use `verified_fact` only for controlling source support. |
| `management_assumption` | `management_statement` or `assumption` | Forecast/budget from management is management statement; modeled input selected by the analyst is assumption. |
| `seller_claim` | `seller_claim` | Preserve as claim until independently supported. |
| `sponsor_assumption` | `assumption` | Preserve sponsor ownership and return sensitivity. |
| `lender_case` | `assumption` or `estimate` | Conservative underwriting case; may be estimate if formula/haircut-based. |
| `analog_proxy` | `estimate` | Market, comp, or rating-agency proxy. |
| `fallback_assumption` | `assumption` | Screen-grade placeholder until replaced. |
| `unsupported` | `unknown` | Not decision-ready if material. |

### Merger model builder

| Local label | Canonical category | Handoff note |
|---|---|---|
| `signed_agreement` | `verified_fact` | Use for the exact signed deal terms covered by the agreement. |
| `filed` | `verified_fact` | Use for the exact filed claim with citation and period. |
| `audited` | `verified_fact` | Use for audited financial statement values. |
| `reviewed` | `reported_fact` or `verified_fact` | Use `verified_fact` when reviewed interim statements directly control the claim. |
| `vdr` | `reported_fact`, `seller_claim`, or `management_statement` | Depends on whether the VDR item is a record, seller summary, or management case. |
| `management_case` | `management_statement` or `assumption` | Preserve management ownership. |
| `consensus` | `estimate` | Cite provider and as-of date. |
| `financing_commitment` | `verified_fact` or `reported_fact` | Binding commitments can verify terms; draft/indicative papers should be attributed. |
| `accounting_memo` | `reported_fact`, `pro_forma_adjustment`, or `assumption` | PPA and accounting treatments often include pro forma adjustments and assumptions. |
| `tax_memo` | `reported_fact`, `pro_forma_adjustment`, or `assumption` | Preserve memo scope and uncertainty. |
| `user_provided` | `assumption`, `reported_fact`, or `verified_fact` | Depends on whether the user provided a source, file, or chosen assumption. |
| `estimate` | `estimate` | Preserve method and input support. |
| `assumption` | `assumption` | Preserve owner and sensitivity. |
| `placeholder` | `unknown` | Screen-grade at best if material. |
| `unsupported` | `unknown` | Not decision-ready if material. |

### Comps model builder and other model handoffs

| Local wording | Canonical category | Handoff note |
|---|---|---|
| `reported` | `verified_fact` or `reported_fact` | Use source hierarchy to decide whether the reported metric is controlling. |
| `adjusted` or `normalized` | `pro_forma_adjustment` or `estimate` | Use `pro_forma_adjustment` for add-back/reclass bridges; use `estimate` for model-derived normalization. |
| `consensus` | `estimate` | Consensus is an estimate, not a company fact. |
| `internally estimated` | `estimate` or `assumption` | Method-driven estimates are `estimate`; selected cases are `assumption`. |
| `source_quality` low or `evidence_gap` true | `unknown`, `stale`, or `contradicted` | Choose the status that explains why the item is not decision-grade. |

## Language guardrails

| Canonical category | Use language like | Avoid language like |
|---|---|---|
| `verified_fact` | filed, audited, signed, contracted, per executed agreement | appears, should be, suggests |
| `reported_fact` | according to, reported by, provider shows | verified, confirmed |
| `seller_claim` | seller claims, CIM asserts, banker deck states | the company has, proven, validated |
| `management_statement` | management stated, guidance implies, CEO said | confirms causality, guarantees |
| `pro_forma_adjustment` | adjusted for, add-back supported by, pending support | normalized as fact |
| `assumption` | we assume, case assumes, user provided | will, should, expected without source |
| `inference` | suggests, indicates, consistent with | proves, confirms |
| `estimate` | estimated, calculated, approximated, consensus indicates | exact, verified |
| `stale` | prior-period, stale, superseded, as of | current, latest |
| `contradicted` | conflicting sources show, unresolved variance | blended, averaged without explanation |
| `unknown` | not yet sourced, needs support, placeholder | blank precision, implicit fact |
