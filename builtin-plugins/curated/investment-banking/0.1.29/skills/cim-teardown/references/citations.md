# Evidence Pointers (CIM + Web)

## Table of contents
1. Purpose
2. What counts as a valid evidence pointer
3. CIM pointer format
4. Web pointer format
5. How to cite different CIM objects
6. Confidence scoring for pointer quality
7. Common failure modes and what to do instead

---

## 1) Purpose
CIM teardowns fail when they "sound right" but cannot be traced back to a source. This skill requires **audit-grade evidence pointers** so every material fact can be verified.

**Rule 1:** Do not invent pages, exhibits, URLs, titles, or spans.

**Rule 2:** If you cannot pinpoint a location, write `CITATION_TBD` and add an evidence request to resolve.

**Rule 3:** Primary exports and systems-of-record beat web research.

---

## 2) What counts as a valid evidence pointer
A valid pointer includes enough information for a human to find it again:
- source type
- CIM file name (or doc ID)
- locator fields
- object reference
- span or row reference
- enough detail for another analyst to resolve it quickly

Allowed pointer strings:
- `CIM <file> | p.<page> | <section_path> | <exhibit_id> | <object> | <span>`
- `WEB | <source_name> | <url> | <title> | <date_accessed> | <span/lines>`
- `CITATION_TBD`

Compatibility note:
- exported CSVs may still use the field name `CIM Citation`; store the full pointer string there even if it is a `WEB | ...` citation.

---

## 3) CIM pointer format

Use:
`CIM <file> | p.<page> | <section_path> | <exhibit_id> | <object> | <span>`

Examples:
- `CIM cim_v3.pdf | p.18 | 3.2 Customers | Ex.7 Retention | Chart 7B | lines 4-7`
- `CIM teaser.pdf | p.3 | Highlights | (no exhibit) | Callout box | chars 120-240`

Rules:
- include the file name or version when multiple drafts exist
- if a metric is defined in one place and shown in another, cite both
- for charts, read the footnotes before accepting the headline
- if a table is image-based, cite the table title and visible totals, then request the export

---

## 4) Web pointer format

Use:
`WEB | <source_name> | <url> | <title> | <date_accessed> | <span/lines>`

Examples:
- `WEB | Texas DOT | https://... | 2024 AADT Map | 2026-03-11 | station 12345 row`
- `WEB | County Assessor | https://... | Parcel Details - APN 123-45 | 2026-03-11 | assessed value section`

Web research rules:
- prefer authoritative domains: government, regulators, county/municipal records, SEC/filings, courts, official operator sites, utility providers, DOT sources
- secondary aggregators are lower confidence and should be corroborated when material
- never let web research override system-of-record exports
- any external fact used in underwriting must carry a `WEB | ...` pointer
- avoid random directories or listicles unless corroborated and clearly marked low confidence

Use web research mainly for:
- trade area basics
- traffic counts
- competition mapping
- property records
- permits and zoning basics
- environmental enforcement and other regulatory checks

---

## 5) How to cite different CIM objects

### 5.1 Text claims
Cite:
- page
- section heading (or slide title)
- line range

Example:
- Claim: "Revenue grew 55% YoY in FY2025"
- Citation: `CIM cim.pdf | p.12 | 2.3 Investment Highlights | (no exhibit) | bullet list | lines 1-2`

### 5.2 Chart claims
Charts often hide qualifiers in footnotes.
Cite:
- chart title + subtitle
- axis labels
- legend
- any data label used
- footnote line(s)

Example:
- `CIM cim.pdf | p.24 | 4.1 Financials | Ex.10 Revenue Bridge | Chart title + footnote | lines 1-8`

### 5.3 Table claims
Tables are often images in PDFs. If table extraction is uncertain:
- cite table title and visible totals
- request the underlying Excel export as evidence

Example:
- `CIM cim.pdf | p.31 | 4.3 Unit Economics | Table 4C | header + totals | visible cells only`

### 5.4 Footnotes and "definitions" slides
Treat footnotes and definition slides as first-class sources.
If a metric is defined in one place and used elsewhere, cite both:
- the metric definition location
- the metric value location

Example:
- Value citation: `CIM cim.pdf | p.18 | 3.2 Customers | Ex.7 | KPI callout | lines 1-2`
- Definition citation: `CIM cim.pdf | p.44 | Appendix | Metric definitions | NRR definition | lines 10-16`

---

## 6) Confidence scoring for pointer quality

- 5: exact page or URL + section/title + object + line/span reference
- 4: exact page or URL + section/title + object
- 3: page or URL + section/title only
- 2: page only or domain only
- 1: citation unknown (`CITATION_TBD`)

---

## 7) Common failure modes

### Failure: "I think it was on p.18"
Fix: do not guess. Use `CITATION_TBD`, then request:
- the latest CIM PDF
- the exhibit referenced
- or a page screenshot

### Failure: Chart numbers not extractable
Fix:
- cite chart title + visible labels
- request the underlying Excel and rebuild the chart from data

### Failure: Multiple CIM versions
Fix:
- include CIM filename/version in the pointer
- treat changes as a new version; do not reuse old citations

### Failure: Web fact from a weak source
Fix:
- downgrade confidence
- seek corroboration from a primary source
- if material to underwriting, do not rely on it alone

