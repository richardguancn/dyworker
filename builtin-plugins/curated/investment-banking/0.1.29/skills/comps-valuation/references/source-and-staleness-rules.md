# Source And Staleness Rules

## Table Of Contents

- [Source Hierarchy](#source-hierarchy)
- [Public Comps Stale-Data Checks](#public-comps-stale-data-checks)
- [Mixed-Source And Conflict Rules](#mixed-source-and-conflict-rules)
- [Evidence Labels](#evidence-labels)
- [Canonical Input Contract](#canonical-input-contract)
- [Data Conventions](#data-conventions)
- [Overrides And Assumptions](#overrides-and-assumptions)

## Source Hierarchy

Follow `financial-source-of-truth` for source hierarchy, citation format, stale-data checks, and source conflicts. For comps work, prefer:

1. user-provided workbooks, provider exports, filings, investor decks, and source files;
2. connected financial-data sources or workspace apps;
3. primary filings, company IR, exchange data, and official announcements;
4. reputable market-data or estimate providers;
5. general web/search only as a labeled fallback.

Use the source with the clearest provenance for the requested decision. Do not silently blend values from different source qualities.

## Public Comps Stale-Data Checks

For each company in the core table, carry or disclose:

- market-data as-of date for price, market cap, and enterprise value;
- share count and dilution source and date;
- balance-sheet basis for cash, debt, minority interest, preferred equity, leases, pensions, investments, and other EV bridge items;
- financial-statement period end for LTM denominators;
- estimate source and estimate-as-of date when NTM is used;
- trading and reporting currency;
- FX date and spot/average convention when currencies differ;
- EV bridge basis;
- adjustment basis: reported, adjusted, consensus, company-defined, or inferred.

Never mix today's share price with stale share count, stale cash/debt, stale estimates, or stale denominators without labeling the mismatch in `QA Flags And Caveats`.

## Mixed-Source And Conflict Rules

- If a provider value, filing value, and user value disagree, disclose the conflict and use the value with the strongest evidence for the requested output.
- If market data is current but balance-sheet data is latest reported, label the as-of mismatch.
- If a post-period event changes capital structure, use the event-adjusted bridge only when the event amount and timing are supportable.
- If estimates come from a different date than pricing, label the estimate vintage.
- If the analysis uses user-provided values that cannot be verified, label them as user-provided, management-provided, or seller-provided as applicable.

## Evidence Labels

Use shared evidence labels for major inputs and conclusions:

- `fact_primary`
- `fact_secondary`
- `third_party_estimate`
- `internal_estimate`
- `management_claim`
- `seller_claim`
- `assumption`
- `inference`
- `unsupported`

Comps-specific mapping:

- company filing financials = `fact_primary`
- traded price from a reliable market-data source = `fact_secondary`, with as-of date
- consensus estimates = `third_party_estimate`
- peer-set inclusion rationale = `inference`
- selected multiple range = `inference`
- manual peer inclusion/exclusion = `assumption` or `inference`, with rationale
- target private-company financials from CIM, banker deck, or management materials = `seller_claim` or `management_claim` unless verified

## Canonical Input Contract

When user files or exports are available, normalize them internally into these fields where practical:

| Table | Required fields | Helpful fields |
|---|---|---|
| `entities` | `company_id`, `company_name`, `ticker`, `sector_module`, `reporting_currency`, `is_target` | exchange, country, taxonomy, business model tags |
| `market_data` | `company_id`, `as_of_date`, `price`, `trading_currency`, `basic_shares` | share factor, ADV, provider market cap |
| `capital_structure` | `company_id`, `as_of_date`, `cash`, `st_debt`, `lt_debt` | restricted cash, trapped cash, leases, minority interest, preferreds, pensions, investments |
| `financials` | `company_id`, `ltm_period_end`, `ltm_revenue` | EBITDA, EBIT, net income, CFO, capex, FCF, FFO, AFFO, TBV, book value |
| `estimates` | `company_id`, `estimate_as_of`, `ntm_method` | NTM revenue, EBITDA, EBIT, net income, EPS, FCF, FFO, AFFO |
| `dilution` | `company_id`, `instrument_type`, `quantity` | strike, conversion price, treasury stock method notes |
| `fx_rates` | `date`, `from_ccy`, `to_ccy`, `rate`, `rate_type` | spot, average, period basis |
| `adjustments` | `company_id`, `metric`, `period_end`, `amount`, `category`, `notes` | source, approval, adjustment basis |

## Data Conventions

- Use `company_id` as the stable join key. Do not rely only on ticker strings.
- Dates must be `YYYY-MM-DD`.
- Currency codes should be ISO 4217.
- Monetary values should be absolute, not per-share, unless the field is explicitly per-share.
- Shares should be actual shares, not thousands.
- Percent fields should be stored as percent, such as `18.5`, not `0.185`.
- Keep periods, currencies, consolidation scope, and adjustment basis consistent across each multiple.

## Overrides And Assumptions

- Keep sourced values distinguishable from assumptions.
- Attach a short reason to every manual override, proxy, adjustment, or substitution.
- Point important inputs back to their source table, filing, provider export, connector path, or stated assumption when possible.
- If producing an artifact, preserve overrides in an audit section or notes field.
- Do not use a silent fallback. Put workarounds in `Assumptions`, `QA Flags And Caveats`, or `Open Items / Data Requests`.
