# Source and Evidence Protocol

## Table of Contents

- [Source hierarchy](#source-hierarchy)
- [Adaptive intake](#adaptive-intake)
- [Source inventory fields](#source-inventory-fields)
- [Stale-data checks](#stale-data-checks)
- [Evidence labels](#evidence-labels)
- [Confidence labels](#confidence-labels)
- [Citation behavior](#citation-behavior)
- [Source package handling](#source-package-handling)

## Source hierarchy
Use the strongest available source that the user is permitted to access.

1. **User-provided source package**: uploaded files, pasted context, emails/Drive/Slack context, data room exports, management packs, internal models, bank books, lender materials, fund documents.
2. **Callable connected apps or user-provided internal-system exports**: ERP, CRM, HRIS, planning tools, data warehouse, BI, source-of-truth databases, and approved provider connectors. Do not imply direct access when the runtime route is not callable.
3. **Primary public sources**: SEC/company filings, earnings releases, investor presentations, company websites, press releases, rating agency reports if accessible, court/regulatory filings.
4. **Trusted provider-standardized sources**: callable provider apps/connectors or user-provided exports from FactSet, S&P Global, CapIQ, PitchBook, LSEG, Morningstar, Moody's, Daloopa, Quartr, Aiera, MSCI, Bloomberg, or another permitted provider. If the requested provider route is not callable, request an export or continue with a clearly labeled fallback.
5. **Credible secondary sources**: reputable news, industry publications, research notes the user provides, reputable databases.
6. **Web fallback**: public search results when no stronger source is available.
7. **Assumptions**: user-provided or explicitly disclosed inferred assumptions. Never present assumptions as facts.

If a `financial-source-of-truth` skill is available, follow its more specific source hierarchy and citation protocol.

## Adaptive intake

### No context
1. Infer the entity and use case from the prompt when safe: company, borrower, issuer, fund, business unit, portfolio company, target, competitor, or counterparty.
2. If the entity is missing or ambiguous, ask only for the minimum blocking item, usually entity name/ticker and profile type.
3. If the user wants a template or asks broadly, produce a blank tearsheet structure plus source checklist instead of fabricating values.
4. For public entities, use connected/internal sources first when available, then primary public sources before secondary summaries.
5. For private entities, funds, and borrowers, avoid guessing from public snippets if core facts are not source-backed; provide a missing-source checklist.

### Partial context
1. Use supplied context as the working scope and do not discard it.
2. Fill non-blocking gaps from connected apps or authoritative sources when available.
3. Label each metric by evidence type and confidence.
4. Mark missing, stale, conflicting, or low-confidence items visibly rather than hiding gaps.
5. Continue when enough exists for a useful baseline; ask only for the missing item that blocks the requested tearsheet.

### Full source package
1. Treat supplied files, links, workbook tabs, data rooms, filings, provider exports, or internal docs as the source package.
2. Build or reuse a source inventory before writing the tearsheet.
3. Extract the facts/metrics needed for a full baseline profile; do not normalize a full model unless requested.
4. If financial tables are messy, hand off to `financials-normalizer` or `excel-data-cleaner` before using the metrics.
5. Return a clean output artifact or concise profile while preserving raw/source materials.

## Source inventory fields
Maintain a focused `Source_Index` for every tearsheet:

| Field | Description |
|---|---|
| `source_id` | Unique identifier such as `S1`, `S2`. |
| `source_name` | Filing, deck, export, provider, internal doc, or website name. |
| `source_type` | User file, connected app, primary filing, provider, press release, secondary source, web fallback, assumption. |
| `provider_or_owner` | Source owner, provider, or internal team. |
| `as_of_date` | Date the source data represents. |
| `retrieved_at` | Date/time the assistant accessed it. |
| `period_covered` | FY/Q/month/LTM/date range. |
| `source_location` | Page, slide, tab, cell range, URL, file name, message link, or data object. |
| `freshness_status` | Current, acceptable, stale, preliminary, unknown. |
| `notes` | Limitations, caveats, conflicts, or access constraints. |

## Stale-data checks
Use conservative stale-data flags:

| Source / data type | Current if | Stale trigger |
|---|---:|---:|
| Market price / market cap / EV | Same day or latest market close | Older than 1 trading day unless historical. |
| Public financials | Latest filed period or current reported quarter | Superseded by newer earnings release/filing. |
| Consensus estimates | Latest available set | Older than 7-14 days around earnings; older than 30 days otherwise. |
| Credit ratings / spreads | Latest available | Older than 1 week for active credits; older than 30 days for static profiles. |
| Private-company financials | Latest management period | Older than the requested period or missing trailing period. |
| Fund AUM / performance | Latest quarterly/monthly report | Older than latest available reporting cycle. |
| Internal actuals / plan | Current close or forecast version | Superseded by newer close, forecast, or plan version. |

Always flag data as `unknown` if freshness cannot be determined.

## Evidence labels
Use exact labels:

- `fact_source_reported`: directly supported by source document or connected system.
- `fact_provider_standardized`: supplied by trusted provider after standardization.
- `derived_calculation`: calculated from cited inputs.
- `management_claim`: statement from company, seller, fund, borrower, or management that needs diligence.
- `estimate_consensus`: consensus estimate or provider forecast.
- `analyst_interpretation`: synthesis based on cited facts, not directly stated by a source.
- `assumption_user_provided`: assumption supplied by the user.
- `assumption_inferred`: inferred from incomplete context; disclose and keep low confidence.
- `missing_required_source`: needed fact or metric not available.

## Confidence labels
- `high`: primary/connected source, current, clear entity, period, unit, and label.
- `medium`: trusted provider or clear source with minor mapping ambiguity or age.
- `low`: stale, preliminary, OCR-heavy, inferred, conflicting, or unclear period/unit/source.

## Citation format
For chat output, cite sources using the environment's native citation syntax when available. For file or artifact output, use compact source references in tables:

`Metric | Period | Value | Source | Evidence | Confidence`

Where `Source` should be a source ID plus location: `S2 p.14`, `S4 tab Revenue cell D22`, `S1 FY2025 10-K Item 8`, `S5 provider pull 2026-05-07`.

## Conflict handling
When sources conflict:

1. Preserve both values when material.
2. Prefer primary source over provider, connected system over copied spreadsheet, final filing over preliminary release, audited over unaudited, latest version over superseded version.
3. State why a value was selected if one is used.
4. Add conflict note to `Risks / gaps` if the conflict matters to the profile.
5. Do not average, smooth, or backsolve conflicting values unless the user asks and the method is disclosed.

## Fact vs assumption standard
- Facts require support from a source.
- Calculations require cited inputs and a visible formula or explanation.
- Claims from management/sellers/funds are still claims, even if cited.
- Assumptions must be marked as assumptions and should not be blended into fact tables.
