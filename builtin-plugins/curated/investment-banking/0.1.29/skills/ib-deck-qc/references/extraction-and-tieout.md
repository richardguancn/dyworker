# Extraction and Tie-out Guidance

## First-pass extraction

Use [`scripts/inspect_deck_report.py`](../scripts/inspect_deck_report.py) for first-pass extraction from PPTX, DOCX, XLSX, CSV, TXT, and markdown files. The script creates:
- `segments.csv`: extracted text by slide/page/section/sheet/line range
- `numbers.csv`: detected numerical mentions with rough metric keys and units
- `issues.csv`: heuristic issues requiring review
- `qc_report.html`: first-pass scan summary
- `scan.json`: structured output for follow-up analysis

The script is intentionally conservative. Treat its findings as leads, not final conclusions.

## Visual review requirement

Always inspect the original deliverable when available. Deterministic text extraction can miss:
- numbers embedded in images or screenshots
- chart labels rendered graphically
- cut-off text, overlap, font issues, and alignment problems
- small footnotes and low-contrast text
- PDF-only rendering issues
- data tables converted to images

For PDF, scanned, or image-heavy materials, render pages and visually inspect the relevant pages. For PPTX, use presentation rendering where available to verify layout and chart appearance.

For a standalone HTML QC report, retain compact visual evidence when it materially accelerates remediation of a confirmed critical/high defect: use precise page references by default and add a small excerpt or thumbnail only when the visual context itself proves the issue. Avoid turning the report into a duplicate of the source deck.

## Tie-out hierarchy

Tie out deck/report values in this order:
1. controlling model or source workbook for output values
2. primary filings, audited financials, transcript, release, credit agreement, VDR document, rent roll, loan tape, or management reporting package
3. trusted data provider, consensus source, broker research, rating agency, or market-data export
4. seller, management, or banker-provided materials, clearly labeled
5. internal estimate or analyst assumption, clearly labeled

If sources conflict, use `financial-source-of-truth` conflict handling. Do not silently average or choose the value that looks best.

## Repeated metric matching

A repeated metric should match when the following are the same:
- entity or asset
- metric definition
- period or as-of date
- currency and scale
- scenario
- source/model version

Do not flag as a confirmed mismatch when period, definition, or scenario differs. Instead flag `needs_review` and state the likely reason.

Examples:
- `FY25E EBITDA $120m` vs `2025E EBITDA $120m`: likely same metric
- `Adjusted EBITDA $120m` vs `Lender EBITDA $135m`: not necessarily a mismatch; check definitions
- `Net leverage 4.2x` vs `First-lien net leverage 3.1x`: not necessarily a mismatch
- `10 bps` vs `0.10%`: same magnitude but different unit expression
- `margin up 100 bps` vs `margin up 1.0%`: label as percentage-point convention issue, not necessarily numerical error

## Chart review workflow

For each chart:
1. Record chart title, period, units, series names, and source.
2. Compare the visual direction to the title and takeaway bullet.
3. Compare key labeled values to any table/model/source.
4. Check whether the axis baseline or scaling could mislead.
5. Confirm source/date and whether chart is based on actuals, estimates, management case, seller case, or internal model.
6. Flag ambiguity if chart data is image-only and cannot be extracted.

## Source footnote coverage test

For each page/section, classify source coverage:
- `complete`: source, period/as-of date, and caveats are present
- `partial`: source is present but period/as-of/caveat is incomplete
- `missing`: no meaningful source for material data
- `not_applicable`: conceptual page with no material facts or numbers

Do not require sources for pure table-of-contents, process, or placeholder pages unless they contain factual or numerical claims.
