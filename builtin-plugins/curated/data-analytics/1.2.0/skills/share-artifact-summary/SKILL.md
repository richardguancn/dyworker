---
name: share-artifact-summary
description: Share or provide a concise Data dashboard, report, chart, or component summary.
---

# Share A Data Artifact Summary

Share or provide a concise Data dashboard, report, chart, or component summary.

## Overall Instructions

- Before choosing or changing the deliverable, apply [presentation routing](../index/SKILL.md#output-and-presentation). For consequential missing details, use [task intake](../../shared/task-intake.md).
- Apply the [shared Data instructions](../../shared/shared-skill-instructions.md) and the shared guidance referenced below. Use instructions already loaded for this task, including by the index or another skill; read only what is missing.
- For a Spaces report, use the saved Page and relevant source subpages as the artifact context, following the [Page workflow](../build-report/docs/spaces-report.md). For dashboards and HTML/Sites reports, follow the [Data App Contract](../../output_formats/html/README.md) for source context, chart capture, and selected-view links.

## Dependencies

Before selecting evidence, apply [source selection and dependency resolution](../../shared/source-selection.md) to the categories below.

- Knowledge & Files: The selected artifact, audience context, and requested document destination.
- Internal Messaging: The explicitly selected team-messaging destination for delivering the summary.
- Email: The explicitly selected email destination for delivering the summary.

## Workflow guidance

1. Keep this interaction fast. Start with already-visible installed skills, callable tools, and the current conversation; discover deferred capabilities when needed for the requested destination. Before the first form, make no source-record calls and do not inspect the artifact, research stakeholders, read profiles, or search messages.
2. If no external delivery is requested, or no destination is named and no sharing connector is available, immediately return a concise, copyable artifact summary inline in the current conversation. Apply the source-link guardrail below without an intake form or connector calls. If the user requests a specific external destination whose connector is unavailable, follow the shared [dependency resolution policy](../../shared/source-selection.md#initial-dependency-check) to find and offer it. Prepare the supported summary while access is pending, but leave delivery unresolved and do not substitute a different destination.
3. Ask only for a missing destination, offering up to three available connectors, such as Slack, email, or Google Docs. Use only connected destinations; never default to Slack or yourself.
4. After the user chooses a connector, make at most one bounded target-discovery call to that connector with a limit of 5. Use a short artifact or project keyword already visible in the conversation. Do not run parallel searches, retry, paginate, read profiles, inspect message history, or query any unselected connector. If relevant targets are already visible, skip the lookup.
5. If the target is still unspecified, offer up to three verified targets in a second structured intake form. Use only targets returned by the one lookup or already named in the conversation. If fewer than three exist, show the real targets without inventing recipients; use the selected form's supported custom-answer control for a different target. If discovery fails or is rate-limited, ask for the target directly without retrying.
6. For genuinely missing sharing essentials, follow shared [task intake](../../shared/task-intake.md): use `form_elicitation_v2_request` or its supported fallback. The native form blocks until resolved. Preserve this skill's bounded discovery above and known destination/target choices; a later target question can depend on the accepted destination. Do not open another form while delivery is uncertain. Wait for the necessary destination and target before sending; cancellation ends sharing.
7. After a target is selected, finalize a concise summary from the current artifact context, reusing any summary prepared while access was pending, and apply the source-link guardrail below. For a Spaces report, read the relevant Page and source evidence when current context is insufficient; summarize only content appropriate for the selected audience. Preserve the authorized Page URL without implying recipients have access or changing its sharing. Deliver only through the selected connected destination and to the selected recipient or audience:
   - For Slack, export a readable image of the actual requested artifact's key metrics and primary visualization. For a Spaces report, use an available export or supported capture of its actual embedded chart; if unavailable, share the verified summary and Page link without inventing an app endpoint or publishing a replacement. For an open Data app, first use `list_data_app_cards({})` and capture the selected exact IDs with `get_data_app_card_image` or `get_data_app_card_images`, following [Card images for slides and documents](../../output_formats/html/docs/exports.md#card-images-for-slides-and-documents). Decode the returned base64 into PNG files without printing the bytes, and verify the images match the requested metrics, tab, and filters. Follow the shared [capture priority](../../output_formats/html/docs/exports.md#capture-priority): native Download PNG, then same-card capture. Only if all three app capture paths fail or are unavailable, rebuild from verified reviewed data, validate the result, and report the capture blockers and recreated charts only in the final response to the user. Preserve the entire chart or card's labels and marks; do not crop evidence to obtain a landscape preview. Attach additional focused images only when useful. Resolve the selected conversation or thread, then upload an available image with `slack_complete_file_upload`, setting `source_file`, `conversation_ids`, `initial_comment`, descriptive `alt_text`, and `thread_ts` when applicable. Include a source link permitted by the guardrail below whenever one exists.
   - For email, documents, team messaging, or another connected destination, use the corresponding provider's available capability and include a source link permitted by the guardrail below in the email body, document, or message whenever one exists.
   - Never publish an artifact, widen access, broadcast to an unselected audience, or substitute a different destination.
8. Verify delivery through the selected provider. For Slack, verify the summary and any image attachment appear in the requested conversation or thread. If delivery cannot be verified, report the exact blocker without claiming success.

## Source-link guardrail

Always include the authorized Spaces Page URL, the published Data app's selected-view link, or another already-publicly-accessible source link when one is visible in the current context. A saved Page does not need Sites publication; retain its existing access controls and do not claim the recipient can open it without evidence. For Data apps, follow [Sharing selected views](../../output_formats/html/docs/delivery.md#sharing-selected-views): keep the supported view parameters in Slack `initial_comment`, email bodies, documents, and other messages, and verify that the delivered link preserves them. For other source links, remove query parameters. Remove fragments and task IDs from all shared links. Reject URLs containing credentials, `file://` URLs, localhost, loopback, link-local or private network addresses, local preview URLs, and unpublished app links. Never make extra connector calls merely to expand link access, publish the artifact, widen access, or invent a link.
