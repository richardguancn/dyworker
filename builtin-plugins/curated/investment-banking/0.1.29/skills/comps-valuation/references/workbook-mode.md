# Lightweight Artifact Reference

## Table Of Contents

- [Use Boundary](#use-boundary)
- [Lightweight Artifact Principles](#lightweight-artifact-principles)
- [Formula And Manual Input Rules](#formula-and-manual-input-rules)
- [Provenance Patterns](#provenance-patterns)
- [Suggested Tab Architecture For Small Exports](#suggested-tab-architecture-for-small-exports)
- [Export Conventions](#export-conventions)

## Use Boundary

Use this reference only when `comps-valuation` in `report` mode creates a lightweight CSV, markdown table, or small non-refreshable table artifact. Full Excel, Google Sheets, refreshable, formula-driven, linked-source, or IC/client-circulation candidate comps workbooks belong to `comps-valuation` in `workbook` mode.

## Lightweight Artifact Principles

- Keep raw sourced inputs on source or staging tabs.
- Put assumptions, manual overrides, and policy choices on visible control or audit tabs.
- Drive calculated fields with formulas when the file format supports formulas.
- Pull linked sections from prior tabs or source tables; do not re-key the same input in multiple places.
- Preserve a clear path from each output multiple back to price, shares, EV bridge components, and denominators.
- If the user needs linked tabs, peer-universe management, sensitivity tables, or workbook QA, switch to `workbook` mode.

## Formula And Manual Input Rules

- Raw provider exports, filing values, and user-supplied figures can be direct inputs.
- Derived values such as market cap, diluted equity value, EV, multiples, summary statistics, and implied valuation should be formulas.
- Manual overrides need a reason, date or as-of marker when relevant, and source or approver note if available.
- If a CSV cannot preserve formulas, include formula logic and overrides in a notes or audit column.

## Provenance Patterns

For important inputs, preserve traceability with one of:

- source tab and row/column reference;
- provider export name and field;
- filing or company document reference;
- user-provided assumption label;
- manual override note with reason.

Keep sourced values distinguishable from assumptions and adjusted values.

## Suggested Tab Architecture For Small Exports

- `Control_Panel`: as-of date, currency mode, module, accounting choices, outlier policy, and key assumptions.
- `Peers`: peer list, company identifiers, taxonomy, geography, inclusion or exclusion notes.
- `Source_Data`: raw provider, filing, or user-supplied values when practical.
- `EV_Bridge`: price, shares, dilution, cash, debt, other claims, investments, and final EV.
- `Multiples`: denominators, estimate vintages, and computed multiples.
- `Stats_Outliers`: summary statistics and outlier flags by metric.
- `Output_Comps`: clean publishable comps table.
- `Audit_Provenance`: source fields, overrides, substitutions, stale-data flags, and caveats.

Use fewer tabs for small artifacts, but preserve the same logic.

## Export Conventions

- Use consistent number formats: multiples `0.0x`, percentages `0.0%`, currency in `$m` or `$bn`.
- Freeze headers when the environment supports it.
- Keep text left-aligned and numbers right-aligned where practical.
- Make QA caveats visible on the output or audit tab.
- Do not spend time on decorative styling unless the user asks for presentation polish.
