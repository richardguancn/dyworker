# Evidence label crosswalk

Use this crosswalk when `financials-normalizer` hands normalized financial data to downstream skills that use the shared evidence-label taxonomy.

The shared taxonomy lives at `../../../references/evidence-label-taxonomy.md`. If that file is not present in the local checkout, still treat it as the canonical taxonomy target and keep this crosswalk as the skill-local contract.

## Contract

- Preserve the native `financials-normalizer` label in `evidence_label`.
- Add `canonical_evidence_category` for downstream consumers that expect the shared taxonomy.
- Do not collapse native labels inside the normalizer output; the native labels carry finance-specific nuance needed for QA, source tie-out, and model handoff.
- If a downstream skill only accepts one label field, pass the canonical category there and include the native label in a companion column, source-basis note, or handoff memo.
- If the shared taxonomy changes, update this crosswalk before changing the native label set.

## Native to canonical mapping

| Native label | Canonical category | Preserve nuance / handoff note |
|---|---|---|
| `fact_source_reported` | `verified_fact` or `reported_fact` | Use `verified_fact` when directly visible in an authoritative cited source, filing, connected system, source document, or user-provided source package. Use `reported_fact` when the source is credible but not controlling. |
| `fact_provider_standardized` | `reported_fact` | Provider-standardized values are sourced facts but not primary-source reported values. Include provider name, retrieval date, and any provider standardization caveat. |
| `derived_calculation` | `estimate` | Use for formula-derived values from cited inputs. Include calculation method and source IDs; downstream may treat mechanical tie-outs as verified support but should not erase the calculated nature. |
| `management_adjusted` | `pro_forma_adjustment` or `management_statement` | Use `pro_forma_adjustment` for company-defined adjusted metrics, management model adjustments, or management-provided add-backs. Use `management_statement` when the item is only management commentary or an unsupported management case. |
| `analyst_adjusted` | `pro_forma_adjustment`, `assumption`, or `estimate` | Use for banker, lender, user, or assistant normalization adjustments, reclasses, add-backs, or analytical changes. Include rationale, direction, source support, and reviewer status. |
| `assumption_user_provided` | `assumption` | Use for explicit user assumptions. Preserve owner/source, date if relevant, and affected outputs. |
| `assumption_inferred` | `inference` | Use only when needed to proceed from incomplete context. Keep confidence low unless confirmed and state the source needed to replace it. |
| `estimate_consensus` | `estimate` | Use for Street consensus, third-party forecast, or provider estimate. Include estimate provider, vintage/as-of date, metric definition, and period. |
| `missing_required_source` | `unknown` | Use instead of filling unsupported blanks. Convert to a source request, diligence ask, or open item before decision-grade handoff. |

## Downstream handoff fields

When practical, normalized tables and handoff packages should carry these fields:

| Field | Required? | Purpose |
|---|---:|---|
| `evidence_label` | Yes | Exact native normalizer label. |
| `canonical_evidence_category` | Yes for handoff | Shared taxonomy category for downstream skill compatibility. |
| `evidence_label_note` | Recommended | Explains why the native label maps to the canonical category and any caveat. |
| `source_id` | Yes | Stable source key. |
| `source_location` | Yes when available | Page, tab, cell, row, URL, or system object. |
| `confidence` | Yes | `high`, `medium`, or `low`. |
| `open_question` | Required for unknowns/inferences | Missing source, diligence ask, or confirmation needed. |

## QA rules

- `missing_required_source` must map to `unknown` and should not have a numeric `normalized_value` unless the value is explicitly a placeholder outside decision-grade outputs.
- `assumption_inferred` should map to `inference`, carry `low` confidence by default, and include a replacement source need.
- `fact_provider_standardized` should not be upgraded to `verified_fact` unless tied out to a primary source or connected system.
- `management_adjusted` and `analyst_adjusted` should stay separate natively even though both usually map to `pro_forma_adjustment`; downstream users need to know whether the adjustment came from management or analyst normalization.
- `estimate_consensus` should include an as-of date because estimate vintages can change quickly.
