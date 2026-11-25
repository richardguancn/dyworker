# Evidence and source access

## Source metadata and access

When selected source tables belong to Snowflake, Databricks, BigQuery, or Redshift, read [table usage metadata](../../../shared/table-usage.md) and make a targeted best-effort lookup through the existing authorized connector. Capture available table usage in the reviewed source objects before building; reuse a current-task lookup for the same table and window. Missing metadata access must not block analysis or trigger a permission escalation.

### Published Site authentication

On a `401` from a published Site or its API, resolve the exact Site in the current account/workspace using the Sites connector's `get_site` with `include_mcp_connection: false`. If its response includes `siwc_bypass_bearer_token`, retry the read once with `OAI-Sites-Authorization: Bearer <token>`. Native Sites MCP omits this token. Send it only to that Site's verified HTTPS origin, without following redirects; never print it or save it in files or exports. Do not generate or rotate tokens. Honor tool approvals; if the connector is unavailable, Sites denies access, no token is returned, or the retry fails, explain the blocker.

## Reviewed data and provenance

Keep bounded reviewed rows under stable query IDs in `src/data.json`, with exact source metadata and output aliases. The copied snapshot provides a complete schema example. A query's grain must fit every consumer. Retain complementary history, targets, cohorts, and drivers at their natural grains. Preserve nulls, cohort maturity, source classification, and distinctions between observations, targets, and scenarios. Never invent SQL, denominators, or lineage. Fixture classification belongs in metadata; the focused skill controls visible disclosure.

Save how to reproduce each dataset without the original conversation. Keep SQL in `source.sql`. For tool/API sources (for example, Finance, Apple Health, GitHub, or Google Sheets connectors), save the provider, tool, source identity, and exact non-secret arguments from a successful request in `source.evidenceFlow` steps (`title` and `detail`). Record pagination or coverage limits, units, timezone, and how to calculate dates for fixed or rolling windows. Save transformations and calculations in execution order in `query.methods` (`language` and `code`), as executable code or precise steps that turn source responses into the dataset.

When the provider returns a query, worksheet, or query-history page for the recorded SQL, retain its exact URL in `source.queryUrl` (also accepted: `source.query_url` or `source.query.url`). The SQL query tab shows an **Open in Snowflake**, **Open in Databricks**, or **Open query** link for supported destinations. Prefer a saved query or worksheet where the SQL can be edited and run. Keep table/catalog pages and supporting documents in ordinary source links; do not invent a query URL from an ID, workspace hostname, or SQL text. Omit the query URL when none was recorded. Query links permit only recognized provider route fragments and locator parameters, such as Databricks workspace `o` and query-history `queryId`; credentials and arbitrary parameters remain forbidden.

A component may use derived `displayRows` while retaining the original query for inspection; use `sourceRows` for an intentional reviewed subset. Affected visuals, source previews, copying, and exports must use the same filtered population. Do not sum overlapping populations or unweighted rates. Group additive categories into Other only when populations are mutually exclusive, every period reconciles, and original categories remain inspectable. Waterfalls require reviewed before/after totals reconciled by signed intermediate changes.

When a query contains string fields used only as containers that authored code decodes into chart data, declare their names in that query's optional `payloadColumns` array, alongside `rows` and `source`. This omits those strings from automatic color metadata without removing source data, filters, calculations, or exports. Declare known containers, not fields guessed from their names or JSON appearance; leave actual category labels and mixed-use fields unmarked. Preserve the declaration on refresh, and remove a field from it if an edit repurposes that field as a category. Dashboards without declarations retain existing color behavior.

### Reviewed metric definitions

Each query's `source.metricDefinitions` supplies relevant definitions. Ordinary counts need a concise label and truthful definition, not decorative formulas. For example, when the reviewed transformation actually establishes these aliases and subtraction:

```json
{
  "label": "Net change",
  "definition": "Current active users minus previous active users.",
  "componentIds": ["usage-change"],
  "formula": "activeUsers - previousUsers",
  "dependencies": ["activeUsers", "previousUsers"],
  "sourceLineage": [{ "tables": ["analytics.reviewed_usage"] }]
}
```

- `componentIds`: exact stable authored IDs. Definitions for unrelated consumers must not appear in the selected component.
- `formula`: only calculations, inclusion rules, weights, or references established by reviewed SQL, transformations, metadata, or explicit user requirements.
- `variable`: a reviewed alias or documented input needed by another visible formula. Legacy `identifier`, `field`, and `result.field` remain supported. Do not add unused symbols.
- `dependencies`: meaningful shared variable identifiers, including transitive dependencies. Leave definitions unscoped only when shared by multiple components. Optional `numerator`/`denominator` objects use verified `field` and reader-facing `label`.
- `sourceLineage`: exact tables/files present in that query's `source.tables`, `source.files`, or `source.sourceFiles`. Do not invent physical lineage for constants or precomputed scores.

Define series, thresholds, meaningful categories, populations, observation windows, and weighted factors when they change interpretation. Describe unexplained precomputed scores as supplied with unavailable methodology; omit unsupported formulas and lineage. Definitions belong in the existing source inspector and Evidence flow, not new panels or duplicated dashboard prose.

Optional asset-level `trust` metadata supports `provider`, `uniqueUsers`, `uniqueViewers`, `queryCount`, `viewCount`, `favoriteCount`, `windowDays`, `lastQueriedAt`, `usageAsOf`, `usageNote`, `verified`, and `editedAt`. Include only observed values for that asset. Record table usage according to [table usage metadata](../../../shared/table-usage.md), including its actual window, snapshot time, and counting scope. Missing usage is not zero, popularity does not establish verification, and usage/edit timestamps are not data freshness. The shared source inspector displays these fields; no authored source panel or live warehouse connection is needed.
