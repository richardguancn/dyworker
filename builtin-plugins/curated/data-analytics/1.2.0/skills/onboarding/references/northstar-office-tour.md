# Northstar Office tour

Use for a request to introduce or tour the Northstar Office sample dashboard or report, under onboarding's **Explore a prepared example** instructions. A request for “this sample dashboard” or “this sample report” from an older Data homepage also selects the matching Northstar format. If the format is unclear, clarify it rather than opening both.

Read the installed [example catalog](../../../assets/example-catalog.json) and append the selected path to `baseUrl`:

| Selection | Path | Follow-up artifact type |
| --- | --- | --- |
| Dashboard | `dashboard/index.html?view=1&tab=dashboard` | a dashboard |
| Report | `report/index.html?view=1&tab=report` | a report |

Both depict the same fictional Northstar Office business. The dashboard lets users explore metrics, filter by region or product, and inspect the data behind charts. The report combines findings, supporting charts, and recommendations in a written readout. Introduce only the selected format and label it as a fictional example.

The catalog's `summary` describes the pinned snapshot: revenue is higher than the prior period but below target, while gross margin is lower. It is not a dataset or evidence about the user's company. No further analysis, browsing, or dataset fetch is needed for this tour. Use the shared tour's creation follow-up with the artifact type above.

## Continue from the sample

Only a clear request to explore either example selects its data. For that request, fetch `manifest.json` relative to the installed [example catalog](../../../assets/example-catalog.json)'s `baseUrl`. Its `assets` map lists the `dashboard/snapshot.<sha256>.json` and `report/snapshot.<sha256>.json` files in that release. Download the appropriate snapshot from the same base URL and verify its SHA-256 against the manifest before analysis. Use the rows in `queries.business_review.rows`, plus the snapshot's metric and source definitions; do not infer rows from the summary alone. If the dataset is unavailable, explain that limitation rather than inventing data.

Reuse the sample's period and scope without asking already answered questions. A generic workflow choice still needs the user's source preference; exposure to the welcome does not authorize replacing their data with the sample.

The sample contains 72 rows: eight complete weeks, three regions, and three product categories. The current four weeks are August 17–September 13, 2026, compared with July 20–August 16. Dates remain fixed, not relative to the current date.

- Revenue is net of discounts; orders are counts. Revenue is higher than the prior period but lower than target—do not describe a revenue decline.
- Target is planned order growth at list price less planned discounts. The target gap is not itself the total discount amount.
- Gross margin is total gross profit divided by total net revenue; aggregate rates are weighted, not averages of row percentages.
- Region and product filters change both periods consistently. All views must reconcile to the same snapshot and definitions.
- Display the sample label and preserve source definitions in derivative artifacts. Never mix sample and real records or describe the sample as the user's company.
