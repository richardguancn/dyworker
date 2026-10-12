# Tie-out and Source Checks

## Purpose

A model audit is incomplete unless material outputs and assumptions can be traced to reliable evidence. Use this reference to build a source tie-out ledger and identify whether the model is fact-supported, assumption-led, or unsupported.

When available, use financial-source-of-truth for the source hierarchy, stale-data rules, source conflict handling, and fact/assumption labels.

## Tie-out workflow

1. Identify key outputs.
2. Trace each output to the model tab, cell, and formula path.
3. Identify the assumptions, source rows, and source documents that feed the output.
4. Label each driver by evidence type.
5. Flag missing, stale, conflicting, or unsupported evidence.
6. State whether the output is decision-grade, diligence-grade, preliminary, assumption-led, or not supportable.

When an audit includes a diagnostic output bridge, trace three layers separately: the reported model output, each identified error or inconsistent assumption, and the `audit-indicative` output calculated only to quantify those identified failures.

## Evidence labels

Use these labels consistently:

- **primary_source_fact:** audited filings, signed credit agreements, executed transaction documents, regulator filings, company-published earnings releases, official macro/statistical releases, bank statements, trial balances, rent rolls, or direct source documents.
- **secondary_source_fact:** reputable data providers, third-party research, broker reports, market-data vendors, or summaries that quote primary sources.
- **management_claim:** statement from management, earnings call, lender presentation, management presentation, or management interview.
- **seller_claim:** statement from cim, teaser, investor deck, banker deck, data-room summary, or seller process materials.
- **third_party_estimate:** consensus, broker model, rating agency estimate, appraisal, consultant estimate, expert network view, or market forecast.
- **internal_estimate:** analyst-built estimate using available information.
- **user_assumption:** assumption explicitly supplied by the user.
- **inference:** reasoned conclusion based on facts but not directly stated by a source.
- **model_extracted_input:** value or assumption read directly from the supplied model but not independently substantiated by reviewed evidence.
- **audit_diagnostic:** formula-driven audit calculation used to quantify a discrete identified error; not a remediated source model or a sourced fact.
- **unsupported:** no reliable support found or provided.

## Source tie-out ledger fields

Use these fields for full audits:

| field | purpose |
|---|---|
| output_or_driver | material output, assumption, or line item being tested |
| model_location | workbook, tab, cell/range, formula, or memo/deck location |
| model_value | value shown in the model |
| source_name | filing, cim, vdr file, market data source, model tab, or document |
| source_location | page, section, table, note, exhibit, or citation |
| source_value | value from the source |
| tie_status | ties, ties_with_rounding, does_not_tie, unsupported, stale, conflicting, not_tested |
| variance | difference between source and model value |
| evidence_label | evidence type label |
| as_of_date | date the source value was current |
| decision_impact | low, medium, high, or critical |
| recommended_action | fix, explain, sensitivity-test, source request, diligence ask, or escalate |

For `audit_diagnostic` results, also show the reported model result, the diagnostic calculation or bridge logic, the input provenance, and unresolved exclusions before reliance.

## Tie status definitions

- **ties:** model value matches source exactly or within immaterial rounding.
- **ties_with_rounding:** variance explained by rounding, scaling, currency conversion, or period convention.
- **does_not_tie:** variance is unexplained or material.
- **unsupported:** no source has been provided or identified.
- **stale:** source may have been valid historically but is not current for the decision.
- **conflicting:** two or more sources disagree and the model does not explain the chosen source.
- **not_tested:** outside current scope or source unavailable.

## Staleness rules by source type

Treat stale data as a model issue when it feeds a material decision driver.

Examples:
- market price, fx rate, yield, spread, index level, commodity price, public-market multiple: must have a current as-of date.
- consensus estimates and broker data: must identify estimate date and data provider/source.
- financial statements: must identify fiscal period and whether annual data is audited or quarterly/interim.
- cim, vdr, management presentation, qoe report, appraisal, rent roll, and lender materials: must identify document date and whether a newer version exists.
- credit agreement, indenture, lease, purchase agreement, or court filing: must identify execution or filing date and whether amendments exist.

## Source conflict handling

When sources conflict:
1. Do not silently average or choose the source that supports the thesis.
2. Rank sources using financial-source-of-truth or the best available hierarchy.
3. Show the competing values and source dates.
4. Explain likely reasons for the variance: period, currency, scope, accounting treatment, pro forma adjustment, share count, denominator definition, or stale data.
5. Mark decision impact.
6. Recommend a tie-out fix or diligence ask.

## Common tie-out failure patterns

- LTM metrics do not match the period used in comps or leverage calculations.
- EBITDA definition differs across valuation, credit, covenant, and qoe tabs.
- Net debt excludes leases, preferred, minority interest, pensions, or earnouts inconsistently.
- Shares outstanding use basic share count in one tab and diluted share count in another.
- Market data is current in one tab but stale in another.
- Seller add-backs are treated as verified EBITDA without support.
- Model output ties to deck but neither ties to source documents.
- Forecast assumptions are presented as sourced facts.
- A run-rate synergy amount is recognized before a model-stated realization ramp or without support for timing.
- Accretion/dilution interest expense omits disclosed financing uses, payoff/refinancing needs, fees, or other supported funding requirements.
- Visible PASS checks do not test the completeness of the transaction assumptions that drive the headline output.
