# A bundled, typed component kit

The template should initialize a small component kit from its reviewed-data contract. Authors compose charts, metrics, tables and custom blocks; the kit carries the selected data and its evidence to each component. The existing public UI components, chart renderer and shell remain the implementation.

## Authoring contract

- Preparation writes `src/content/view.ts`: a readable field contract and one `createDataView(...)` call. Known query names and row fields become TypeScript types. The runtime checks incoming rows against that same contract. Observed values can seed a contract; they do not establish business meaning, units or safe aggregation.
- The entry component imports this initialized `View`. `View.Provider` uses the shell's page state. `View.Filters` uses existing controls. `View.Section` intersects a named local scope with the page scope. A filter never broadens its parent scope.
- `View.Chart`, `View.Metric`, `View.Table` and `View.Block` bind a query once. They receive the same scoped rows, source rows and filter metadata. Derivations can change displayed rows without replacing the reviewed source evidence.
- Existing layout, narrative, controls and chart families remain available through `data-app-public.jsx`. A custom component uses `View.Block` or `View.useQuery`; it does not create another data store or source inspector.
- State updates use the existing shell, including named section scopes and its current-view links. The kit does not introduce competing persistence or share serialization.

The library is bundled as typed source in the template's shared content directory and compiled into the artifact by the existing offline compiler. It requires no package install or additional CDN asset. Canonical fixes happen in the plugin; an existing artifact keeps its copied version until deliberately updated. Layout and business formulas remain authored, and extension is through composition. A later promotion of stable helpers into the protected public runtime should preserve this author-facing interface.

## Discovery and modification

The preparation receipt points directly to a short kit guide and the generated contract. The guide supplies a complete example, lists every kit component, links the existing component-topic index, and explains four operations: add a component, change its query/format/layout, introduce a section scope, and build a custom block. Authors should not need to read the library implementation for ordinary work.

Field keys, query IDs, callback values and component props are checked before rendering. Runtime checks still handle loaded values, missing rows, missing filter fields and refreshes. Types cannot prove that a ratio is additive, that a population is appropriate, or that a recommendation follows from its evidence.

## First implementation and evaluation

Make this an opt-in template path first. Implement page and one level of named section scope, typed query/row access, chart/metric/table/custom-block binding, and explicit source metadata propagation. Retain the existing historical-range versus endpoint semantics of the shell, making history preservation explicit in the kit. Keep unsupported nested scopes and ambiguous filter applicability diagnostic rather than silently ignoring them.

Test one multi-query dashboard with a date range, page category filter, local section filter, chart, KPI, table and custom derived block. Verify that selections, zero-result states, reset, source inspection and saved view restoration agree. Exercise both original and refreshed data, and reject malformed rows rather than rendering a misleading zero. Compile valid extensions and reject unknown queries/fields and wrong callback values. Test a second dataset and a report to avoid a fixture-specific abstraction.

Compare fresh authoring against the existing template. Measure instruction reads, output tokens, elapsed time, repair rounds and artifact correctness. Keep the kit opt-in until it reduces coordination work without increasing reading or validation cost materially. The broader roadmap is stronger declared date/grain/unit contracts, reusable comparisons and a contract-generated component catalog; it is not necessary to build that entire system to validate this first slice.
