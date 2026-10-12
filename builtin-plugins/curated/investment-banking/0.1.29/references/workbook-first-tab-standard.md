# Workbook First-Tab Standard

Investment Banking workbook deliverables should open on a banker-readable insight tab, not a README-only control sheet. The first visible worksheet must be named `Cover`, `Executive Summary`, or `Dashboard` unless the user provides a template that must be preserved.

## Required First-Tab Content

The first visible tab should answer the deal team's first question: what does the model say, how reliable is it, and what should happen next?

Include these elements:

1. Transaction, company, issuer, borrower, or deal name.
2. As-of date, model version, currency, units, and prepared date.
3. Decision question or mandate.
4. Recommendation, readiness, or status label.
5. Key valuation, return, credit, operating, or process metrics.
6. Top sensitivities or breakpoints.
7. Source and caveat status, including whether filing, lender-term, management, seller, market, or model inputs are preliminary.
8. Key risks and open diligence items.
9. Next steps and owner-friendly action list.
10. Model map showing the most important tabs and how to read them.

Keep README-style instructions, manifest explanations, automation notes, and run-log detail off the first visible tab. Those belong in `Control`, `Sources`, `QA_Log`, `Model Map`, `Read Me`, `Run Log`, or support artifacts.

## Domain-Specific Dashboard Requirements

### LBO

Show purchase price, entry and exit multiple, IRR, MOIC, sponsor equity, debt quantum, opening leverage, deleveraging, minimum cash, liquidity, covenant flags, reverse-stress breakpoint, and a compact sensitivity table.

### DCF

Show valuation range, implied share price or enterprise value, WACC, terminal growth or exit multiple, revenue, EBITDA, unlevered FCF, terminal value mix, sensitivity outputs, source confidence, and open model checks.

### Comps

Show peer set, relevant multiples, selected median/range, excluded names and why, distorted denominators, valuation implication, source freshness, and sensitivity or selected-range read-through.

### Merger

Show accretion/dilution, pro forma ownership, purchase price, financing mix, synergies, leverage, EPS bridge, breakpoints, dilution/accretion sensitivities, and required approvals or diligence gaps.

### Credit / Restructuring

Show liquidity, maturity wall, leverage, interest coverage, covenant headroom, debt capacity, recovery, fulcrum security, collateral/lien issues, path risk, and first loss or first breach trigger.

## Citation And HTML Handoff

When workbook outputs feed an HTML report or dashboard, cite the workbook-derived claim back to the exact workbook cell or range when known. Use `model_citations` or `model_citations_path` in the dashboard render contract. If a cell/range is not available, cite the source ID and label the model output as a model-derived estimate rather than using a generic uncited claim.

## Response Order

When returning a workbook package, point to the workbook first, companion HTML/deck/report second, support files third, and blocked/partial status last.
