# Workflow And QA

## Table Of Contents

- [Request Types](#request-types)
- [Minimum Information](#minimum-information)
- [Use Available Context Before Asking](#use-available-context-before-asking)
- [Detailed Workflow](#detailed-workflow)
- [QA Checklist](#qa-checklist)
- [Rendering Rules](#rendering-rules)

## Request Types

Classify the request before responding:

1. `new-comps-build`: create a fresh peer set and valuation view.
2. `refresh-existing-comps`: update an existing peer set or table with newer market data or estimates.
3. `peer-set-review`: focus on which companies belong, which do not, and why.
4. `implied-valuation`: use peer multiples to estimate a target's value.
5. `qa-review`: review an existing comps analysis for logic errors, missing caveats, bad definitions, stale sources, or weak peer logic.

Also identify the decision being supported: peer selection, premium/discount explanation, growth or efficiency screen, implied valuation, or QA review.

## Minimum Information

Proceed when the user provides at least one of:

- company, target, baseline company, or ticker;
- sector, subindustry, business description, geography, asset class, or use case detailed enough to infer peers.

If the user provides a sector, subindustry, business description, geography, asset class, or use case detailed enough to infer peers, proceed with description-led peer selection and label the peer set as inferred.

Ask only if the prompt lacks both:

1. a named company, target, baseline company, or ticker; and
2. enough description to infer a defensible peer universe.

For a real comps build, try to collect or infer:

- pricing and market-data as-of date;
- basic and diluted share basis;
- cash, debt, minority interest, preferred equity, leases, and other EV bridge items where relevant;
- LTM revenue, EBITDA, EBIT, net income, EPS, FFO/AFFO, TBV, book value, or other relevant denominators;
- NTM estimates and estimate-as-of date when forward multiples are requested;
- trading currency, reporting currency, and FX convention when currencies differ;
- source, adjustment basis, and period end for every material numerator and denominator.

If these are incomplete, do not stall. Use `N/A`, add open items, and downgrade confidence when missing fields affect the requested multiple.

## Use Available Context Before Asking

Do not ask for more information if the analysis can be produced from:

- the user's prompt;
- attached files;
- pasted data;
- connected financial-data sources or workspace apps;
- public filings, company IR, exchange data, or web/search results;
- previously generated outputs from adjacent Investment Banking skills.

First determine whether the user has enough context to produce one of:

- a full HTML comps report;
- a preliminary comps screen;
- a peer-set review;
- an implied valuation with caveats;
- a QA review of an existing comps table.

Ask a follow-up only when:

- no target, peer universe, sector, asset class, or business description is available;
- the user requests precise current valuation but no current pricing or market-data source is available;
- the peer universe cannot be inferred without making the output misleading;
- a missing source changes the conclusion rather than merely lowering confidence;
- the user asks for a full workbook, in which case use `comps-valuation` in `workbook` mode.

When asking, request the exact missing item, not a generic data dump.

## Detailed Workflow

1. Use available context before asking for more.
2. Classify the request type and decision supported.
3. Choose the module and asset-class lens.
4. Build or review the peer set with peer role labels.
5. Normalize available data into stable entities, market data, capital structure, financials, estimates, dilution, FX, and adjustment fields.
6. Build in logical blocks and validate each block before moving on: peer list, pricing and share count, EV bridge, operating denominators, trading multiples, stats/outliers, implied valuation.
7. Check source quality, period, currency, unit scale, scope, and adjustment basis before using a value downstream.
8. If there is a target, derive implied valuation only after the multiple set and stats are validated.
9. Apply selected multiple range discipline and explain premium/discount logic.
10. Run QA, assign an output posture label, and surface caveats.
11. Render the extended HTML comps report as a polished standalone report following `../../../references/html-artifact-standard.md` by default for substantial `report` mode analysis; use a lightweight support table or concise chat answer only when explicitly requested or when the task is pure triage. Use `workbook` mode when exportability, formulas, refreshability, or model work is the main need.

## QA Checklist

Always check:

- as-of dates match the intended pricing date;
- market data, financial statements, estimates, and FX dates are disclosed and not silently mismatched;
- price times diluted shares ties to equity value;
- EV bridge additions and subtractions have the correct sign;
- EV is lower than equity value for net cash companies unless other claims explain the difference;
- denominator periods and estimate vintages are labeled;
- EV numerators pair with enterprise-scope denominators, and equity numerators pair with equity-scope denominators;
- FX rates exist where required;
- `N/M` and `N/A` are used instead of fabricated numbers;
- no sector leakage exists in the peer set;
- no accidental duplicate listings exist;
- excluded close peers are named with exact blockers;
- outliers are interpreted before excluding or correcting them;
- selected range is not a blind min/max.
- target current trading is labeled as a baseline or reference point rather than external peer evidence;
- a range supported by only one true external comparable is identified as judgmental, screening-oriented, or single-anchor-supported;
- an interpolated midpoint between a target baseline and one external anchor is labeled `Illustrative Midpoint`, not presented as an observed market data point;
- headline baseline-to-anchor uplift is labeled `Public Comps Uplift` or `Uplift To External Anchor`, not confused with a strategic/control premium range;
- control-premium scenarios are separated from observed public trading support unless transaction evidence supports the conclusion;
- accounting, lease, FX, period-basis, denominator, and share-basis mismatches are disclosed before affected multiples drive valuation.
- decision-critical public URLs for prices, filings, and selected-anchor support have been opened or otherwise verified; unresolved source-link failures are surfaced and affect the output posture.

## Rendering Rules

- Default to `extended_analysis` unless the user explicitly requests a short peer check, the task is pure triage, or the response is only a cover note for a richer artifact.
- Use clear section headings and readable tables that can render cleanly in the standalone HTML report.
- Put the answer before methodology.
- Build the core comps table before extended commentary.
- If output space is tight, compress caveats and methodology before dropping close peers, key denominator fields, or premium/discount read-through.
- Use quote blocks only for short sourced excerpts that sharpen the analysis.
- When citing web or tool sources, cite the most load-bearing facts such as pricing date, filing date, denominator source, estimate source, and management quote.
- Keep compact citations visible in the opening valuation conclusion and headline metrics for the pricing date, baseline, anchor, and derived implied range without repeating markers across every token.
- When the subject is a public ticker and a chart would help, render an interactive chart only if the environment supports it; do not fake charts with ASCII art.
- Keep calculation schedules, evidence ledgers, manifests, and other support mechanics out of the visible first-read report unless explicitly requested.
- Do not add generic dashboard navigation, reader-action bars, repeated export controls, render contracts, or source-popover machinery by default.
- Render and visually inspect the opening viewport and key valuation/comparability sections using local headless-browser screenshots before delivery.
