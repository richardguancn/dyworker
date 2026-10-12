# Investment Banking Integrations

## Table Of Contents

- [Ownership Boundaries](#ownership-boundaries)
- [Downstream Handoff Contract](#downstream-handoff-contract)
- [Peer-Set Handoff](#peer-set-handoff)
- [Valuation Handoff](#valuation-handoff)
- [QA Handoff](#qa-handoff)
- [Handoff Uses](#handoff-uses)
- [Workbook Routing](#workbook-routing)

## Ownership Boundaries

This skill owns public trading comps reports, peer-set framing, valuation multiple read-throughs, and implied valuation ranges.

Adjacent skill ownership:

| Area | This skill owns | Adjacent skill owns |
|---|---|---|
| Source hierarchy | Use labels and caveats | `financial-source-of-truth` owns source priority, stale-data rules, conflicts, and citation format |
| Messy exports | Identify unusable data and route | `excel-data-cleaner` owns table cleanup and normalization |
| Full workbook | Select workbook mode and provide requirements | `comps-valuation` in `workbook` mode owns Excel/Sheets comps models |
| Workbook audit | Flag issues in memo | `model-audit-tieout` owns formula, link, and model QA |
| Final investment-banking materials | Provide comps support | `ib-deck-qc` owns banker/client/committee circulation checks |
| DCF cross-check | Provide market multiple range | `dcf-model-builder` owns DCF mechanics |
| Sponsor returns | Provide exit multiple support | `lbo-model-build` owns LBO and sponsor returns |
| Credit analysis | Provide valuation cushion context | `private-credit-underwriting` owns lender case and credit memo |
| IC synthesis | Provide valuation support | `memo-builder` owns full memo narrative and recommendation |

## Downstream Handoff Contract

When comps support another Investment Banking skill, expose these fields clearly.

## Peer-Set Handoff

- target / subject;
- selected peer set;
- peer role labels;
- excluded close peers;
- business-model rationale;
- geography / size / growth / margin / leverage caveats.

## Valuation Handoff

- as-of date;
- selected multiples;
- statistic used: median, p25, p75, trimmed mean, or selected range;
- denominator used for target;
- implied EV;
- net debt and other claims;
- implied equity value;
- implied value per share, if applicable;
- source limitations.

## QA Handoff

- missing fields;
- stale fields;
- source conflicts;
- adjustment basis;
- currency / FX issues;
- outlier treatment;
- confidence level;
- output posture label.

## Handoff Uses

Use the handoff for:

- `dcf-model-builder` as a market cross-check;
- `lbo-model-build` as exit-multiple support;
- `private-credit-underwriting` as valuation cushion and refinancing context;
- `memo-builder` as valuation support;
- `ib-deck-qc` as the tie-out source for final investment-banking materials.

## Workbook Routing

If the user asks for Excel, Google Sheets, refreshable data, formula-driven EV bridge, source tabs, peer-universe management, sensitivity tables, or a file deliverable, use `comps-valuation` in `workbook` mode.

If a file is created only as a lightweight export from this skill, include source notes, caveats, and manual/non-formula values visibly.
