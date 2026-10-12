# Mechanical Waterfall Engine

## Purpose

The skill-root-relative script [`scripts/waterfall_engine.py`](../scripts/waterfall_engine.py) provides a simple mechanical waterfall for first-pass recovery math or QA checks. It is intentionally limited.

Use it when:

- The user provides a simple debt stack and distributable values.
- You need to verify pro rata sharing and value-break math.
- You need an auditable workbook cross-check for a larger recovery analysis.

Do not rely on it for final outputs when:

- Collateral pools are material.
- Deficiency claims need to be modeled.
- Legal entity structure affects recoveries.
- Intercreditor terms affect enforcement or proceeds.
- Plan settlements differ from legal priority.
- New-money dilution, warrants, or MIP are material.
- A full Excel model is required.

## Input schema

Create a JSON file:

```json
{
  "company": "exampleco",
  "currency": "$mm",
  "scenarios": [
    {"name": "low", "distributable_value": 1200},
    {"name": "base", "distributable_value": 1800},
    {"name": "high", "distributable_value": 2400}
  ],
  "classes": [
    {"name": "dip", "claim": 150, "priority": 1, "notes": "superpriority"},
    {"name": "abl", "claim": 300, "priority": 2},
    {"name": "first lien term loan", "claim": 1200, "priority": 3},
    {"name": "second lien notes", "claim": 600, "priority": 4},
    {"name": "unsecured notes", "claim": 400, "priority": 5},
    {"name": "common equity", "claim": 0, "priority": 6, "equity": true}
  ]
}
```

## Command

From the skill root:

```bash
python scripts/waterfall_engine.py input.json output.md
```

## Output

The primary human output is `recovery_waterfall.xlsx`, with `Cover` first and auditable calculation tabs. It also retains the requested Markdown path as a compatibility support narrative and creates internal model-citation/manifest/handoff support files.

The workbook includes:

- Scenario distributable value.
- Recovery by class.
- Recovery percentage.
- Remaining value.
- Mechanical fulcrum class.
- Notes and limitations.

The script does not generate a dashboard or render contract by default. When a debtor-side narrative memo is needed, create a standalone HTML memo under the skill's normal output contract and use the workbook as a companion only when useful.

## Interpretation rules

- The first partially impaired class is the mechanical fulcrum.
- If all debt classes are paid and value remains, residual value is shown to equity if an equity class is included.
- If no class receives recovery because value is zero, no fulcrum is assigned.
- If all debt is paid in full and no equity class exists, the script reports residual value.

Always layer senior banker judgment on top of the script output.
