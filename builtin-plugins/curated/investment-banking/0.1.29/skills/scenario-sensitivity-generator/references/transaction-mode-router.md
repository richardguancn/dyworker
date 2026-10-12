# Transaction Sensitivity Router

Choose the transaction mode before building outputs.

| Mode | Materializer mode | Use when | Output should include | Avoid |
|---|---|---|---|---|
| Deal case analysis | `downside` plus relevant mode | The team needs coherent base, upside, downside, lender, sponsor, or stress cases | case narrative, driver changes, output comparison, breakpoints, deal actions | unrelated assumption changes |
| Valuation sensitivity | `valuation` | The decision is valuation range, fairness, offer price, reserve price, or market read-through | EV/equity/value-per-share tables, selected range, multiple/WACC/premium sensitivities, caveats | mechanical min/max without judgment |
| Debt capacity sensitivity | `debt_capacity` | The decision is leverage capacity, lender support, debt quantum, or financing capacity | debt capacity, leverage, interest burden, minimum liquidity, lender-case outputs | EBITDA-only commentary |
| Covenant headroom stress | `covenant_headroom` | The decision is covenant cushion, first breach, cure need, or amendment risk | covenant cushion, first breach, minimum liquidity, required cure, coverage | presenting covenant outputs without definitions or proxy caveats |
| Financing terms sensitivity | `financing_terms` | The decision is ECM/DCM/LevFin structure or market timing | rate/spread/OID/fees/tenor/proceeds/dilution read-through, market-window implications | stale market data or no execution caveat |
| LBO returns sensitivity | `returns` | The decision is purchase price, debt mix, exit, EBITDA, deleveraging, IRR, or MOIC | entry/exit multiple grids, leverage, cash sweep, IRR/MOIC, downside breakpoints | calling screen outputs IC-ready |
| Merger sensitivity | `merger_model` | The decision is premium, cash/stock mix, synergies, accretion/dilution, ownership, or pro forma leverage | EPS impact, synergy breakeven, ownership, source/use effects, leverage | standalone valuation with no pro forma mechanics |
| Downside / breakage sensitivity | `downside` | The question is what breaks first across liquidity, covenant, financing, valuation, or returns | first break, liquidity trough, covenant cushion, downside value, action trigger | cosmetic downside cases with no threshold |
| Restructuring / recovery sensitivity | custom or downstream waterfall | The decision is fulcrum security, recoveries, plan value, collateral value, or settlement range | recovery by class, value leakage, collateral and priority caveats, fulcrum shifts | legal conclusions or hidden priority assumptions |
| Target backsolve | relevant mode plus `target_backsolve.csv` | The target metric is fixed and required assumptions are unknown | target metric, locked constraints, allowed levers, required path, feasibility label | presenting math as feasible without execution judgment |

## Practical mode rules

- Use deal case analysis for multi-variable transaction cases.
- Use valuation sensitivity for price, range, fairness, and read-through questions.
- Use debt capacity sensitivity for leverage and financing-capacity questions.
- Use covenant headroom stress when covenant risk, first breach, or lender protection matters.
- Use financing terms sensitivity when market terms or issuance structure drive feasibility.
- Use LBO returns sensitivity when sponsor returns or downside equity value are central.
- Use merger sensitivity when accretion/dilution, synergies, ownership, or pro forma leverage drive the recommendation.
- Use downside / breakage sensitivity when the user asks what breaks first.
- Use restructuring sensitivity when recoveries, plan value, collateral, or claim priority matter.
- Use target backsolve when the destination metric is fixed and the required assumption path is unknown.

Combine modes when needed, but name the role of each exhibit so the output does not become a pile of unrelated tables.

For deterministic starter tables, run the skill-root-relative script [`scripts/materialize_sensitivity_pack.py`](../scripts/materialize_sensitivity_pack.py).

From the skill root:

```bash
python3 scripts/materialize_sensitivity_pack.py --mode <materializer mode>
```

Use `--mode all` for the canonical launch bundle: `valuation`, `debt_capacity`, `covenant_headroom`, `financing_terms`, `merger_model`, `downside`, and `returns`.
