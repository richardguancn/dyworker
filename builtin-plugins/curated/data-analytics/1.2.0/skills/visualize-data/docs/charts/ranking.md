<!-- Generated chart reference. -->

# Ranking

Expandable proportional fills, always-visible values. Nonnegative finite values, unique category labels; preserve every observation through Show more, not truncation. Formatting affects measured display only. No row-limit/showValues/multiple-measure/Other options. Signed values or axes use horizontal bars with explicit ordering. Alias selects same presentation; check long labels/narrow layout.

## Example

```json
{
  "id": "queues",
  "title": "Open tickets by queue",
  "spec": {"type":"rankedList","category":"queue","value":"tickets"},
  "rows": [
    {"queue":"Billing","tickets":25},
    {"queue":"Account access","tickets":18}
  ]
}
```

```typescript
export type RankingSpec = {
  type: "leaderboard" | "rankedList";
  category: string;
  value: string;
  sortOrder?: SortOrder;
  valueFormat?: ValueFormat;
};
export type RankingChart = Chart<RankingSpec>;
```

[Using this chart in React](../../SKILL.md#react-reports-and-dashboards)
