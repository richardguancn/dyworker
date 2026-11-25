# Workflow selectors and next-task suggestions

Use this for onboarding workflow buttons and an optional next task after a completed result. [Task intake](../../../shared/task-intake.md) owns clarification; [source setup](../../../shared/source-setup.md) owns provider connection. A selected workflow starts its focused skill directly.

Use the Data visualize-data skill and its supported output surface. For GenUI, runtime widget-directory results or explicit host capability instructions establish support; bundled helper skills or the app name alone do not. Make a bounded component lookup when exposed and needed; never emit unsupported widget references.

## Workflow suggestions

For open-ended onboarding, follow the onboarding skill's short overview and sample dashboard/report links, then render **Connect my data**, **Understand what changed**, and **Build a dashboard or report** with Visualize. After a completed connection, show only the latter two choices. Open native connection cards after the user chooses the connection route or requests a source needed by a selected workflow; the welcome samples need no connection. Invite a custom question and do not add a Skip button.

If Visualize is unavailable, use supported `follow_up_pill_group` buttons. Otherwise offer the prompts in chat and end the turn. Keep question tools for the follow-up intake below. A submitted option or free-text question selects the workflow; an explicit typed skip ends setup, while dismissal leaves the choice unresolved.

Do not start a workflow because an option is preselected, a timer expires, or an optional question returns no answer. A missing answer leaves the task unselected; invite a typed choice without repeating the picker. An explicit **Skip set up** response follows the onboarding skill's skip behavior. Once a workflow is selected, continue it rather than asking the same choice again.

The `codex-followup` directive is not the opening workflow selector. Some desktop builds advertise its syntax while a separate renderer experiment displays the labels as plain text; when enabled, its artifact links prefill a draft rather than submit a selected workflow. Neither formatting instructions nor a directive's presence in plugin files establish interactive support.

### Visualize option selector

Read the Data [visualize-data skill](../../visualize-data/SKILL.md) in full before creating or updating a selector, then read the [Figma design references](visualize-design.md). Copy the bundled [workflow selector](../assets/workflow-selector.html) into an explicitly writable, durable task-owned visualization location. Preserve its design-specific scaffold and scoped styles; the workflow selector is a vertical stack of icon pills, not generic horizontal chips. Personalize the visible labels, accessible names, typed fallback, and complete prompts for the current conversation. Use a distinct root ID for each selector. Follow the active skill's fragment and delivery contract; emit the actual `visualize` content reference in the final response, then end the turn. A code fence, downloadable HTML link, or promise of buttons does not deliver the selector.

Each workflow button calls `await window.openai.sendFollowUpMessage({ prompt, title })`. The prompt must name the chosen workflow and include useful known task context in a concise user-facing request. Do not put internal onboarding or tool-routing instructions in the message. The host owns confirmation. Do not bypass it, infer submission from promise resolution, or show a selection as accepted before the resulting user message arrives. Keep the controls usable after cancellation or failure, and prevent duplicate calls while confirmation is pending. A missing bridge must leave a clear typed-response fallback.

Never start a workflow on render, restore, timeout, preselection, or `setWidgetState`. Widget state is optional presentation state, not a submitted answer or authorization. Keep all information needed to continue in the follow-up prompt; state delivery to the model is best-effort. Canceling confirmation leaves setup unresolved. Honor typed requests to stop or skip setup. The selector does not install plugins, authenticate, open a file picker, query sources, publish, or schedule work.

For one optional next task, retain one workflow-style pill and remove the opening workflow controls. Do not redisplay the opening menu. Use the shared task-intake route for unresolved details or explicitly requested choices.

### Shared follow-up component

When Visualize is unavailable and `follow_up_pill_group` is explicitly supported, read the bundled [Answers follow-up skill](../../answers-follow-up/SKILL.md) and render it inline in the final response. Each group contains one to three actions with unique `id`, visible `label`, and a complete `query` sent as the next user message. Preserve the same opening connection action and two workflows, or the two workflows after connection. The same component can suggest a next step after a completed workflow; it is not onboarding-specific.

The inline invocation has this shape; replace the example with the actual suggestions and emit it without a code fence:

```text
genui{"follow_up_pill_group":{"actions":[{"id":"connect_data","label":"Connect my data","query":"Help me connect my data sources to Data."},{"id":"investigate_change","label":"Understand what changed","query":"Help me investigate a metric change. Reuse any metric, comparison, and source I have already provided."},{"id":"create_artifact","label":"Build a dashboard or report","query":"Help me create a report or dashboard. Reuse the context I have provided and ask only for essential information you cannot recover."}]}}
```

Omit optional icon and source fields unless the active widget instructions supply appropriate values. Rendering a suggestion does not select it, start the analysis, grant source access, or authorize an external action. Wait for the resulting user message before doing work dependent on that choice. A custom typed question is equally valid.

Prefer the active host contract when it differs from these examples. These buttons use `inline_run`: emit the complete invocation directly in the final response, without an extra rendering tool call or a fabricated widget UUID. Rendering ends the turn; wait for the resulting user request.

## After the first result

Use Visualize for one concrete next step supported by the completed answer or artifact, following the same support check and confirmed follow-up contract as the opening selector. If unavailable, use supported `follow_up_pill_group` or describe the optional next step in prose. A `codex-followup` artifact link is a draft suggestion, not a submitted task. Carry the artifact's identity and relevant context into the prompt. Do not offer work already completed, imply unverified findings, or create a scheduled job merely by displaying its suggestion.

For an eligible report/dashboard, follow [automatic refresh](../../../output_formats/html/docs/delivery.md#offer-automatic-refresh). Other repeatable analyses use the [automation offer contract](../../../shared/automation-offers.md). Reuse that one offer without a second generic follow-up; displaying it does not authorize scheduling.
