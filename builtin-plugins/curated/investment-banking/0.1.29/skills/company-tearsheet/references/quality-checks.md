# Company Tearsheet Quality Checks

## Entity And Scope Checks

- Confirm the entity is the correct company, issuer, borrower, target, counterparty, or transaction-relevant business unit.
- For public companies, verify ticker/exchange and fiscal year-end.
- For private targets, confirm ownership/parent/sponsor where material.
- For borrowers or financing issuers, confirm issuer, parent/guarantor, security or facility context, and maturity basis where material.
- Confirm that `coverage_screen` is supported by a mandate signal; otherwise keep the report as `baseline_tearsheet`.

## Source Checks

- Every material metric has source, period, units, evidence posture, and confidence.
- Do not use stale market data without an as-of date and visible limitation.
- Do not cite marketing claims, seller claims, synergy claims, strategic appetite, or relationship assumptions as verified facts.
- Prefer user-provided or connected sources and primary documentation over public snippets.
- Flag unaudited, preliminary, pro forma, adjusted, management-defined, OCR-derived, stale, or conflicting numbers.

## Metric And Valuation Checks

- Revenue, EBITDA, cash flow, debt, leverage, margin, AUM where applicable, and valuation context have periods and units.
- Do not mix fiscal years, calendar years, LTM, quarterly, forecast, and YTD without labels.
- Do not mix currencies or units without clear conversion disclosure.
- Derived metrics show inputs or calculation basis in a nearby note.
- Do not put stale share-price-derived valuation, transaction value, market trading data, or financing capacity in a headline metric unless the requested task requires it and the limitation is immediately visible.
- Use `Valuation Context` or `Indicative Market Reference` rather than implying a recommendation, fairness conclusion, or client-ready case from partial inputs.
- If source financials are hard to read or inconsistent, route to `financials-normalizer` before finalizing.

## Scope And Banker-Use Checks

- A baseline tearsheet remains a source-backed profile and does not become a full memo, pitch, diligence report, valuation case, or recommendation.
- A coverage screen may include a preliminary banker angle and priority questions, but interpretation is labeled and mandate claims are not invented.
- When there is a priority-questions/action table, do not add a second repetitive open-diligence register unless separately requested.
- Keep business description, mandate relevance, financial context, risks/gaps, and next route distinct and easy to scan.
- Avoid unsupported adjectives such as "best-in-class", "dominant", "high-quality", "actionable", or "distressed" unless evidenced.

## HTML Presentation Checks

- For an HTML-selected tearsheet, follow `../../../references/html-artifact-standard.md` and create a polished standalone HTML report owned by this skill.
- Do not route an ordinary tearsheet through a fixed dashboard contract or render visible dashboard-navigation, generic reader-action, related-files, or support-artifact panels by default.
- Use plain banker-facing evidence terms rather than internal support labels in visible prose.
- Cite complete figures and phrases; do not fragment fiscal periods, dates, metric names, document labels, or transaction names into linked numeric tokens.
- Keep source notes readable and proportionate; support JSON, manifests, logs, and handoff payloads remain secondary unless requested.
- Render and visually inspect local HTML via local headless-browser screenshots before delivery, focusing on the opening view, key tables, hierarchy, density, clipping, whitespace, and citation noise.

## Conflict Checks

Flag if:

- multiple sources show different revenue, EBITDA, debt, ownership, AUM, leverage, valuation, or transaction terms;
- a provider value differs from a filing/source package;
- a CIM, management deck, lender presentation, or company release differs from audited statements, QoE, executed financing documents, or regulatory filings;
- a current source supersedes an older source in the package.

## Final QA Checklist

Before returning:

1. Entity, mode, use case, and audience are clear.
2. Source inventory exists or source limitations are disclosed.
3. As-of date and relevant freshness limitations are visible.
4. Headline metrics are decision-useful and source-supported.
5. Calculations, assumptions, stale inputs, conflicts, and missing evidence are identified.
6. Report scope remains appropriate for `baseline_tearsheet` or `coverage_screen`.
7. Downstream handoff or recommended next route is appropriate.
8. Source materials and user work are preserved.
9. Any HTML artifact has passed visual screenshot review.
