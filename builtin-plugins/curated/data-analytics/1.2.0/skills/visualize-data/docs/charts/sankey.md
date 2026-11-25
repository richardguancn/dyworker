<!-- Generated chart reference. -->

# Sankey

Use `sankeyMode: "edges"` for adjacent-stage marginals: each row supplies two adjacent stage labels and null at unused stages. Intermediate node inflow must equal outflow. This draws one conserved diagram without inventing end-to-end paths; selection highlights only supplied edges.

Default `paths` mode uses one row per complete mutually exclusive path. Both modes use 2–4 distinct ordered stage fields and a separate positive safe-integer count; totals must remain exact. Aggregate duplicate paths/edges before rendering. Preserve population/scope and distinct labels within each stage. Native node labels/count/share tooltips; local selection, not persistent filtering. Max 12 nodes/stage, 96 links; height needs 24px margins + 16px between + 12px per node. No skipped stages, overlapping populations, rates or currency. Counts retain their denominator.

## Example

```json
{
  "id": "journey",
  "title": "Acquisition paths",
  "spec": {"type":"sankey","stages":["channel","signup","plan"],"value":"count"},
  "rows": [
    {"channel":"Organic","signup":"Trial","plan":"Pro","count":120},
    {"channel":"Organic","signup":"Trial","plan":"Team","count":80}
  ]
}
```

```typescript
export type SankeySpec = {
  type: "sankey";
  /** Default paths. Edges: exactly two adjacent nonblank stage values per row, null elsewhere; conserve intermediate nodes. */
  sankeyMode?: "paths" | "edges";
  /** Ordered stage fields. Max 12 nodes/stage, 96 links. */
  stages:
    | [string, string]
    | [string, string, string]
    | [string, string, string, string];
  /** Positive safe-integer counts; aggregate duplicate full paths before rendering. */
  value: string;
  colorByColumn?: boolean;
};
export type SankeyChart = Chart<SankeySpec>;
```

[Using this chart in React](../../SKILL.md#react-reports-and-dashboards)
