# Chart configuration contract

The release in the [chart import](rendering/saved-chart-fragments.md#author-a-chart-fragment) identifies this contract. Existing HTML keeps its original pinned runtime. The adapter translates validated chart fields to its internal representation.

| Family                                 | Horizontal `x`                                 | Vertical `y`                                  | Other binding                                                                       |
| -------------------------------------- | ---------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------- |
| Line, area, stacked area, sparkline    | Category or supported numeric coordinate field | Value field or nonempty tuple of value fields | `series` only with a single value field                                             |
| Vertical bar / stacked / 100%          | Category field                                 | Value field or nonempty tuple of value fields | `series` only with a single value field                                             |
| Horizontal bar / stacked / 100%        | Value field or nonempty tuple of value fields  | Category field                                | `series` only with a single value field                                             |
| Scatter                                | Coordinate field                               | Coordinate field                              | Optional grouping `series`; existing overlay restrictions remain                    |
| Box plot, waterfall                    | Category field                                 | Observations or supplied value field          | Existing summary / waterfall options remain                                         |
| Heatmap                                | Column category field                          | Row category field                            | `value` is the color metric; `xOrder` / `yOrder` order physical axes                |
| Histogram, `input: "raw"`              | Observation field                              | Derived count (no authored `y` binding)       | Existing automatic binning                                                          |
| Histogram, `input: "binned"`           | `{ lower, upper, label }` interval fields      | Supplied count field                          | `statistic` selects count / frequency / density; existing layout constraints remain |
| Pie, funnel, leaderboard / ranked list | No axis binding                                | No axis binding                               | `category` and `value`                                                              |
| Sankey                                 | No axis binding                                | No axis binding                               | `stages` and `value` for complete path counts                                       |

Where supported, `xLabel` / `yLabel`, `xDomain` / `yDomain`, `xScale` / `yScale`, and reference selectors `axis: "x" | "y"` describe the physical dimensions above. Unsupported options fail validation rather than silently changing meaning. Non-Cartesian families do not accept axis options. Existing feature limitations are not expanded by this naming cleanup.

These bindings replace the legacy aliases `fields`, `valueDomain`, reference axis `value`, heatmap `series` / `categoryOrder` / `seriesOrder`, histogram `bins` / `density`, and non-Cartesian `x` / `y`. Wide measures use the corresponding physical axis tuple. Validation returns the normalized public form; repeated validation and orientation round trips must be lossless and nonmutating.
