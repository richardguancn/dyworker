# Domain Playbook

Use this reference to adapt cleaning, validation, and formatting to the user's context.

## Table Of Contents

- Domain Inference Signals
- Finance / FP&A / Accounting
- Investing / Markets
- Operations
- Sales / RevOps
- Product / Analytics
- HR / People
- Procurement / Vendor / Budget

Each domain section covers preserve rules, cleaning judgment, checks, and formatting.

## Domain Inference Signals

Infer domain from user language, sheet names, headers, values, and expected output.

- Finance/FP&A/accounting: budget, actual, forecast, variance, GL, cost center, entity, account, department, opex, capex, revenue, COGS, EBITDA, fiscal year, quarter, month, scenario.
- Investing/markets: ticker, CUSIP, ISIN, security, portfolio, NAV, return, yield, spread, basis points, benchmark, price, holdings, exposure, market value.
- Operations: SLA, ticket, queue, location, owner, status, priority, throughput, cycle time, backlog, incident, fulfillment, capacity, defect.
- Sales/revops: account, opportunity, lead, pipeline, ARR, MRR, ACV, stage, close date, renewal, churn, rep, territory, CRM, Salesforce, HubSpot.
- Product/analytics: user ID, event, session, timestamp, cohort, experiment, variant, platform, DAU, WAU, MAU, retention, conversion, funnel.
- HR/people: employee ID, worker, manager, org, level, compensation, start date, termination, location, FTE, headcount, requisition.
- Procurement/vendor/budget: vendor, invoice, PO, contract, renewal, subscription, requester, approval, department, one-time, recurring, tax, payment terms.

If multiple domains are present, clean to the most downstream purpose. Example: a procurement budget export for FP&A should preserve procurement fields but format scenario, department, and spend fields for finance review.

## Finance / FP&A / Accounting

### Preserve

- entity, subsidiary, department, cost center, GL/account code, account name.
- period, fiscal year, quarter, month, scenario (`actual`, `budget`, `forecast`).
- currency, sign convention, one-time vs recurring, capex vs opex.
- source system, journal/invoice/transaction IDs.

### Cleaning judgment

- Do not flip signs unless the source sign convention is explicit.
- Do not combine actual/budget/forecast without a scenario column.
- Treat `FY26 Q1`, `Q1 FY26`, and `2026-Q1` as period labels unless fiscal calendar is known.
- Preserve rollup rows separately from transaction/detail rows.
- Where a dataset has both `account code` and `account name`, preserve both.

### Checks

- Amount missing where account/period exists.
- Multiple currencies without currency column.
- Period labels inconsistent.
- Duplicate entity + account + department + period + scenario rows.
- Totals included in detail data.
- Negative values in fields where unexpected, but do not auto-delete.

### Formatting

- Amounts: comma format, usually 0 decimals for dollars unless cents matter.
- Percentages: one decimal for margin/variance unless user requests otherwise.
- Variance: label favorable/unfavorable only when sign convention is known.

## Investing / Markets

### Preserve

- ticker, CUSIP, ISIN, SEDOL, issuer/security name, portfolio/account, broker/custodian.
- trade date, settle date, pricing date, benchmark, metric units, currency.
- basis points vs percent vs decimal return.

### Cleaning judgment

- Treat security identifiers as text.
- Do not infer ticker-to-company mappings without a trusted source.
- Do not convert return units unless unit labels are clear.
- Do not aggregate positions across accounts, currencies, share classes, or dates unless requested.

### Checks

- Missing security ID/ticker/date.
- Mixed currencies or return units.
- Duplicate portfolio + security + date rows with conflicting values.
- Negative prices, impossible yields, stale pricing dates.

### Formatting

- Prices: 2-4 decimals depending on asset class.
- Returns: percent with 2 decimals unless otherwise requested.
- Bps: numeric bps with explicit `bps` label, not percent format.

## Operations

### Preserve

- ticket/order/job ID, owner, team, location, status, priority, SLA, created/updated/resolved dates.
- exception reasons, blocker notes, queue/source fields.

### Cleaning judgment

- Normalize statuses but do not collapse lifecycle states with different process meanings.
- Preserve timezone and local dates where SLA calculations matter.
- Do not remove old/closed items unless the requested scope excludes them.

### Checks

- Missing owner/status/priority for active items.
- Resolved date before created date.
- SLA breached but status active/complete mismatch.
- Duplicate ticket/order IDs.
- Open items with no recent update.

### Formatting

- Status/priority fields should be readable and consistently cased.
- Date/time fields should include timezone if known.
- Summary may include counts by owner/status/priority when useful.

## Sales / RevOps

### Preserve

- account ID, opportunity ID, contact/lead ID, CRM source ID.
- stage, amount, ARR/MRR/ACV, close date, create date, owner/rep, territory, segment.
- renewal/churn/new business labels.

### Cleaning judgment

- Use CRM IDs as keys; names alone are not safe for de-duplication.
- Keep stage values distinct unless there is a supplied stage mapping.
- Preserve amount type: ARR, MRR, ACV, TCV, bookings, pipeline.
- Do not convert close dates or forecast categories without context.

### Checks

- Opportunity missing account, owner, stage, close date, or amount.
- Close date before create date.
- Won/lost opportunities with open stages.
- Duplicate opportunity IDs or account names with multiple IDs.
- Mixed currencies in pipeline amount.

### Formatting

- Revenue metrics: currency format, 0 decimals unless precision matters.
- Stage/category: title case and stable order if summary is produced.

## Product / Analytics

### Preserve

- user/account/event/session IDs, timestamp, timezone, event name, platform, experiment/cohort labels.
- metric definitions and denominator fields.

### Cleaning judgment

- Do not de-duplicate event logs unless true duplicate events are identifiable.
- Keep timestamps in a consistent timezone; record conversions.
- Do not merge anonymous and known user IDs unless a mapping is supplied.
- Preserve bot/test/internal-user flags if present.

### Checks

- Missing event/user/timestamp.
- Future timestamps, impossible durations, negative counts.
- Duplicate primary events with identical IDs/timestamps.
- Mixed timezone formats.

### Formatting

- Timestamps: ISO-like display with timezone if relevant.
- Metrics: rates as percentages; counts as integers.

## HR / People

### Preserve

- employee ID, worker ID, manager, organization, level, location, effective dates, employment status.
- compensation currency/unit, FTE, requisition IDs.

### Cleaning judgment

- Treat employee IDs as text.
- Be careful with privacy-sensitive data; avoid unnecessary exposure in summaries.
- Do not merge people by name alone.
- Preserve effective-date history; do not collapse to latest record unless requested.

### Checks

- Missing employee ID, manager, org, location, status, or effective date where required.
- Termination date before start date.
- Multiple active managers for same effective period.
- Compensation amount without currency or frequency.

### Formatting

- Headcount/FTE: appropriate decimals.
- Compensation: currency plus frequency/unit.
- Use minimal necessary personal data in quality summaries.

## Procurement / Vendor / Budget

### Preserve

- vendor, contract ID, PO, invoice, renewal date, owner, department, approval status.
- amount, currency, tax, recurring vs one-time, term, payment frequency.

### Cleaning judgment

- Do not merge vendor names aggressively without a mapping.
- Separate committed, requested, forecast, and actual spend if present.
- Preserve renewals and term dates for operational review.

### Checks

- Missing vendor, owner, department, amount, currency, or renewal date.
- Duplicate invoice/PO numbers.
- Renewal date in past with active status.
- Amounts with mixed currencies or missing tax treatment.
- One-time and recurring spend mixed without a classification.

### Formatting

- Amounts: currency with zero or two decimals depending on invoice precision.
- Dates: `yyyy-mm-dd`; renewal summaries may use month buckets.
