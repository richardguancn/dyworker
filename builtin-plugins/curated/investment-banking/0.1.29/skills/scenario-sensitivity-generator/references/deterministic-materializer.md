# Deterministic Sensitivity Materializer

Use the skill-root-relative script [`scripts/materialize_sensitivity_pack.py`](../scripts/materialize_sensitivity_pack.py) when the user needs repeatable starter tables or a downstream skill needs structured inputs.

## Supported Modes

The materializer supports these canonical modes:

- `valuation`
- `debt_capacity`
- `covenant_headroom`
- `financing_terms`
- `merger_model`
- `downside`
- `returns`
- `all`

Mode definitions live in [`assets/sensitivity_pack_modes.json`](../assets/sensitivity_pack_modes.json). The script is deterministic and uses only the Python standard library.

## Command

From the skill root:

```bash
python3 scripts/materialize_sensitivity_pack.py \
  --mode all \
  --entity ExampleCo \
  --transaction-version "Base model v1" \
  --output-dir /tmp/exampleco_sensitivity_pack
```

## Outputs

The script writes:

- `pack_manifest.json`: entity, transaction version, modes, generated files, and canonical source.
- `case_summary.csv`: starter case outputs by mode.
- `scenario_overlay.csv`: driver-change overlay rows compatible with `scenario-overlay-contract.md`.
- `trigger_metrics.csv`: breakpoints, monitoring cadence, and contingency actions.
- `deal_action_register.csv`: deal actions tied to sensitivity triggers.
- `target_backsolve.csv`: target metrics and required paths.
- `sensitivity_<mode>.csv`: deterministic table spine for each requested mode.
- `sensitivity_pack.xlsx`: first-read workbook scaffold with sensitivity-basis, scenario, breakpoint, action, and source views.

The script does not create a dashboard contract or HTML dashboard by default. When an explicitly requested HTML summary is needed, create it separately under the skill's Optional HTML Companion guidance and keep the workbook as the calculation source of truth when one exists.

## Extension Rules

- Add a mode only if it is also documented in skill-root-relative `SKILL.md` or `transaction-mode-router.md`.
- Keep row schemas stable; downstream skills may rely on the headers.
- Preserve the `sensitivity_basis`, `embedded_corrections_or_adjustments`, and `excluded_unresolved_items` fields whenever overlay rows move downstream.
- Use placeholders when values require a model. Do not invent transaction outputs inside the template.
- Add trigger and action rows for every mode where downside, financing, covenant, merger, or returns thresholds matter.
