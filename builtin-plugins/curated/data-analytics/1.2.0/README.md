# Data

## Where to review the rendering paths

- Visualize owns new inline charts and interactive calculators. Data authors charts in durable artifacts, including native Page embeds. Saved reports and dashboards keep their pinned runtime and export support.
- [Build Dashboard](skills/build-dashboard/SKILL.md) owns dashboard composition and its defaults. The [dashboard entry point](output_formats/html/prepare-dashboard.mjs) prepares its React starter.
- [Build Report](skills/build-report/SKILL.md) owns the report’s format, editorial structure and [native Page conventions](skills/build-report/docs/spaces-report.md). Its [HTML instructions and starter](output_formats/html/report.md) generate a complete editable report.
- [HTML output](output_formats/html/README.md) owns the shared React shell, components, build and export. Exported HTML embeds the data and loads the visualize-data chart release over the web. [Native Page output](output_formats/space_page/guide.md) covers Page creation and readback.


Data helps you answer product and business questions with data you can trust, then turn the findings into shareable reports, charts, dashboards, notebooks, and recommendations.

## When to use this plugin

Use Data when a product or business decision depends on metric-backed evidence: understanding performance, explaining a metric movement, deciding where to focus, defining KPIs, checking whether data is reliable, or sizing an opportunity. Start with connected warehouses, BI or product analytics tools, docs, chats, spreadsheets, uploaded files, pasted results, or clearly labeled sample data.

## Get started

Try asking:

`@Data Help me get started with my first data task`

Ask `@Data Help me set up Data`, or choose **Set up** when your host provides that entry point. [Data onboarding](skills/onboarding/SKILL.md) uses [Figma-based Visualize workflow buttons](skills/onboarding/references/visualize-design.md) that send concise follow-up prompts through the host's confirmation flow. Shared [task intake](shared/task-intake.md) distinguishes non-blocking questions, narrowly justified blocking interactions, and final-answer caveats and next offers. Tool choices follow host availability; task preferences and reasonable defaults apply without saved Data settings. Useful optional app connections use Plugin Management's native installation and sign-in controls. It helps complete a first analysis, metric investigation, report, or dashboard. You can also upload data, paste results, or try clearly labeled sample data. Say **Skip set up** at any point to continue without onboarding. If you installed Data during a task, setup returns to that request. Hosts without Visualize use supported shared workflow buttons or chat; installing this plugin alone does not enable an unsupported renderer or launch gate. Automatic post-install launch also requires host support for the declared onboarding entry point.

Already have a focused task? Start directly with one of the workflows below.

In Codex, highlight **Data** in the `@` menu and press **Tab** to choose **Create a report**, **Create a dashboard**, or **Analyze data**. Choosing an action fills the composer; review and send the request when ready. Data reuses the context you have already provided, clarifies the use case when needed, and looks for relevant connected sources before offering other ways to supply data.

Use the shared [output-format policy](shared/output-and-template-handling.md#output-format-selection): the [index](skills/index/SKILL.md#output-and-presentation) keeps ordinary answers inline and adds a report for three or more distinct questions unless the user selects another format. Reports/documents prefer Pages with HTML fallback, and dashboards prefer HTML when requested. Explicit formats, user-selected templates, and existing revisions take precedence. Automatically chosen templates preserve the selected format. Available tools and authorization govern fallbacks; saved Data settings are not consulted.

Local HTML previews use Data's own per-project login service on macOS, Linux, and Windows. Their URL remains stable after Codex closes and after you log back in following a restart. Windows uses a per-user scheduled task without administrator access. Ask Data to “list my previews,” “stop the preview for X” to retain its URL, or “remove the preview for X” to clean up its service and saved preview state. Removal preserves project files and browser data, but a later start may use a new URL without automatically carrying over browser-saved edits. Before uninstalling Data, list your previews and remove the specific ones you want cleaned up; plugin uninstall does not do this automatically. See the [local preview lifecycle](output_formats/html/docs/preview.md#proactively-open-the-in-app-browser) for commands and session-only fallback behavior.

## Task intake

Data defaults to best-effort delivery and asynchronous clarification when useful. Blocking forms are reserved for missing required sources that prevent meaningful progress or an explicitly requested interaction or pause. The shared [input policy covers non-blocking, blocking, and final-answer clarification, with tools and examples](shared/task-intake.md); [templates and prior work](shared/templates-and-prior-work.md) covers template discovery and prior work.

For long reports, analyses, and dashboards, search relevant installed templates and useful references. Offer the best verified matches with a recommendation in necessary clarifications. When differences only affect presentation, use a suitable default and proceed. Preserve explicit format/source restrictions and selected template identities. Discovery failures or missing previews do not block useful work.

When needed, `form_elicitation_v2_request` groups only the necessary questions. It blocks until accept, decline, cancel, or error; optional fields do not make it asynchronous. Reuse answers and continue supported work with stated defaults after skipped preferences without reopening setup. Silence or cancellation is not a user selection or permission for additional work. Selected file identities require a successful read in the task environment; the form does not transfer laptop CSV bytes to a remote task. Installation and sign-in use existing Plugin Management controls separately.

Compared with the preserved experimental form, this baseline does not provide a plugin-owned persistent async widget, draft/receipt continuation, CSV byte transfer, inline Other, conditional questions, custom preview delivery, or embedded plugin installation. Native form capability must be negotiated; unavailable hosts use supported native/chat fallback. See [task intake](shared/task-intake.md) and the [native contract](mcp/forms/README.md).

## Homepage history

The homepage stores opened example IDs and used suggestion IDs in local browser storage. Successful launches update the history; failed or canceled navigation does not. Reopening the homepage retains “Opened before” badges and moves used suggestions behind unused ones. Only allowlisted IDs are stored. Hosts that deny storage remain usable with session-local history.

This release has no settings controls, settings MCP capability, settings tools, or saved preference reads. Old settings files remain untouched. Task preferences and selected templates guide the work; output defaults and installed capabilities determine suitable fallbacks.

## One Data MCP runtime

The canonical `data-analytics` plugin declares one MCP server named `data`, displayed as **Data**, with these tools on one connection:

| Family             | Model tools                                 | App-only tools    |
| ------------------ | ------------------------------------------- | ----------------- |
| Native elicitation | `form_elicitation_v2_request`                | None              |
| Composer actions   | None                                        | `search_mentions` |
| Homepage           | None                                        | `data_home` |

Call discovered tool names, which the runtime may qualify. There are no plugin-owned form widget resources or callbacks on the default path. Other Data artifact functionality remains in the plugin's existing skills and runtime.


The homepage provides suggested tasks, bundled connector recommendations, and Aster investigation, report, and stock examples; onboarding also offers the Northstar dashboard. Suggested tasks open new chats using @Data; prepared examples open beside a chat with an introduction and follow-up button. All four examples open immutable CDN URLs automatically in the desktop sidebar through the new chat’s `browserUrl`. Aster and Northstar use fictional data; Stock watch uses illustrative prices and scenarios. Opening an example does not build a site or start a local server.

The homepage consumes `data_home`'s initial inventory result without a duplicate request. Provider cards use loading placeholders while the rest of the page renders immediately. Returning to the tab or opening the provider manager refreshes inventory while retaining the last successful cards and installation badges. Hosts without the inventory bridge use bundled recommendations without installation claims. Examples open immutable CDN previews with bundled context directly; no preparation tool or local example files are needed.

The installed runtime lives in `mcp/dist` and starts through `mcp/launch` or `mcp/launch.cmd`. It requires Node 22 or newer, including a supported host-provided runtime, and installs no dependencies at launch. Native forms live under `mcp/forms`. The plugin is not desktop-only: `requires_local_executor` remains false, and its skills can run on web or other hosts. Homepage and native-form support depend on the host's MCP capabilities; neither blocks ordinary skill workflows. There is no hosted Data App or Habitat dependency.

A locally replaced package can update the discovered resource URI while an existing desktop MCP session still serves the old resource. Restart the desktop after updating the local test package if the homepage reports “Unknown resource”; do not serve different HTML under an old content hash.

Build and package with the release-baseline MCP Extensions SDK, license notices, and source/artifact hashes. Ship generated assets through the maintained catalog's blob-data workflow and commit its hash manifest alongside source changes. Start a fresh task after installing a rebuilt candidate and ensure review evidence matches its source revision and package hashes.

The maintainer [CDN and release guide](scripts/data-examples-cdn.md) covers the demo routes, staging and production updates, and plugin packaging. From this plugin root, run `node scripts/prepare-data-plugin-release.mjs --dependencies /absolute/frozen-publisher --output /absolute/new/data-analytics` to build, verify, and package the plugin. This excludes maintainer-only scripts, the release guide, and onboarding demo source; pass the prepared directory to the publisher, which does not invoke the packaging filter itself.

From the plugin root, after preparing the shared frozen publisher dependencies:

```sh
node mcp/build.mjs --dependencies /absolute/publisher
node mcp/build.mjs --dependencies /absolute/publisher --check
node mcp/package.mjs --output /absolute/output/data-analytics
```

The generated `mcp/dist` contains `server.mjs`, `home.html`, `sidebar-icon.svg`, `manifest.json`, and `THIRD_PARTY_NOTICES.txt`. Debug preview controls are opt-in at build time with `DATA_HOME_PREVIEW_CONTROLS=1` and remain disabled in release builds. Keep package output outside the source tree. Focused validation lives in `mcp/forms/tests`, `tests/data-mcp.test.mjs`, `tests/home.test.mjs`, browser history/connection smoke tests, and the instruction contracts. Synthetic protocol responses prove contract behavior, not rendered native UI or an end-to-end model journey.


## Example workflows

| Workflow                               | Try this                                                                        | Skill                       | Result                                                                                                                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Analyze a product or business question | `Analyze activation and recommend where to focus next`                          | `product-business-analysis` | A decision-ready analysis with evidence, measurable opportunities, and a clear recommendation                                                                                                                     |
| Diagnose a metric movement             | `Diagnose why weekly active users dropped last week`                            | `metric-diagnostics`        | A calibrated explanation of verified drivers, likely contributors, unresolved questions, and next actions                                                                                                         |
| Design KPIs                            | `Design a KPI framework for this new product area`                              | `design-kpis`               | A measurement plan with outcome metrics, drivers, guardrails, targets, and validation priorities                                                                                                                  |
| Prepare a KPI readout                  | `Turn this month's metrics into a leadership-ready operating update`            | `kpi-reporting`             | A concise KPI update with actuals, comparisons, validated drivers, and operating implications                                                                                                                     |
| Build a dashboard                      | `Build a dashboard for monitoring activation, retention, and conversion`        | `build-dashboard`           | A source-backed dashboard with metrics, filters, visual hierarchy, QA, and handoff                                                                                                                                |
| Size a market                          | `Estimate the market opportunity for this product and show the assumptions`     | `market-sizing`             | A transparent market or opportunity sizing estimate with sensitivity, uncertainty, and validation priorities                                                                                                      |
| Build an analytical report             | `Create an executive report explaining the biggest growth drivers this quarter` | `build-report`              | A report in the explicit or saved preferred format; Automatic prefers Spaces Page with answer-first narrative, embedded charts, and claim/chart source subpages, then HTML or another suitable supported fallback |
| Explain or visualize inline | Show the measured change over time | Visualize | A native chart beside the finding when it helps. |
| Create a notebook                      | `Build a reproducible notebook for this experiment readout`                     | `jupyter-notebooks`         | A reproducible SQL or Python notebook with purposeful charts, concise takeaways, and saved outputs that can be skimmed and rerun                                                                                  |
| Validate an analysis                   | `Check this analysis`; `Do a deep review of this dashboard`                     | `validate-data`             | Heavy review and verified material repairs for explicit validation requests; normal checks within other workflows or when explicitly requested; audit-only when requested                                         |
| Assess data quality                    | `Check whether this table is reliable enough for our retention analysis`        | `analyze-data-quality`      | A source-backed quality assessment covering grain, freshness, missingness, duplicates, joins, and material risks                                                                                                  |
| Customize Data                        | `Save my report style and preferred tools for future work`                      | `customize-data-plugin`     | Saved plugin defaults or reusable working guidance for personal or team use                                                                                                                                     |

## Customization and data context

[Customize Data Plugin](skills/customize-data-plugin/SKILL.md) creates explicitly requested reusable tool, style, or workflow conventions in scoped skills. Existing user-created context skills remain usable, including combined definitions and working preferences. See the [customization sample](skills/customize-data-plugin/references/sample-context-skill.md) and [packaging guidance](skills/customize-data-plugin/references/packaging-and-sharing.md) for reusable conventions.

Data follows the shared [Authoritative metrics and definitions](shared/metric-definitions.md) policy before selecting sources or interpreting metrics: use task-selected context and applicable context skills first. When neither supplies the needed definitions, check applicable first-party domains, then discover business context live. Local paths, connected documents, and context skills remain valid task inputs. Ordinary analysis does not require saved-context setup.

Focused workflows gather missing [business context](shared/metric-definitions.md#business-context) only when it could change the analysis. Newly gathered context stays scoped to the current task. For a context-only request, Data returns a focused cited note; requests for analysis or an artifact continue into the selected workflow.

## Integrations

Data can use available tools when they are connected:

| Source                              | Supported integrations                                                       | What they unlock                                                                                  |
| ----------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Warehouses and query tools          | Databricks, Databricks Genie, BigQuery, Snowflake                            | Schema inspection, query-backed analysis, and source-grounded metric investigation                |
| Product analytics and BI            | Amplitude, Mixpanel, PostHog, Omni Analytics, Metabase, ThoughtSpot, Statsig | Behavior analysis, dashboard context, experiment evidence, and reusable reporting inputs          |
| Notebooks and analytical workspaces | Hex, Deepnote                                                                | Reproducible analysis, notebook handoff, and shared analytical context                            |
| Docs and collaboration              | Google Drive, SharePoint, Notion, GitHub, Slack, Microsoft Teams             | Business definitions, source-of-truth documents, implementation context, and stakeholder evidence |
| Email and calendar                  | Gmail, Outlook Email, Outlook Calendar                                       | Supporting context for stakeholder questions, operating cadence, and analytical handoff           |

You can also start with spreadsheets, uploaded files, pasted query results, schema descriptions, or manually provided business context.

## Inspect inline answers

Warehouse results and other substantial evidence use a Sources widget when inspection materially builds trust; simple lookups use concise citations. Outside Work Mode, a warranted Sources receipt starts collapsed. It covers distinct supported findings from both charts and prose, with each finding's evidence kept in its own card. The collapsed row reads `Sources` for one finding and `Sources • N` for multiple findings, where `N` counts finding cards. Expand a receipt to inspect optional assumptions, recorded definitions, filters, sources, preview rows, SQL/Python or calculations, and evidence when available. Source types and recorded purposes are available in hover/focus tooltips. The receipt uses the dashboard/report source inspector in a compact card layout and preserves existing chart source buttons. See [Inline Sources receipt](skills/visualize-data/docs/rendering/inline-sources-receipt.md) for its evidence and delivery contract. Work Mode retains its existing rendering path.

## Maintaining authoring guidance

Change each rule at its owner and link to it from the decision that needs it. The [index](skills/index/SKILL.md#shared-instructions-table-of-contents) owns the complete shared-reference map; this table identifies authoring owners.

| Guidance                                                                                        | Owner                                                                |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Universal instructions for every workflow                                | [Shared skill instructions](shared/shared-skill-instructions.md)     |
| Native optional setup, workflow suggestions, first result, skip, and original-task continuation | [onboarding](skills/onboarding/SKILL.md)                             |
| Workflow selectors and next-task suggestions | [Onboarding selector](skills/onboarding/references/workflow-selector.md) |
| Reusable working conventions and context packaging                                  | [customize-data-plugin](skills/customize-data-plugin/SKILL.md)       |
| Report analysis, composition, and next-step selection                                           | [build-report](skills/build-report/SKILL.md)                         |
| Spaces report layout, citations, source subpages, and verification                              | [Spaces reports](skills/build-report/docs/spaces-report.md)    |
| Report wording and presentation examples                                                        | [narrative-style](skills/build-report/docs/narrative-style.md) |
| Dashboard composition and monitoring behavior                                                   | [build-dashboard](skills/build-dashboard/SKILL.md)                   |
| Quantitative figures in durable reports, notebooks and dashboards | [visualize-data](skills/visualize-data/SKILL.md) |
| Inline charts, calculators and interactive explainers | Visualize, with reviewed calculations and provenance from Data |
| Notebook structure, visual presentation, and execution                                          | [jupyter-notebooks](skills/jupyter-notebooks/SKILL.md)               |
| Requested analysis reviews, verified important repairs, and audit-only assessments              | [validate-data](skills/validate-data/SKILL.md)                       |
| Reusable source, calculation, methodology, and conclusion checks                                | [Analysis quality criteria](shared/analysis-quality.md)              |
| Reusable component, source-details, interaction, and presentation checks                        | [Dashboard quality criteria](shared/dashboard-quality.md)            |
| App data representation, provenance, runtime, revision, and delivery                            | [Data App Contract](output_formats/html/README.md)                              |
| Copied-app APIs and runtime constraints                                                         | [template AGENTS.md](output_formats/html/templates/AGENTS.md)              |

Keep essential decisions in the owning skill; load references for conditional detail and examples. The copied app retains the API constraints needed to revise it independently. Worked examples illustrate these rules, not alternate instructions or mandatory outlines. Keep development plans, review logs, and validation receipts in the PR or local working artifacts, not in the installed plugin.

## Preparing a release

For requests to deploy, publish, push, or prepare a Data release, follow the maintainer [release procedure](RELEASE.md). Build the lightweight package, validate its actual output, check that the target remote version is unused, and report readiness before deployment. Do not pass the unfiltered source tree to the publisher.

Data owns visualization components and their CDN release pipeline. See [skills/visualize-data/CHART_RELEASES.md](skills/visualize-data/CHART_RELEASES.md) for build, qualification, publication, versioning and the temporary shared CDN prefix.
