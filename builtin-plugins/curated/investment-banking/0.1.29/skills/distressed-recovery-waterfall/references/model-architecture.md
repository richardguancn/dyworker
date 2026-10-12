# Model Architecture

## Table Of Contents

- Workbook principles
- Recommended tabs
- Capital structure tab
- Claims register tab
- Waterfall logic
- Plan economics
- Sensitivity outputs
- Charts
- QA checks
- Change log

## Workbook principles

Build institutional-quality restructuring models. Preserve user work. Use outputs that a senior banker can review quickly and an analyst can audit.

If model outputs feed `memo-builder`, `pitch-deck-builder`, or `ib-deck-qc`, export the applicable `distressed_recovery_waterfall_to_*` package from `../../../references/handoff-contracts.md` and preserve waterfall tie-outs, valuation-case tie-outs, scenario outputs, assumption register, model status, and counsel/specialist review flags.

Core principles:

- No destructive edits without explicit instruction.
- Add new tabs rather than overwriting original tabs.
- Keep formulas transparent.
- Separate inputs, calculations, outputs, and checks.
- Use scenario toggles.
- Include source notes.
- Include assumption labels.
- Include error checks.
- Preserve external links and named ranges unless explicitly asked to remove them.

## Recommended tabs

1. Cover and executive summary.
2. Source log and assumption labels.
3. Capital structure.
4. Legal entity and collateral map.
5. Claims register.
6. Valuation.
7. Liquidation analysis.
8. Reorganization waterfall.
9. Liquidation waterfall.
10. Sale or 363 waterfall.
11. Restructuring alternatives.
12. New money and ownership.
13. Voting and plan feasibility.
14. Sensitivities.
15. Charts.
16. QA checks.
17. Change log.

## Capital structure tab

Columns:

- Priority.
- Instrument.
- Issuer or borrower.
- Guarantors.
- Claim amount.
- Accrued interest.
- Default interest.
- Make-whole toggle.
- Maturity.
- Coupon.
- Secured status.
- Lien.
- Collateral pool.
- Trading price.
- Market value.
- Known holder group.
- Source.
- Confidence.
- Notes.

## Claims register tab

Include funded and non-funded claims. Use claim-status fields:

- Allowed.
- Estimated.
- Disputed.
- Contingent.
- Unliquidated.
- Excluded from current case.

Use toggles to include or exclude disputed claims.

## Waterfall logic

Default formulas should:

1. Start with distributable value.
2. Pay each priority class in order.
3. Share pro rata within same-priority classes when value is insufficient.
4. Limit recovery to claim amount unless overpayment is explicitly modeled.
5. Carry remaining value to next class.
6. Calculate recovery percentage.
7. Identify first partially impaired class as value break.
8. Track residual equity value.

For secured claims:

- Allocate collateral value by collateral pool.
- Cap secured recovery by collateral value if undersecured.
- Track deficiency claim if applicable.
- Do not combine unrelated collateral pools unless documents support it.

## Plan economics

Separate legal-entitlement waterfall from negotiated plan allocation.

Plan allocation may include:

- Cash.
- Takeback debt.
- Reorganized equity.
- Warrants.
- CVRs.
- Rights-offering participation.
- Backstop premium.
- MIP dilution.
- Sponsor new money.
- Settlement pool.

Show before and after dilution.

## Sensitivity outputs

Minimum useful sensitivities:

- EBITDA x EV multiple.
- Reorg EV x claim amount.
- Liquidation recovery x wind-down cost.
- DIP size x admin claims.
- New-money size x MIP/backstop dilution.
- Disputed claims included/excluded.
- Make-whole included/excluded.

Show value-break and recovery changes, not just EV changes.

## Charts

Useful charts:

- Debt stack with value-break line.
- Recovery by class across scenarios.
- Fulcrum-shift chart.
- Recovery heatmap.
- Alternatives comparison matrix.
- Sources and uses bridge.
- Ownership after emergence.

## QA checks

Model should include checks for:

- Total allocated value equals distributable value used.
- No class receives more than claim unless labeled as postpetition interest, premium, or settlement.
- No negative recoveries.
- Same-priority classes share pro rata.
- Secured recoveries do not exceed collateral value absent documented plan settlement.
- Value remaining after each class ties.
- Claims included in summaries tie to claims register.
- Scenario outputs tie to valuation cases.
- Ownership sums to 100 percent after dilution.
- Sources and assumptions are documented.
- Fulcrum class matches waterfall math.

## Change log

When modifying a workbook, add a change log:

| Timestamp | Tab | Change | Rationale | User data changed? | Notes |
|---|---|---|---|---|---|
