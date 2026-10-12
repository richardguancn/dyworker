# Cleaning Standards

Use this reference when cleaning decisions require professional judgment beyond simple formatting.

## Table Of Contents

- Priority Order
- Analyst-Grade Cleaning Principles
- Structural Cleanup
- Header and Column Naming
- Type Conversion Rules
- Missing Data Policy
- Duplicate Policy
- Category and Entity Standardization
- Outliers and Exceptions
- Formula and Linked Workbook Handling
- Final QA Checklist

## Priority Order

1. User-provided rules, definitions, mappings, and output format.
2. Source-system semantics visible in the data, formulas, sheet names, notes, or existing labels.
3. Domain-specific conventions from `domain-playbook.md`.
4. Conservative general cleaning defaults.

When these conflict, preserve the source value and record the conflict in `assumptions_audit` unless the user explicitly instructs otherwise.

## Analyst-Grade Cleaning Principles

- Preserve raw data and make every material transformation traceable.
- Prefer reversible transformations: trim whitespace, standardize casing, parse obvious numbers/dates, and rename headers with mappings.
- Avoid irreversible transformations without a clear rule: fuzzy merging entities, imputing missing data, deleting outliers, changing signs, collapsing categories, converting currencies, or aggregating detail rows.
- Treat identifiers as text even when they look numeric. Leading zeros matter.
- Treat dates as high-risk when formats are mixed, locale-specific, or fiscal-period-like.
- Treat percentages and basis points carefully. `5%`, `5`, `0.05`, and `500 bps` are not interchangeable without context.
- Keep units explicit. If multiple units or currencies appear, add or preserve a unit/currency column instead of applying one universal format.

## Structural Cleanup

### Header detection

A header row is usually the first row with mostly non-empty text-like values followed by one or more rows of detail data. Beware of title rows, report metadata, footnotes, and multi-row headers.

For multi-row headers:

- Combine levels only when they form meaningful labels, such as `actual | q1 2026`.
- Forward-fill parent labels across blank merged-cell areas only when the source layout clearly implies grouping.
- Preserve the original header path in the data dictionary.

### Blank and decorative rows

Remove fully empty rows/columns from the cleaned table, but preserve them in `raw_source`. Do not remove partially blank rows unless they are clearly formatting spacers or subtotal/section rows.

### Totals, subtotals, and section rows

Detail datasets should not include report subtotal rows unless the user wants a presentation table. Detect labels such as `total`, `subtotal`, `grand total`, `all`, or blank categories with populated amount columns. Flag these rows and remove from `clean_data` only when obvious.

### Merged cells and grouped labels

When a source report uses merged cells for categories, fill down the category only if it is clearly a group label and necessary to make detail rows analysis-ready. Log the fill-down rule.

## Header and Column Naming

Use clear, stable names that work in Excel tables, formulas, pivots, and imports.

- Remove leading/trailing spaces and line breaks.
- Replace repeated whitespace with one space.
- Expand cryptic labels only when context is obvious (`rev` -> `revenue`, `qty` -> `quantity`).
- Keep domain abbreviations that are standard: ARR, MRR, EBITDA, COGS, CAC, SKU, SLA, API, ID.
- Ensure uniqueness. If duplicate labels exist, disambiguate with context from parent headers or nearby labels, not arbitrary suffixes where possible.
- Preserve original-to-clean mapping in the data dictionary.

Recommended cleaned header forms:

- Excel display: `Customer ID`, `Invoice Date`, `Net Revenue`, `ARR`, `Close Date`.
- Machine/export form when requested: `customer_id`, `invoice_date`, `net_revenue`, `arr`, `close_date`.

## Type Conversion Rules

### Text

Normalize text by trimming, removing non-printing characters, replacing repeated whitespace, and converting common blank tokens to null:

`""`, `-`, `--`, `n/a`, `na`, `null`, `none`, `not available`, `#n/a`.

Do not convert IDs, postal codes, account codes, SKU codes, CUSIPs, ISINs, employee IDs, or phone-like fields to numbers.

### Numbers

Parse numbers with commas, parentheses for negatives, leading/trailing spaces, currency symbols, and accounting formats. Preserve the original text when parsing confidence is low.

Examples:

- `(1,234.50)` -> `-1234.50`
- `$1.2m` -> parse only if the script or analyst logic explicitly supports magnitude suffixes; otherwise flag.
- `1,234` -> numeric if the column is mostly numeric.

### Percentages and basis points

- `12%` should become numeric `0.12` with percent formatting.
- `12 bps` should not become `0.12`; it means `0.0012` as a decimal return/rate.
- If a column mixes `0.12`, `12%`, and `12`, flag it for review unless context makes the convention obvious.

### Dates and periods

Use real dates for actual dates. For fiscal periods or month buckets, preserve the period label if day precision is not real.

- `2026-04-17` -> date.
- `Apr-26` or `2026-04` -> period/month, not necessarily a day.
- `Q1 FY26` -> fiscal period label unless fiscal calendar is known.
- Ambiguous `03/04/2026` -> parse only when locale/context is clear; otherwise flag.

### Booleans and statuses

Normalize common booleans only when the field is genuinely boolean:

- yes/no, y/n, true/false, 1/0.

For workflow statuses, standardize labels but preserve business meaning:

- `in progress`, `in-progress`, `wip` -> `In Progress`.
- `done`, `complete`, `completed` -> `Complete`.

Do not collapse statuses with different meanings, such as `cancelled`, `lost`, `churned`, and `inactive`.

## Missing Data Policy

Classify missingness:

- **Critical:** primary key, date, amount, owner, status, or domain-required field missing.
- **Analytical:** optional dimension missing but row is usable.
- **Cosmetic:** display fields or notes missing.

Do not impute missing values unless the user asks or there is a deterministic source, such as a lookup table or clearly repeated group label. Use flags like `missing_required_field` or entries in `quality_checks`.

## Duplicate Policy

Use the least destructive valid policy.

1. Remove exact duplicate rows when all values match and no source row identity needs preservation.
2. For likely duplicates with the same key but conflicting values, keep all rows and flag.
3. Merge duplicates only when the user supplies a rule or the business rule is unambiguous.

Common keys:

- transaction/invoice: invoice ID + vendor/customer + date + amount.
- sales: opportunity ID or account ID + opportunity ID.
- HR: employee ID + effective date.
- finance: entity + account + period + scenario + currency.
- investing: portfolio/account + security ID/ticker + date + metric.

## Category and Entity Standardization

Standardize only when mappings are obvious or supplied:

- casing and whitespace: safe.
- punctuation variants: usually safe.
- abbreviations: safe only when domain-standard or user-supplied.
- fuzzy matches: flag for review unless confidence is very high and consequences are low.

Maintain a mapping table for any category/entity cleanup:

`source_value`, `clean_value`, `basis`, `confidence`, `affected_rows`.

## Outliers and Exceptions

Outliers are often the point of the analysis. Do not delete them by default.

Flag values that are unusual relative to the column or domain:

- negative revenue, negative quantity, future dates, close dates before create dates, extreme margins, duplicate IDs, invalid country/state codes, cancelled items with active status, amount without currency, etc.

Include severity and recommended action.

## Formula and Linked Workbook Handling

When cleaning workbooks with formulas:

- Preserve formulas unless the user asks to convert to values.
- Do not break workbook references, named ranges, pivots, or charts without warning.
- If extracting a clean dataset from a formula-driven report, note whether values were copied as displayed values or formulas were preserved.

## Final QA Checklist

Before delivering cleaned data:

- Raw source preserved.
- Clean table has one row per intended grain.
- Headers are unique and meaningful.
- Dates, numbers, percentages, and currencies are correctly typed/formatted.
- IDs are preserved as text where needed.
- Duplicate handling is documented.
- Quality checks include issue counts and affected fields/rows.
- Audit sheet explains assumptions and transformations.
- Workbook opens cleanly and sheets are formatted for professional review.
