# Data Sourcing and Connector Playbook

Use this reference when gathering market data, financials, peer information, or source support for a comparable company analysis.

## Table Of Contents

- Source hierarchy
- Connector strategy
- Upstream CIM teardown handoff
- Required source log fields
- Data confidence labels
- Freshness rules
- Triangulation rules
- Web fallback rules

## Source hierarchy

Prioritize sources in this order:

1. **User-provided model and files**: Treat the current workbook and uploaded files as the starting record. Preserve the user's work product and identify where it is incomplete or stale.
2. **Callable connected routes or exports**: Search Drive, Sheets, Slack, email, Notion, data-room files, internal research, and prior models only when the runtime exposes a scoped route or the user provides an export.
3. **Licensed market-data routes or exports**: Use sources such as FactSet, Capital IQ, Bloomberg, Refinitiv, PitchBook, Visible Alpha, AlphaSense, Koyfin, or BamSEC only through a callable runtime route or a user-provided export.
4. **Primary issuer/regulatory sources**: SEC EDGAR, company filings, earnings releases, investor presentations, exchange filings, prospectuses, and annual reports.
5. **High-quality secondary sources**: Recognized financial data vendors, exchange websites, industry associations, and reputable news sources.
6. **General search**: Use web search only after trying better sources, or when triangulating gaps. Clearly mark lower-confidence data.

## Connector strategy

### Existing workbook or sheet

Inspect before modifying:

- Sheet names, hidden sheets, named ranges, formulas, external links, comments, and data validation.
- Last-updated dates, source references, and valuation date.
- Whether the workbook is a trading comps model, precedent transaction model, hybrid valuation pack, or simple screen.
- Whether formulas are consistent across peer rows.

Preserve working formulas. Do not rebuild from scratch unless the structure is unusable or the user asks for a clean rebuild.

### Internal documents

Look for:

- Prior comps decks and valuation memos.
- Industry landscapes, market maps, and peer lists.
- Investment committee memos, board materials, or diligence notes.
- Management guidance, KPI definitions, or operating metrics.
- Analyst notes and prior model assumptions.

Use internal documents for context, peer rationale, KPI definitions, and judgment. Use fresh market data for current prices and market values unless the task is historical.

### Market-data systems

If available, prefer market-data systems for:

- Market price, market cap, shares outstanding, diluted shares, net debt, preferred stock, minority interest, and EV.
- Consensus estimates for revenue, EBITDA, EBIT, EPS, FCF, KPIs, and fiscal year calendars.
- Broker consensus and revision history.
- Screening peer candidates by industry, geography, size, growth, margins, and valuation.

Even with a trusted vendor, check definitions. Vendor EBITDA, adjusted EPS, and FCF definitions can vary materially.

### SEC/company filings

Use primary filings for:

- Reported financials and historical periods.
- Segment revenue, backlog, customer concentration, risk factors, and accounting policies.
- Share count, debt, cash, leases, converts, preferred stock, and non-controlling interests.
- Non-GAAP reconciliations and management adjustments.

For US public companies, SEC company facts and filings can support structured extraction. Still verify XBRL tags and units, because company-specific extensions and context differences can distort comparability.

## Upstream CIM teardown handoff

When a `cim-teardown` output exists, inspect its `model_input_handoff` table before loading seller-provided metrics into the comps model. Use the shared `cim_teardown_to_model_builder` contract in `../../../../references/handoff-contracts.md`. Expected fields include:

- `handoff_id`, `target_skill`, `claim_id`, `evidence_id`, `red_flag_id`, `question_id`, `task_id`, `workstream`, `model_area`, `model_subarea`
- `metric_or_driver`, `metric_definition`, `definition_status`, `period`, `segment_or_scope`, `currency`, `unit`, `scale`
- `reported_value`, `adjusted_value`, `normalized_value`, `value_basis`, `source_pointer`, `native_evidence_label`, `canonical_evidence_category`
- `source_quality`, `freshness_status`, `conflict_status`, `confidence`, `evidence_gap`, `recommended_model_treatment`, `case_mapping`, `sensitivity_to_run`, `notes_for_model_builder`

Use the handoff to decide whether adjusted EBITDA, revenue, ARR, KPIs, capex, NWC, net debt, or segment metrics can support trading comps, precedent transactions, or implied valuation ranges. If a seller metric is low-confidence, show it as a separate sensitivity, caveat, or open diligence item rather than mixing it into normalized market multiples.

## Required source log fields

Every sourced metric should be traceable. Use a `Sources` tab or table with:

- Company or ticker.
- Metric.
- Period.
- Source name.
- Connector path, document name, filing accession, or URL.
- Retrieval date.
- Data date or filing date.
- Source type: reported, adjusted, consensus, management guidance, model estimate, or analyst estimate.
- Notes on definition and normalization.

## Data confidence labels

Use these labels in the workbook or QA log:

- **High**: Primary filing, company release, or market-data system with definition checked.
- **Medium**: Reputable secondary source or vendor data with plausible but unverified definition.
- **Low**: Web search, unsourced model input, stale deck, or unclear definition.
- **Do not use without review**: Blog/forum/social media data, AI-generated summaries without source support, values with inconsistent units or periods.

## Freshness rules

- Market prices and EV inputs should be as of the valuation date.
- Consensus estimates should state the retrieval date and consensus period.
- Historical reported data should tie to filings or earnings releases.
- If market data and financials are from different dates, disclose the mismatch.
- If the workbook is being refreshed, do not let stale source dates remain in formulas, comments, or outputs.

## Triangulation rules

When a metric matters to the conclusion, triangulate if possible:

- Compare vendor EV to a manual EV bridge.
- Compare adjusted EBITDA from vendor to company non-GAAP reconciliation.
- Compare consensus estimates to investor presentation guidance and recent earnings transcript guidance.
- Compare peer inclusion against business description, segment mix, and KPI profile, not only industry code.

## Web fallback rules

When using web search:

- Prefer primary company and regulator pages.
- Use reputable financial data providers only for preliminary values unless definitions are clear.
- Cite sources in the written summary and record them in the `Sources` tab.
- Use search to identify filings, transcripts, investor presentations, and peer candidates, not to blindly collect model-critical numbers.
- Flag all unsourced or lower-confidence numbers in the QA log.
