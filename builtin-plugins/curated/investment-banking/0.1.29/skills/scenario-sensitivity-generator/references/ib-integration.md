# Investment Banking Integration

## Ownership matrix

| Area | This skill owns | Adjacent skill owns |
|---|---|---|
| Source confidence | Uses source caveats, as-of dates, and labeled assumption provenance in scenarios | `financial-source-of-truth` owns hierarchy, stale-data checks, source conflicts, citations, and evidence labels |
| Financial input normalization | Uses normalized financials as scenario inputs | `financials-normalizer` owns extracted statement/KPI normalization and QA flags |
| Spreadsheet input cleanup | Uses cleaned model tables and driver blocks | `excel-data-cleaner` owns tab, header, unit, date, and table cleanup before analysis |
| Operating forecast mechanics | Applies transaction overlays to existing forecast outputs | `three-statement-model-builder` owns operating forecast construction and three-statement linkage |
| Valuation sensitivity | Builds valuation range, multiple, WACC, terminal growth, premium, and price sensitivities | `dcf-model-builder`, `comps-valuation` own underlying valuation models |
| LBO and returns sensitivity | Frames entry, leverage, exit, EBITDA, cash sweep, IRR, MOIC, and downside read-through | `lbo-model-build` owns the LBO model engine |
| Merger-model sensitivity | Frames premium, cash/stock mix, synergies, EPS, pro forma ownership, and leverage sensitivity | `merger-model-builder` owns accretion/dilution and purchase-accounting mechanics |
| Debt capacity and credit stress | Frames debt capacity, leverage, coverage, liquidity, and lender-case breakpoints | `private-credit-underwriting` owns lender underwriting and credit recommendation |
| Covenant headroom | Frames covenant sensitivity, first breach, cushion, and cure / amendment triggers | `covenant-package-analyzer` owns covenant definition extraction and document-specific mechanics |
| Financing terms | Frames rate, spread, OID, fees, tenor, proceeds, dilution, and market-window sensitivity | `capital-markets-issuance` owns ECM/DCM issuance advice and market read-through |
| Restructuring and recovery | Frames recovery, plan value, fulcrum, and waterfall sensitivities | `distressed-recovery-waterfall` owns claims, waterfall, and recovery mechanics |
| Workbook QA | Supplies overlay tables and sensitivity outputs for review | `model-audit-tieout` owns workbook-level audit, formula checks, source tie-outs, and issue logs |
| Final materials | Supplies transaction sensitivity exhibits and caveats | `pitch-deck-builder`, `memo-builder`, and `ib-deck-qc` own final presentation and circulation readiness |

## Boundary with model builders

This skill may add transaction case overlays, sensitivity tables, target backsolve tables, breakpoints, trigger metrics, action registers, and banker narrative to an existing model. It should not rebuild the underlying model unless the user explicitly asks and no better model-builder skill is available.

Use the relevant model builder when:
- no underlying model exists;
- the model does not tie;
- the model lacks the required valuation, debt, covenant, merger, LBO, financing, or recovery mechanics;
- scenario inputs do not flow through formulas;
- the user asks to build or rebuild the model itself.

This skill should hand model builders a transaction overlay table, not a separate shadow model.

## Local routing aliases

Use these local Investment Banking v2 IDs in handoffs:

| Need | Local skill |
|---|---|
| Source hierarchy and stale-data rules | `financial-source-of-truth` |
| Financial statement normalization | `financials-normalizer` |
| Workbook/table cleanup | `excel-data-cleaner` |
| Operating forecast model | `three-statement-model-builder` |
| DCF model | `dcf-model-builder` |
| Markdown comps read-through | `comps-valuation` |
| Excel comps workbook | `comps-valuation` |
| LBO and sponsor returns | `lbo-model-build` |
| Merger model | `merger-model-builder` |
| Covenant package | `covenant-package-analyzer` |
| Credit case | `private-credit-underwriting` |
| ECM/DCM issuance advice | `capital-markets-issuance` |
| Distressed recovery waterfall | `distressed-recovery-waterfall` |
| Model QA | `model-audit-tieout` |
| Investment banking deck QC | `ib-deck-qc` |
