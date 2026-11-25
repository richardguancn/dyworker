# Data welcome samples

Use this welcome for the main “onboard me” path: a short plugin overview, sample dashboard and report links, then workflow suggestions. It needs no connection or business-data reads. Both outputs use the same synthetic Northstar Office snapshot and label it as fictional inside the artifact. Keep that business story and its charts inside the outputs rather than repeating them in chat. This welcome does not select sample data for a later task.

## Open the hosted samples

Read the installed [example catalog](../../../assets/example-catalog.json). Its `baseUrl` identifies the same immutable release used by the Data homepage. Append these paths to that URL:

| Sample | Path | Description |
| --- | --- | --- |
| Sample dashboard | `dashboard/index.html?view=1&tab=dashboard` | Explore metrics, filter by region or product, and inspect the data behind each chart. |
| Sample report | `report/index.html?view=1&tab=report` | See how findings, supporting charts, and recommendations come together in a written readout. |

Open the dashboard once in the in-app browser beside the conversation. Verify the actual dashboard loaded using the browser's returned rendered state or one follow-up inspection. Link the report in the welcome; let the user open it. Do not run a full interaction or responsive-layout QA pass for each unchanged welcome. A successful HTTP response alone does not prove visible UI. If the browser or network is unavailable, provide the hosted links and state that the preview could not be opened. Do not rebuild, start a local server, or publish another copy of these samples.

Reuse the hosted URLs and existing tab throughout onboarding. Reload the same URL if the page needs reopening. The installed plugin contains the catalog and workflow selector; site source and demo-build tooling are not required.

## First response

1. Briefly introduce Data: it helps understand business performance, investigate metric changes, and turn findings into dashboards and reports. Connect data or upload a file to start a real task.
2. Introduce the dashboard and report using the descriptions above and their full URLs. Add one sentence labeling both as fictional examples. Describe the dashboard as open beside the conversation only after the loaded-page check succeeds.
3. Ask **What would you like to build?** and invite a custom question in chat. Copy the bundled [workflow selector](../assets/workflow-selector.html) unchanged to a durable task-owned visualization location. Follow the Data visualize-data skill's fragment validation and delivery contract and deliver its inline content reference as the final response item: **Connect my data**, **Understand what changed**, **Build a dashboard or report**. End the turn and wait for an actual choice.

Keep the overview, sample descriptions, links, and question in native chat; only the workflow selector is an inline visualization. Do not add the fictional business story, an inline chart, a Sources receipt, connection cards, an intake form, or a Skip button to this first response. The next steps belong to [onboarding](../SKILL.md), including synchronous native intake and returning from a connection detour.

## Continue from the sample

After the user explicitly chooses to explore Northstar's data, follow [Northstar Office — Continue from the sample](northstar-office-tour.md#continue-from-the-sample) for the snapshot, period, metric definitions, and source checks. Showing the welcome does not select its sample data for a later real-data task.
