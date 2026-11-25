---
name: answers-follow-up
description: "Use when one to three optional next tasks would help the user get started or continue from an answer, and the current host supports follow-up prompt buttons."
---

# Follow-up suggestions

Apply the [shared Data instructions](../../shared/shared-skill-instructions.md) and the shared guidance referenced below. Use instructions already loaded for this task, including by the index or another skill; read only what is missing.

## `follow_up_pill_group`

Present one to three useful next tasks as native prompt buttons. Selecting
a button sends its complete `query` as a new user turn.

Use this widget only when the current host advertises
`follow_up_pill_group` through its available widget directory or explicit
runtime instructions. A bundled copy of this skill does not establish
runtime support. If support is unavailable or unknown, use another native
follow-up format explicitly supported by the host, or offer the next tasks
briefly in prose. Do not emit an unsupported GenUI reference.

Choose distinct, concrete tasks that fit the user's current context. Use
a short visible `label`, a unique stable `id`, and a self-contained `query`
preserving the relevant goal, artifact, and constraints. Omit optional
icons and source metadata unless their supported values are known.

Starter tasks can help when the user has not chosen a workflow. After an
answer, offer follow-ups only when they add value; do not append buttons
mechanically. Gather missing preferences or required task details through
the host's structured-input component instead of these suggestions.

Present the buttons and finish the turn. Do not execute a suggested task
until the user selects it or asks for it. Selection starts a user request;
it does not bypass any approval required for the requested action.

Invocation:
// Insert directly:
genui{"follow_up_pill_group": {"actions": {...}}}
// This widget is not eligible for UUID Mode.

Example:
genui{"follow_up_pill_group":{"actions":[{"id":"make_checklist","label":"Make a checklist","query":"Turn the project plan above into a prioritized checklist."},{"id":"compare_options","label":"Compare the options","query":"Compare the options in the project plan above by cost and effort."}]}}

Args schema:
```text
// FollowUpSuggestionGroupData
{
// Actions
//
// One to three ordered follow-up suggestions.
// minItems: 1, maxItems: 3
actions: Array<
// FollowUpSuggestionAction
{
// Id
//
// Stable action identifier used for analytics.
id: string, // minLength: 1, maxLength: 64
// Label
//
// Visible action label.
label: string, // minLength: 1, maxLength: 120
// Query
//
// Question sent as a new user turn when selected.
query: string, // minLength: 1, maxLength: 2000
// Icon
//
// Optional leading DIL icon name. Used by the pill presentation.
// default: null
icon?:
 | string // minLength: 1, maxLength: 64
 | null
,
// Source
//
// Optional stable source identifier attached to the new user turn.
// default: null
source?:
 | string // minLength: 1, maxLength: 128
 | null
,
}
>,
}
```
