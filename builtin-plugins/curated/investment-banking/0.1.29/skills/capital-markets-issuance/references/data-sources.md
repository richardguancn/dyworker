# Data sources, source hierarchy, and evidence discipline

Use this reference whenever data is missing, conflicting, stale, or sourced from multiple places.

## Source hierarchy
Prefer sources in this order, unless the user instructs otherwise:
1. user-provided files, models, memos, banker materials, board materials, data-room exports;
2. connected internal apps and licensed data sources available to the user;
3. issuer filings, offering documents, transcripts, press releases, investor presentations;
4. market data from connected market-data apps or trusted financial data providers;
5. reputable public sources and web search;
6. assumptions clearly labeled as assumptions.

## Required labels
For material data, label as:
- **source-backed**: directly supported by a cited or provided source;
- **user-provided**: supplied by the user in prompt or files;
- **assumption**: estimated because data is unavailable;
- **needs verification**: cannot be relied on before banker/client/counsel review;
- **stale risk**: market-sensitive data may have changed.

## Current market data
Time-stamp:
- equity prices, vwaps, adv, volatility, short interest;
- rates, spreads, yields, cds, bond/loan prices;
- fund flows;
- recent issuance/pricing data;
- investor holdings where holdings lag.

If current data is unavailable, say so and use scenario ranges rather than pretending live accuracy.

## Data conflicts
When sources conflict:
- prefer primary/source-of-truth documents;
- state the conflict;
- explain which source is used and why;
- carry the alternate number as a sensitivity if material;
- do not silently average.

## Data gaps
If a required input is missing, proceed with assumptions when useful and list required diligence.

Common gaps:
- shelf eligibility;
- blackout windows;
- covenant baskets;
- rating agency thresholds;
- current debt trading levels;
- true free float;
- investor holdings/participation;
- sponsor lockups;
- final use of proceeds;
- legal jurisdiction/offering exemption.

## Citation practice
Every fact that drives the recommendation should be traceable. For final answers:
- cite sources when available;
- include source date;
- separate sourced data from assumptions;
- do not cite irrelevant sources;
- do not use stale market data without warning.

## Connected-app behavior
When the runtime exposes scoped connected routes or the user provides exports, prefer them for:
- filings and transcripts;
- internal banker/client materials;
- models and spreadsheets;
- crm/investor relationship history;
- precedent deal databases;
- market-data and research connectors;
- email/calendar context for live processes.

Only fall back to public web search when connected sources are unavailable, insufficient, or the user requests current public information.
