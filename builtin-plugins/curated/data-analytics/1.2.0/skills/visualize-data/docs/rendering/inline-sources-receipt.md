# Inline Sources Receipt

Use this reference only when the [Sources boundary](../../SKILL.md#sources) applies. Keep the answer and material caveats in chat. Place the functional, initially collapsed Sources inspector directly below the chart, table or related visual group it supports, before the next prose or visual. For prose-only answers, place it after the supported findings and caveats. Reports keep inspection inside the report. Positively identified Work Mode retains its native delivery contract.

## Payload

Write one JSON payload per inspector with `schemaVersion: 1` and ordered `items`. Each item is one distinct supported finding with a stable lowercase-hyphenated `id`, reader-facing `title`, and `queries`. Each query requires its own `id` and `source: {label: "..."}`. Query IDs must be unique within their item. A finding repeated in prose and a chart uses one card; a query supporting different findings can occur in each relevant card. Do not attach unrelated results or unsupported causal findings.

The collapsed row reads **Sources** for one finding and **Sources • N** for multiple findings. The renderer owns consolidation, tabs, icons, tooltips and layout; do not recreate them. Usually omit item `description` and query `summary` unless they add essential subject context absent from the definition and answer.

| Field | Authoring contract |
| --- | --- |
| `source.tables`, `files`, `links` | Actual source identities and recorded safe destinations. Keep readable labels when no safe URL is known; never construct URLs from opaque IDs. |
| `source.metricDefinitions` | Array of `{ "label": "Net revenue", "definition": "Revenue after refunds, in USD." }` objects with nonempty text. Strings must use `"Term: definition"` or `"Term = definition"`; a plain sentence without the term delimiter is rejected. Keep only the scope needed to interpret each measure. Optional supported `formula` or `calculationSummary` must add a distinct method, denominator or window; avoid generic arithmetic definitions and repeated prose. `componentIds` refer to item IDs. |
| `source.filters` | One independently readable scope predicate per entry, e.g. `["Plan: paid", "Country: US"]`. Preserve all result-changing predicates in exact SQL or metadata; do not transcribe every WHERE clause into duplicate pills. Record applied filters explicitly when SQL is unavailable. |
| `reportingPeriod` | Actual measurement/comparison window, once. Distinguish different date meanings; never infer a shared period from unrelated columns. |
| `source.sql` or `source.query.sql` | Exact reviewed SQL. Keep provider-issued query/history URLs in `source.queryUrl`. |
| `methods` | Display-only records with `language: "python"` or `"calculation"` and exact recorded `code`; at most one of each. SQL stays in the source. |
| `rows`, `columns` | If you include `rows` (even `[]`), list 1–80 approved `columns` as field names or `{field, label}`. Without a tabular preview, omit both. |
| `preview` | A sample/partial/aggregate preview needs `kind`, explanatory `note`, and optional recorded `totalRows`. Never imply a preview is complete. |
| `source.caveats`; item `assumptions` | Material limitations and interpretive assumptions, preserving their ownership. Write self-contained sentences identifying their scope; no automatic source-name prefix is added. Assumptions: at most 20 strings, 2,000 characters each. |
| `source.executedAt`, `capturedAt` | Recorded execution and capture timestamps with timezone; omit unknown values. Neither is the reporting period or proof of data freshness. |
| `source.evidenceFlow` | Recorded steps with `kind`: `question`, `definition`/`metric`, `source`, `filter`, `calculation`/`method`, or `validation`/`result`. Include the observed result of a check. Use `showInReceipt: false` for routine execution metadata, never material errors, limitations or repairs. |
| `sourceRoles` | Optional chip explanations `{kind, label, href?, role}`; `kind` is table/file/link/dashboard and identity must match one of this query's sources. At most 40; each role at most 1,000 characters. Describe purpose, not inferred authority or verification. |

Consolidate identical definitions, filters and caveats within a finding; preserve differing scopes and ownership. Use one self-contained sentence per caveat. Keep worked arithmetic in Calculation evidence, not duplicate Overview text. Explain what the evidence establishes and its most consequential limit. The Data Sources payload does not accept a `confidence` field. Do not manufacture rows, SQL, timestamps, workflow steps, checks or verification badges for document-backed answers.

For Snowflake, Databricks, BigQuery or Redshift tables, follow [table usage metadata](../../../../shared/table-usage.md): make one targeted best-effort lookup through the authorized connector, reusing current-task results. `source.tables` may contain `{name, trust}` with observed `provider`, `queryCount`, `uniqueUsers`, `windowDays`, `lastQueriedAt`, `usageAsOf`, `usageNote`. Preserve the actual window/cutoff and omit unavailable values. Optional usage lookup must not block delivery or trigger permission escalation.

## Disclosure

Include reviewed SQL/Python/calculations and safe links automatically; no disclosure flags are needed. Keep code out of native prose unless requested. Collapsing the inspector is not an access boundary: remove credentials, tokens, direct contact/payment identifiers, hidden reasoning, absolute local paths and unrelated fields before rendering.

Ordinary source URLs must be HTTP(S), without credentials, query parameters, fragments or token-bearing paths. `source.queryUrl` separately accepts recognized provider-issued Snowflake/Databricks query routes and their narrowly allowed locator parameters/fragments. Never construct query URLs or embed SQL in them. The validator catches common unsafe values but cannot certify arbitrary content.

Limits: 2 MB input, 1 MB rendered receipt, 20 cards, 10 queries/card, 2,000 preview rows total. Label any reduced preview; retain material evidence and limitations.

## Render once

Use the existing Node executable (prefer the bundled absolute path from `load_workspace_dependencies` when available):

```sh
"<codex-node>" "<data-plugin>/assets/visualize-data/scripts/runtime/render-inline-sources.mjs" \
  --input /absolute/reviewed-sources.json \
  --output /absolute/task/answer-sources.html
```

The bundled `--example` is synthetic. The renderer verifies its shipped runtime and needs no dependency installation, build, fetch or publication. Write outside the plugin/shared caches, using a distinct output path for each inspector. Use its returned path unchanged in exactly one final-message reference:

```text
visualize{"path":"/absolute/task/answer-sources.html"}
```

No duplicate Sources heading, raw HTML, code block, download handoff or duplicated answer prose. Interactions are local; source links open only on user action. Correct specific validation errors. If delivery remains unavailable, preserve the answer and available citations with a concise limitation; omit unsupported cards and never claim an unrendered inspector succeeded.
