# Output Templates

## Table Of Contents

- [Standard Comps Memo](#standard-comps-memo)
- [Standalone HTML Valuation Report](#standalone-html-valuation-report)
- [Core Comps Table](#core-comps-table)
- [Target Valuation Add-On](#target-valuation-add-on)
- [QA Review](#qa-review)
- [Data Request Table](#data-request-table)
- [Comps Output Posture](#comps-output-posture)
- [Handoff Summary](#handoff-summary)

## Standard Comps Memo

Use these sections in order:

1. `Executive Summary`
2. `Peer Set And Rationale`
3. `Core Comps Table`
4. `Stats And Outliers`
5. `Valuation Read-Through`
6. `QA Flags And Caveats`
7. `Open Items / Data Requests`
8. `Comps Output Posture`

The report must stand alone as the reader-facing HTML deliverable for substantial analysis. Use chat as the primary output only for narrow peer checks, quick follow-ups, or explicit chat-only requests.

## Standalone HTML Valuation Report

Use when `report` mode produces the banker-facing artifact. Follow `../../../references/html-artifact-standard.md`; produce a polished standalone valuation report owned directly by `comps-valuation`, not a dashboard-builder package.

Recommended first-read structure:

1. `Valuation Conclusion And Posture`: selected framework, as-of date, implied range, premium or discount, and readiness label.
2. `Selected Peer Framework`: distinguish `Target Trading Baseline`, `Primary External Anchors`, `Context Peers`, and `Excluded / Outlier Peers`.
3. `Implied Valuation Range`: a compact multiple-to-enterprise-value-to-equity-value bridge with denominator and share-basis caveats.
4. `Premium / Discount Discussion`: separate public trading read-through from strategic or control premium scenarios.
5. `Comparability And Normalization`: accounting, leases, estimates, FX, period basis, dilution, and data-quality issues.
6. `Diligence Before Client Use`: specific missing validation, precedents, buyer evidence, or model inputs.
7. `Sources And Calculation Basis`: readable source register and derived-calculation label.

If the target's own multiple establishes the low end, present it as the trading baseline rather than a peer observation. If the selected valuation range relies on only one true external anchor, label it as a judgmental or screening range rather than a statistically supported market range.

For headline labels, use `Illustrative Midpoint` when the middle case is interpolation between a target baseline and one external anchor. Use `Public Comps Uplift` or `Uplift To External Anchor` for the uplift inside that public trading corridor; do not label it `Premium Range`, which is reserved for a separately labeled strategic/control-premium overlay.

In the opening conclusion and headline metric strip, cite the pricing date, target baseline, external anchor, and implied range compactly at the point of use. Prefer one citation after a complete figure or supported statement over repeated source markers that interrupt reading.

Keep backing calculations and evidence ledgers as support artifacts. Do not add dashboard navigation, reader-action bars, repeated table export controls, render-contract metadata, source-popover machinery, or generic related-file panels by default.

## Core Comps Table

Default corporate table:

| Company | Ticker | Peer role | Market data as-of | EV | LTM revenue | LTM EBITDA | NTM revenue | NTM EBITDA | EV/LTM rev | EV/NTM rev | EV/LTM EBITDA | EV/NTM EBITDA | Notes |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|

Use fewer fields for narrower tasks and add module-specific columns for banks, insurers, REITs, asset managers, exchanges, distressed companies, or private-company targets.

For public-company comps, this table is the main artifact. Build it before extended commentary.

In a target valuation report, display the target in a visually distinct baseline row or table rather than counting it among external peer observations.

## Target Valuation Add-On

Add these sections when a target is present:

1. `Selected Multiple Set`
2. `Implied Enterprise Value`
3. `Bridge To Equity Value`
4. `Implied Value Per Share`, if applicable

Suggested table:

| Metric | Low | Mid | High | Basis / caveat |
|---|---:|---:|---:|---|
| Selected multiple |  |  |  |  |
| Target denominator |  |  |  |  |
| Implied EV |  |  |  |  |
| Net debt / other claims |  |  |  |  |
| Implied equity value |  |  |  |  |
| Diluted shares |  |  |  |  |
| Implied value per share |  |  |  |  |

## QA Review

For `qa-review`, return:

1. critical findings first, ordered by severity;
2. broken definitions or inconsistent numerators and denominators;
3. weak peer logic or cherry-picking concerns;
4. missing caveats, stale data, unsupported adjustments, or source conflicts;
5. a verdict: `usable`, `usable with conditions`, or `not reliable`.

## Data Request Table

When more data would materially improve the answer, use:

| Priority | Needed item | Why it matters | Affected output | Minimum acceptable substitute |
|---|---|---|---|---|

Ask for exact missing fields, not a generic data dump.

## Comps Output Posture

Use one posture label:

- `decision-useful`: peer set, market data, denominators, and EV bridges are current enough and caveated appropriately.
- `usable-with-caveats`: output is directionally useful but has missing fields, stale data, or peer-set limitations.
- `screening-only`: useful for early discussion, not enough support for a decision range.
- `not-reliable`: source conflicts, missing primary data, stale market data, or denominator problems make the output unsafe to rely on.

## Handoff Summary

When another Investment Banking skill will consume the output, include a compact handoff:

| Field | Value / caveat |
|---|---|
| Target / subject |  |
| Peer set used |  |
| Selected multiples |  |
| Statistic or selected range |  |
| Target denominator |  |
| Implied EV / equity value |  |
| As-of date |  |
| Key caveats |  |
| Output posture |  |
