# Peer Selection

## Table Of Contents

- [What A Good Peer Set Means](#what-a-good-peer-set-means)
- [Build Peers In This Order](#build-peers-in-this-order)
- [Peer Role Labels](#peer-role-labels)
- [Inclusion And Exclusion Rules](#inclusion-and-exclusion-rules)
- [Peer-Set Review Output](#peer-set-review-output)
- [Common Peer-Set Failure Modes](#common-peer-set-failure-modes)

## What A Good Peer Set Means

A good peer set is:

- explainable in 30 seconds;
- economically comparable rather than cosmetically similar;
- liquid enough that market-implied multiples are meaningful;
- not cherry-picked to force a valuation answer.

The peer set should reflect the way the market prices the business: business model, end-market exposure, recurring revenue, asset intensity, growth, margin structure, leverage, cyclicality, regulation, size, geography, and listing/liquidity.

## Build Peers In This Order

1. Start with the narrowest useful taxonomy: sector, industry group, industry, then subindustry.
2. Add geography and listing filters that reflect how the market prices the business.
3. Add business-model tags that actually drive multiples, such as subscription, marketplace, regulated, hardware, services, asset-heavy, transaction-driven, or recurring-revenue.
4. Check size, growth, margin, leverage, cyclicality, liquidity, customer mix, and accounting basis.
5. Keep 6-12 peers when possible, but prefer a clean narrow set over a broad noisy one.
6. Allow manual overrides only with a short rationale.

If only a description is available, proceed with description-led peer selection and label the peer set as inferred.

## Peer Role Labels

Assign each material peer one role:

| Role | Meaning | Treatment |
|---|---|---|
| `core_peer` | Closest economic comp | Should influence selected range |
| `secondary_peer` | Relevant but less direct due to geography, size, mix, maturity, accounting, or liquidity | Use as context unless core set is too small |
| `aspirational_peer` | Useful business-model read-through, weaker anchor | Do not let it drive valuation without explanation |
| `negative_peer` | Shown to explain why it should not anchor valuation | Include in rationale, usually exclude from selected range |
| `excluded_close_peer` | Economically relevant but missing a required primary field | Name the exact blocker |
| `not_clean_comp` | Conglomerate, segment-mix, distressed, illiquid, or accounting mismatch | Context only unless justified |

## Inclusion And Exclusion Rules

- Prefer primary listings.
- ADRs are acceptable if liquidity is sufficient and share factors are handled correctly.
- Exclude distressed companies unless the target is also distressed or the distress read-through is central.
- Exclude banks, insurers, and REITs from corporate peer sets unless the user explicitly wants cross-sector comparisons.
- Conglomerates can stay only if flagged as `not_clean_comp`.
- If the target is loss-making, prioritize peers with similar growth and margin profiles and weight revenue or sector-specific KPIs more heavily.
- Do not silently drop close peers. If a close peer is excluded, list it under `Excluded close peers` with the exact blocker.
- Do not let secondary or aspirational peers drive the selected valuation range without explaining why the core set is insufficient.

## Peer-Set Review Output

For peer-set review tasks, use:

| Company | Proposed role | Keep / move / exclude | Rationale | Missing data / caveat |
|---|---|---|---|---|

Then conclude with:

- core peer set;
- secondary context set;
- excluded close peers;
- peers to avoid as valuation anchors;
- the multiples most appropriate for the resulting set.

## Common Peer-Set Failure Modes

- Sector leakage: using financials, insurers, REITs, or asset-heavy businesses in a corporate software or services set.
- Size mismatch: using mega-cap diversified peers to value a small focused issuer without discounting the read-through.
- Growth or margin mismatch: anchoring a high-growth, loss-making target to profitable low-growth peers without separating revenue multiple logic.
- Geography mismatch: mixing regions where regulation, listing venue, accounting, currency, or investor base changes valuation.
- Accounting mismatch: mixing IFRS and GAAP or reported and adjusted metrics without labeling the denominator basis.
- Data availability bias: excluding close peers only because data is inconvenient while retaining weaker peers with cleaner data.
