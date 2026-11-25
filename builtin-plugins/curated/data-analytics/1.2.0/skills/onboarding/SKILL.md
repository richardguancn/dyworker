---
name: onboarding
description: Set up Data after installation or when the user asks to be onboarded, get started, or choose a first data task. Follow the main welcome, connection, and first-workflow path. For an introduction or tour of a named homepage demo, route to the Northstar Office dashboard/report, Aster Compute, or Stock watch reference. Resume requests interrupted by installation; concrete analysis does not require setup, and capability-only questions use the Data index.
---

# Set up Data

## Choose the scenario

The main path is **Initial setup** for “onboard me”, “help me get started”, or a first welcome after installation. A request to tour a particular demo takes the corresponding branch instead; read only its reference and the shared tour instructions below.

| User intent | Route |
| --- | --- |
| Onboard me / help me get started | [Initial setup](#initial-setup), then the connection and first-task sections as the user chooses |
| Introduce or tour Aster Compute | [Aster Compute tour](references/aster-compute-tour.md) |
| Introduce or tour Stock watch | [Stock watch tour](references/stock-watch-tour.md) |
| Tour the Northstar Office sample dashboard or report | [Northstar Office tour](references/northstar-office-tour.md), using the requested format |
| A concrete task, including one interrupted by installation | Resume directly with the matching focused skill; setup is optional |

Route by intent as well as the name: a request to analyze a sample or build something like it is follow-on work, not another introduction. Capability-only questions use the index's overview path.

## Explore a prepared example

For a named tour, read its single scenario reference from the table and the installed [example catalog](../../assets/example-catalog.json). The reference supplies the selected path, context, and artifact type for the follow-up; the catalog supplies the immutable base URL. No prepared-context payload or preparation tool is needed. Use the user's selection, not the most recently opened example. Clarify an ambiguous selection or a conflicting supplied preview URL.

Give a brief introduction to the example and its sample-data limitation, one or two ways to explore it, and how Data can create and refine dashboards or reports with the user's own data, with Sites available for publishing and sharing. Include one “Open dashboard” or “Open report” link using the catalog URL and selected path. The homepage attempts to open that preview; do not claim it is visibly loaded unless the host confirms that. Use the bundled context without general setup, source discovery, site inspection, another preview, rebuilding, or publishing.

Offer **Create one with my data** using this prompt, substituting the artifact type from the selected reference:

> Help me create <artifact> like this sample using my own data. Reuse any source and requirements I have already provided, and ask only for essential information you cannot recover.

Render it as `- :codex-followup[Create one with my data]{prompt="<prompt>"}`, escaping quotes in the attribute. If unsupported, invite the user to ask for that follow-up in chat. Wait for the submitted message before starting work or connecting a source. A creation request follows normal [task intake](../../shared/task-intake.md) and the selected workflow, reusing supplied sources and requirements. Viewing a sample does not select it for later real-data work.

## Initial setup

For this main onboarding path, read and follow the [shared Data instructions](../../shared/shared-skill-instructions.md), including task preferences. For this and all shared guidance below, reuse instructions already loaded for this task; read only what is missing. Help the user see what Data can do, connect useful data, and complete a first workflow in the current conversation. Setup is optional; do not create a persistent onboarding checklist.

The first welcome uses only this section and its welcome reference. Later sections apply after an actual choice. **Connect my data** stays in its connection flow. Once a concrete task is selected, start its focused skill directly and use [task intake](../../shared/task-intake.md) for any consequential missing details; there is no need to open the index first.

Reuse the original request, supplied files, source restrictions, and choices already made. If installation interrupted a concrete task, load the workflow guidance in this section, briefly explain how Data can help with that task, and continue through the selected Data workflow. Do not ask the user to choose a different task or restate the request.

For open-ended setup, read the [welcome samples](references/business-review-demo.md) and [visualize-data](../visualize-data/SKILL.md) in full, batching those reads and reusing them if already loaded. Read the shared example catalog to open the hosted dashboard and link the report, and copy the bundled workflow selector as described in that reference. These are the only additional instructions needed before the first choice: defer the index, artifact-authoring references, personalized selector guidance, and Figma selector guidance. Use the pinned sample URLs without building a site or starting a server. Do not fetch the sample dataset unless the user chooses to explore it. No source discovery or business-data reads are needed.

Start with a short overview of what Data helps the user do. Then introduce the sample dashboard and report with a concise description and link for each, following the sample reference's delivery and browser checks. Open the dashboard beside the conversation by default; leave the report available through its link. Label both as fictional examples in one sentence; retain that label inside each output. Keep the business story, charts, and source details inside the sample outputs; do not add an inline chart or Sources receipt to the welcome. Opening either sample is not a selection of sample data for a subsequent real-data task.

End with **What would you like to build?** and show **Connect my data**, **Understand what changed**, and **Build a dashboard or report**, in that order. Invite a custom question. Do not show connection cards or start source discovery before this choice. Reuse the prepared samples and existing browser tab on follow-up; do not replay the welcome.

Omit Skip buttons. Honor a typed request to skip or stop setup. Use the capability-checked fallback in [workflow selectors](references/workflow-selector.md) only when Visualize is unavailable. Dismissal, canceled confirmation, or no answer does not select a workflow or count as **Skip set up**. Upload remains available through the normal composer and chat; a prompt button is not a file-picker action.

## Connect my data

Treat this choice as a request to show the native multi-plugin connection UI. Do not first ask which provider the user uses through `request_user_input`, async questions, or another Visualize selector. Follow [source setup and native connection controls](../../shared/source-setup.md#native-connection-controls): inspect relevant visible or discoverable capabilities, including custom MCP tools, and reuse useful existing connections. Make one bounded discovery pass using workspace recommendations or one or two focused Plugin Management searches, requesting enough candidates to select ten after eligibility filtering. If no provider is named, discover **Data Warehouse** integrations first, then other relevant data sources such as BI, product analytics, business systems, or spreadsheets. Rank suitable warehouse providers ahead of other categories. Within each group, use explicit catalog popularity metadata when available, adjusted for the user's workspace and task; otherwise use relevant workspace recommendations and search results without claiming a measured popularity ranking. Prefer production data connectors over demo/test integrations unless the user's context calls for those. The grouped connection cards are where the user chooses among them.

Present **ten eligible non-pending providers** together when ten suitable options are available, with warehouse integrations first and remaining slots filled by other relevant sources. Use one `suggest_plugins` call with a single `plugin_ids` array of exact accepted references in that priority order. Use fewer when fewer are relevant, the user named only one provider, or the service enforces a smaller batch limit; never pad the set with irrelevant, installed, or pending plugins, and do not split a multi-provider offer into serial calls. This onboarding-specific ten-option policy takes precedence over the shared six-option workflow limit and Plugin Management's generic smaller-set preference. Let the host own the grouped cards, provider selection, installation, and sign-in. Do not read business records merely to populate suggestions or claim organization-specific ranking without metadata. If no eligible providers remain and no setup is pending, briefly explain existing connections or the discovery limitation. Offer the two workflows below only if none is selected; otherwise preserve the selected workflow and continue supported work or explain the remaining source gap. Do not substitute a provider questionnaire. Follow the shared older-client fallback if the native suggestion tool is unavailable.

Introduce the cards as starting suggestions and always make broader discovery clear, including when fewer than ten can be shown. Suggested copy: "Connect a data source to start working with your data. Here are some starting points; you can browse all available connectors in the Plugins tab or ask me for a specific connector here in chat." If no cards can be shown, retain the browse-or-ask guidance alongside the connection status or limitation. A request for a specific connector triggers focused discovery and the same native connection flow; preserve the current workflow and previous answers.

Follow [source setup](../../shared/source-setup.md#wait-for-required-connector-setup) for pending, completed, declined, or failed access, and [task intake](../../shared/task-intake.md) for independent work and waiting. Do not follow unresolved connection cards with another intake. After verified connection, resume the selected workflow; if none is selected, offer the two workflow choices below without replaying the welcome.

## Suggested first task

The unchanged first welcome uses the bundled selector directly. For later or personalized selectors, use Visualize with **Workflow suggestions** in [workflow selectors](references/workflow-selector.md), the [Figma reference guidance](references/visualize-design.md), and the bundled [selector template](assets/workflow-selector.html). Preserve its vertical icon-pill layout. The opening selector contains the connection action first, then these two workflows. After connection, keep only the two workflows. Personalize concise labels and user-facing prompts when useful:

| Workflow | Default label | Workflow intent |
| --- | --- | --- |
| Metric diagnostics | Understand what changed | Identify the metric, comparison, and source; investigate the supported drivers. |
| Artifact creation | Build a dashboard or report | Establish format, subject, and source; create the selected dashboard, written report, or presentation. |

A confirmed follow-up message or typed choice starts the selected route; rendering or clicking a button alone does not. Do not invent metrics, sources, connection state, or authorization to schedule or share. Show both workflows even without a connected source. When the data source is unresolved, follow the shared [source recovery choices](../../shared/source-setup.md#when-no-usable-source-remains): offer connection, upload, and the welcome sample subject to its availability, prior-decline, and pending-setup rules. Clicking a generic workflow does not implicitly select the sample. Explicit requests to explore either welcome output reuse its rows, period, and definitions through the sample reference, without repeating known intake. Apply the same no-source route to another real-data task with insufficient access; never substitute the welcome's fictional data without an explicit sample choice. Pending connection is not a decline.

## Gather details and deliver the first result

A submitted workflow choice or custom question starts the matching focused skill. For example, **Build a report** starts [build-report](../build-report/SKILL.md), using the known subject, source, and requested format. Use [task intake](../../shared/task-intake.md) for whether to proceed, ask while working, or wait; workflow selection does not require a setup form or reading selector mechanics.

### Continue the selected task

Continue directly with the focused skill and any requested delivery skill. Start a confirmed task or a free-text question with the supplied data or existing connection; retain prior answers, scope, and source restrictions. Verify new access and resume without a second setup or upload question. If usable evidence is still missing, follow [source access recovery](../../shared/source-setup.md#when-no-usable-source-remains), distinguishing pending, declined, and skipped setup. A dismissed or unanswered choice starts nothing.

After delivering the result, offer one useful next step when supported by the evidence. Use the [workflow selector contract](references/workflow-selector.md#after-the-first-result) for a concrete deeper analysis or artifact refinement. For an eligible published report/dashboard, use [Offer automatic refresh](../../output_formats/html/docs/delivery.md#offer-automatic-refresh); other repeatable analyses follow the shared [automation offer contract](../../shared/automation-offers.md). Reuse that one offer, without adding a duplicate automation button. Rendering a suggestion never creates a schedule or performs the suggested action.

### Continue with sample data

Use the sample the user named, explicitly selected, supplied, or is continuing. Preserve its actual rows, period, scope, and definitions across workflows, including “make a report using that sample.” If it cannot be retrieved, say so; never silently substitute another dataset. Showing a welcome example or selecting a generic workflow does not choose sample data.

An explicit “use sample data” starts immediately, without a workspace search or another confirmation. In this welcome flow, the default is [Northstar Office’s snapshot](references/northstar-office-tour.md#continue-from-the-sample), unless a different sample was selected or supplied. Outside onboarding, only if no sample identity is established, use the bundled [demo-product-growth.csv](../../assets/demo-product-growth.csv). Label it synthetic, analyze the actual rows with [product-business-analysis](../product-business-analysis/SKILL.md), and honor the requested output.

## Skip or finish setup

- On **Skip set up**, stop setup questions and connection offers for the current request, including when handing off to focused skills. Resume the original task, if any, with the data and tools already available. Skipping does not grant source access or authorize substituting sample data for a real-data question. If required evidence is missing, explain the gap and ask for the smallest useful upload or export without reopening setup. Offer connections again only if the user asks to connect a source or resume setup.
- If there is no original task, acknowledge the skip and invite the user to ask a data question whenever ready; do not launch an analysis or another intake form.
- When a connection completes, refresh the relevant tool discovery and continue the same task. Let the first necessary source read verify access; do not claim that installation alone made the data available.
- Read relevant existing context for the selected task under the shared [Authoritative metrics and definitions](../../shared/metric-definitions.md) policy. Create or save preferences only when the user requests it, through [Customize Data Plugin](../customize-data-plugin/SKILL.md). Saved context is not a prerequisite for finishing setup.
