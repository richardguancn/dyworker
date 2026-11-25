# Publication, sharing and security

## Publication and final delivery

Apply this policy to dashboards and reports already selected for HTML/Sites by [build-report](../../../skills/build-report/SKILL.md). It does not select or publish a Spaces report. Use the dashboard-specific Chat preview rule first, then choose app delivery from the task’s execution context. Explicit task context takes precedence over the viewing client or available tools: a cloud task opened on desktop is still a cloud task. Otherwise use an explicitly identified web or desktop surface; leave unidentified contexts unknown.

| Task                 | Default for the selected Data app                 |
| -------------------- | ------------------------------------------------- |
| Chat dashboard without a live preview | Show the [inline GenUI preview](../../../skills/build-dashboard/SKILL.md) and offer to host it on Sites. |
| Other ChatGPT web or cloud tasks, including Work web dashboards | Publish to Sites automatically. |
| Local desktop        | Open a localhost preview; publish when requested. |
| Unknown              | Publish when requested.                           |

Honor explicit no-publish, file-only, or other-destination requests. Create new Sites private to the user unless they request other access; preserve existing sharing. Existing intake gates and required tool approvals still apply.

For publication, follow [publish-artifact-to-sites](../../../skills/publish-artifact-to-sites/SKILL.md) to package and deploy the same compiled app. Complete publication only after successful deployment and return the verified Site URL with the requested supported view state. A build, preview, or saved version alone is insufficient. Check the callable Sites lifecycle before falling back: if unavailable or failed, return the verified HTML and explain the actual blocker; for a Sites-only request, report the blocker without substituting HTML.

Missing local browser inspection does not block publication; record unperformed checks in working evidence. `.openai/hosting.json` does not establish that a Site exists. The publication skill owns packaging, access, deployment, and hosted-editing verification; preserve the Site, database, and presentation, and never rebuild after final packaging.

Complete [native opening and handoff](../../../shared/output-and-template-handling.md#opening-and-report-handoff) for the finished standalone artifact before responding. A verifier's `checks: "passed"` confirms its checks. Its `preview: "stopped"` means its temporary HTTP QA server was closed; `"not-started"` means no such server was started. Neither describes the independent user preview or sidebar state.

For a verified Site or requested live project preview, open its healthy URL with the advertised host browser target and reuse the existing tab. For requested local HTML, [preview the standalone export](preview.md#preview-a-standalone-export) at the final `htmlPath`; do not substitute `buildHtmlPath`, a generic QA wrapper or an HTML source editor. A local/no-publish request alone does not prohibit opening it. Retain the [clickable final artifact link](../../../shared/shared-skill-instructions.md#links-in-the-conversation); omit an extra build or QA link. If rendered opening is unavailable or fails, return the permitted export with its link and the actual limitation. Respect no-open and inline-only requests without changing the requested format.

### Offer automatic refresh

For Sites dashboards, settle scheduling with the [publishing questions](../../../skills/publish-artifact-to-sites/SKILL.md#sites-publishing-questions) before publication. For other artifacts, after successful publication, offer automatic refresh when keeping the result current would help the user and its source can be read again without a new upload or pasted data. Skip the offer during scheduled runs, when this app already has a refresh job, or for one-time inputs such as uploaded files or sample data.

For the first result delivered through [Data onboarding](../../../skills/onboarding/SKILL.md), offer this through Visualize or its supported fallback, following the shared [follow-up contract](../../../skills/onboarding/references/workflow-selector.md#after-the-first-result). The confirmed prompt starts refresh setup for the delivered artifact; displaying the option does not create a schedule. When no interactive surface is available, use a brief plain-text offer. Do not display both offers.

When the user accepts, follow [schedule-refresh-jobs](../../../skills/schedule-refresh-jobs/SKILL.md) to collect the cadence and create and verify the cloud automation.

## Optional final consistency review

Around sharing, export or successful Site publication, or when a dashboard has accumulated interdependent views or revisions, you may briefly offer [validate-data's optional deep review](../../../skills/validate-data/SKILL.md#offer-a-deep-review). The offer explains the extra checks, whether clear material fixes are included, and the additional time. Reuse that single offer contract; skip it when recently completed or declined for the relevant scope. An unanswered offer must not delay an authorized immediate handoff, and accepting review does not itself authorize publication. Enter the deep path only on explicit request or acceptance. Ordinary authoring retains its required checks below without adding a second audit. After publication, reuse verified data identity and inspect relevant deployed behavior rather than restarting the analysis. Any authorized repair creates a new revision through normal build/package/deploy order; never rebuild or edit after final packaging.

The review distinguishes well-supported key values from assumptions or inference needing user or domain-expert vetting and checks the full “View data source” content against the chart. During ordinary authoring, reuse the applicable [analysis](../../../shared/analysis-quality.md) and [dashboard quality criteria](../../../shared/dashboard-quality.md) within the current workflow.

### Sharing selected views

Keep the canonical Site identity separate from the link shared with a reader. The canonical identity has no query or fragment; a selected-view link retains the app-generated `view`, `tab`, `f.*`, `a`, `s`, `c`, `t`, and `focus` parameters. These carry global and section filters, assumptions, chart selections, tab views, and focus. Reuse the current Data app context's `viewUrl` or the app's Copy link result; do not reconstruct selections by hand or replace the link with the bare Site URL. Component links also retain their app-generated component path. Remove unrelated query parameters, fragments, task IDs, and credentials.

Preserve this selected-view link when publishing a requested view, sharing a summary through Slack, email or documents, or including a return link in an export. Compare the delivered URL's supported view parameters with the selected source URL during provider readback; provider escaping must not lose parameter values. If the view is too large to share or only a local preview exists, explain the limitation instead of silently sending a bare or partial dashboard link. Existing access still applies, and links reflect current shared presentation and data rather than freezing them.

## Security and quality gates

Keep credentials, personal identifiers, and live warehouse connections out of artifacts. Use the public component API and embedded prebuilt runtime; do not import raw chart sources or add a second React runtime. Hosted data requests use the same-origin API. Portable HTML exports embed reviewed rows and metadata. Dashboards, app reports and downloaded HTML load their React charts from the pinned CDN.

During data preparation keep signed/access-token URLs, credentials, unapproved query parameters, and fragments out of source links and nested provenance. Preserve reviewed Google Calendar links of the exact form `https://www.google.com/calendar/event?eid=<locator>`: one bounded base64url-safe locator, default HTTPS port, no credentials or fragment. This does not permit arbitrary query strings. Direct publication preserves existing source links and metadata; its limited secret scan can detect recognizable credentials and signed URLs, but it does not replace source review or exhaustively inspect unsupported encodings, stale server assets, or source maps. Canonical Site identities stay query/fragment-free; shared Data app view links follow [Sharing selected views](#sharing-selected-views).

Before delivery, confirm material claims/definitions at the right grain, truthful filter/source/export scope, separation of actuals and assumptions, working identities/actions, and presentation separated from data. Fix or disclose missing evidence, unsupported comparisons, stale sources, and access gaps. Local/hosted delivery use the same authored code, complete reviewed data and compiled UI. A separate-data publication checkout preserves code with a verified immutable data reference; hydrate its exact snapshot before rebuilding. Reuse completed verification.

During active authoring, browsing, filters, source inspection, copying and chart exploration remain available. New presentation edits, saves, publishing and refresh requests are blocked. Paused work has a visible status and cannot publish until complete. Do not automatically reload a preview while it has unsaved edits: keep the draft open and honor its unload warning. The existing edit session is retained when authoring status changes in a mounted app.
