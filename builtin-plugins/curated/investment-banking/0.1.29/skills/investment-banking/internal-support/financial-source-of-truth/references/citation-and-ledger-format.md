# Citation and Evidence Ledger Format

Use this reference to make source support auditable across markdown, spreadsheets, documents, and slide outputs.

Use `../../../../../../../references/evidence-label-taxonomy.md` for canonical category definitions and cross-skill label mapping. If a producing skill has its own schema label, preserve it in notes or a `native_evidence_label` field and add the canonical category separately.

## Table Of Contents

- [Native citations first](#native-citations-first)
- [Evidence posture block](#evidence-posture-block)
- [Evidence posture ratings](#evidence-posture-ratings)
- [What requires citation](#what-requires-citation)
- [What does not always require citation](#what-does-not-always-require-citation)
- [Citation placement](#citation-placement)
- [Source inventory template](#source-inventory-template)
- [Evidence ledger template](#evidence-ledger-template)
- [Assumption register template](#assumption-register-template)
- [Diligence asks template](#diligence-asks-template)
- [Spreadsheet and model source notes](#spreadsheet-and-model-source-notes)
- [Slides and decks](#slides-and-decks)
- [Output labels](#output-labels)
- [Explicit compact evidence note](#explicit-compact-evidence-note)
- [Final QA checklist](#final-qa-checklist)

## Native citations first

If the active environment provides native citations from web, files, connectors, or internal search, use those citations exactly as required by that environment. Do not replace native citations with generic source IDs in the final user-facing answer.

Use source IDs such as S1, S2, and S3 as an internal and appendix-friendly shorthand, especially when building a source inventory or evidence ledger.

## Evidence posture block

Use this block when the output is decision-grade or when the user's task is specifically about evidence quality:

```markdown
## Evidence posture

**Overall posture:** [decision-grade / diligence-grade / preliminary / assumption-led / not supportable]
**Primary source basis:** [brief source hierarchy used]
**Freshness:** [current as-of dates / stale items]
**Key assumptions:** [assumptions that drive the conclusion]
**Open evidence gaps:** [highest-priority missing items]
**Conflicts:** [unresolved source conflicts or none identified]
```

## Evidence posture ratings

| Rating | Use when | Output requirement |
|---|---|---|
| decision-grade | Material claims are supported by appropriate current sources; conflicts are resolved or immaterial; assumptions are explicit. | Proceed with conclusion and cite key evidence. |
| diligence-grade | Enough evidence exists to guide next diligence, but important items remain unverified. | State decision limits and provide evidence asks. |
| preliminary | Analysis relies on partial sources, public screens, seller materials, or unstamped data. | Avoid definitive recommendation language. |
| assumption-led | Core conclusion depends on analyst or user assumptions rather than verified evidence. | Lead with assumptions and sensitivities. |
| not supportable | Required evidence is absent, contradictory, or stale enough to invalidate the result. | Do not make a decision claim; provide remediation steps. |

## What requires citation

Cite or label the following:

- Every hard number that affects analysis: revenue, EBITDA, FCF, growth, margin, leverage, valuation, covenant headroom, market price, yield, cap rate, rent, vacancy, ARR, churn, NWC, debt balance.
- Every direct quote or paraphrased management statement.
- Every seller claim extracted from CIM, teaser, management presentation, banker email, or lender deck.
- Every consensus, market data, rating, forecast, or third-party estimate.
- Every legal or credit term: maturity, coupon, covenant, basket, lien, priority, guarantee, amortization, call protection.
- Every macro release or policy fact that drives the view.
- Every diligence finding that supports a red flag, kill criterion, or investment recommendation.

## What does not always require citation

Do not overload short outputs with citations for generic reasoning. The following can usually be uncited unless the specific claim is disputed or decision-critical:

- Basic finance formulas.
- Your own clearly labeled inference.
- A scenario assumption explicitly chosen by the user.
- Formatting comments or writing-quality feedback.
- A diligence ask derived from a missing source.

## Citation placement

Place the citation immediately after the supported claim.

Good:

```markdown
Revenue grew 12 percent year over year in Q2, while gross margin declined 180 bps. [S1]
```

Bad:

```markdown
Revenue grew 12 percent year over year and margins declined, showing cost pressure and weak execution. [S1]
```

The bad example over-cites the interpretation. Rewrite as:

```markdown
Revenue grew 12 percent year over year and gross margin declined 180 bps. [S1] The margin decline suggests cost pressure, but the cause needs support from management commentary or cost detail.
```

## Source inventory template

```markdown
| ID | Source | Source owner | Type | Date / as-of | Period | Tier | Used for | Freshness | Limits |
|---|---|---|---|---|---|---|---|---|---|
| S1 | [title or file name] | [company / seller / vendor / user / court / regulator] | [filing / model / CIM / transcript / vendor / agreement] | [date] | [period] | [tier] | [metric/claim] | [label] | [caveat] |
```

## Evidence ledger template

```markdown
| Claim / metric | Label | Source ID(s) | Exact support | Caveat or conflict | Decision impact |
|---|---|---|---|---|---|
| [claim] | [canonical category] | [S1] | [what the source actually supports] | [limits; include local label if different] | [why it matters] |
```

## Assumption register template

```markdown
| Assumption | Type | Basis | Evidence support | Sensitivity | Owner | Status |
|---|---|---|---|---|---|---|
| [assumption] | [operating / valuation / credit / macro / timing / legal] | [why chosen] | [direct / indirect / none] | [what changes if wrong] | [user / analyst / management] | [accepted / needs diligence] |
```

## Diligence asks template

```markdown
| Priority | Ask | Why it matters | Current evidence | Required support | Owner |
|---:|---|---|---|---|---|
| 1 | [specific ask] | [decision impact] | [current source/claim] | [document/data needed] | [seller / management / lender / user] |
```

## Spreadsheet and model source notes

When producing or reviewing a workbook:

1. Add a `Sources` or `Evidence Ledger` tab when the model is decision-grade.
2. Add source comments or notes to key input cells when feasible.
3. Do not cite formulas as sources. Cite the inputs behind the formulas.
4. Mark assumptions in a different section from historical sourced values.
5. Include as-of dates for market data, consensus, rates, spreads, and prices.
6. Include a checks section that flags missing source notes, stale inputs, and hardcoded formulas that should be linked.

Suggested source note format for a model input:

```text
Source: S3, FY2025 10-K, Note 12, filed 2026-02-20. As-of: FY2025. Used for debt maturity schedule.
```

## Slides and decks

When producing or reviewing slides:

1. Keep source footnotes short but specific.
2. Make repeated metrics tie to the same source and definition across the deck.
3. If a slide uses a derived number, cite the source for inputs and name the calculation.
4. Flag any slide where title claim is stronger than the evidence.
5. Put detailed source inventory in appendix when footnotes would overwhelm the slide.

## Output labels

Use labels inline when useful:

- **Verified fact:** directly supported by appropriate evidence.
- **Reported fact:** stated by a source or provider but not independently verified against the controlling source.
- **Seller claim:** from CIM, teaser, investor deck, broker, or management presentation.
- **Management statement:** spoken or written management comment, guidance explanation, budget, or management case.
- **Pro forma adjustment:** add-back, normalization, reclassification, synergy, dis-synergy, standalone cost, or purchase-accounting adjustment.
- **Assumption:** chosen input; not proven by evidence.
- **Inference:** analyst conclusion from evidence.
- **Estimate:** calculated or approximated.
- **Stale:** may be superseded.
- **Contradicted:** sources disagree.
- **Unknown:** needed but not sourced or still placeholder.

## Explicit compact evidence note

Use this only for narrow source-control questions, explicit quick answers, or cover notes when a richer artifact carries the full ledger:

```markdown
Evidence note: [verified / preliminary / assumption-led]. Primary support: [sources]. Key caveat: [stale/conflicting/missing item].
```

## Final QA checklist

Before finalizing an investment-banking or finance output that relies on evidence, confirm:

- the evidence posture is stated or obvious from context.
- every material number or quote is cited or labeled as an assumption.
- source dates and as-of dates are included where material.
- seller, management, and banker claims are not treated as verified facts without support.
- conflicting sources are reconciled or flagged.
- stale or missing data is visible, not buried.
- assumptions, estimates, and inferences are separated from facts.
- diligence asks are specific enough for an analyst, banker, lender, or investor to act on.
- the output does not overstate certainty beyond the evidence.
