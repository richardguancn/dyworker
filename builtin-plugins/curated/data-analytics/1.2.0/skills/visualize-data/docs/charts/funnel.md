<!-- Generated chart reference. -->

# Funnel

For a drop-off question, show conversion from the immediately preceding stage in labels/captions beside the funnel. Native visible share-of-first labels do not substitute for this; previous-stage values in a tooltip are not visible until inspected.

## Conversion cohorts

Use a funnel for sequential conversion or drop-off when each later stage counts members of the preceding stage in the same cohort, with one counting unit and a consistent observation window. Label stage counts and conversion denominators. Before-and-after comparisons can use separate funnels with matching stage definitions and observation-window rules. Prefer stage bars when funnel geometry makes the required comparison harder to read.

Check existing reviewed results for matched counts before claiming a stage is unavailable. If only unrelated aggregates exist, show separate comparisons and identify the missing linkage; do not imply conversion.

- **Positive:** Two conversation-level funnels compare invocation → linked Site creation → publication for weekly cohorts, tracking each eligible conversation through all stages within 24 hours.
- **Negative:** A funnel combines users invoking skills, Sites created, and projects published from unrelated populations.

## Renderer behavior

Preserve ordered reviewed stage values/populations, no automatic sorting/aggregation. Null breaks ribbon, zero measured. Increasing/non-nested populations are allowed but must not imply conversion. Visible labels/values, responsive vertical layout; hover/focus shows value/share-first/change-previous, unavailable when denominator unknown/zero. Tap pins/Escape dismisses. valueFormat changes measures only, not conversion meaning. No showValues/grouping/reference/axis/sorting options. Multiple series/overlapping cohorts/custom stage calculations need fallback; a control may select a single reviewed cohort.

## Example

```json
{
  "id": "activation",
  "title": "Activation stages",
  "spec": {"type":"funnel","category":"stage","value":"accounts"},
  "rows": [
    {"stage":"Signed up","accounts":120},
    {"stage":"Verified","accounts":90},
    {"stage":"Activated","accounts":60}
  ]
}
```

```typescript
/** Ordered stages. Claim conversion only for nested counts from the same cohort and window. */
export type FunnelSpec = {
  type: "funnel";
  category: string;
  value: string;
  valueFormat?: ValueFormat;
};
export type FunnelChart = Chart<FunnelSpec>;
```

[Using this chart in React](../../SKILL.md#react-reports-and-dashboards)
