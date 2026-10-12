# Data inline chart live evaluations

Dashboard reference selection has a separate [dashboard-example-prompts.json](dashboard-example-prompts.json) manifest. These cases use only explicitly fictional, self-contained supplied data and never authorize publication or live warehouse access. Run each exact `prompt` alone in a fresh task against the intended installed plugin revision, with reviewer expectations kept out of the prompt. Respect any case preconditions: a draft reference must not be promoted merely to run the automatic-selection case. Compare the same prompts against the single-example baseline and candidate. Record selection/adaptation, semantic correctness, visible delivery, and browser/visual QA separately. A handcrafted table-only build or server render proves starter flexibility, not fresh-model selection. The manifest contains no run results; use the evidence record below for actual attempts.

For an explicitly authorized local maintainer comparison, read-only baseline/candidate source bundles may replace the installed-plugin condition. Record the exact revisions and whether the runtime is held constant; this tests guidance/reference adaptation, not installed delivery. Draft usage requires the same explicit development override in both conditions. Keep expectations outside author contexts and independently review generated source and calculations. Validate any existing-project seed before the run; exclude invalid seeds and permission-blocked attempts from comparative scoring rather than treating them as model failures. Browser-blocked checks remain open; do not substitute another UI route.

[inline-chart-prompts.json](inline-chart-prompts.json) holds reusable black-box prompts and separate reviewer expectations, including a text-only, fictional capacity-feedback diagnostic control. For that control, score analytical claims against the supplied observations and operating code; chart delivery and visual assertions do not apply. The suite belongs to the maintained [Data plugin](../../package.json) and its maintainers. Monorepo ownership is recorded in `chatgpt/oai-maintained-plugins/plugins/OWNERS`. It is a manual, live-service evaluation of source selection, model behavior, delivery, editing, and visual quality; it is not a new skill, renderer, or automated warehouse test.

Run the same supplied-data chart prompts on Desktop and Work Mode web when changing the shared renderer route. Verify that both use the shipped Data fragment, expose editing, and preserve recorded SQL. On Desktop outside Work Mode, verify a separate Sources receipt immediately below each chart; Work Mode retains its existing source delivery contract. A bare `charts_widget_v2` chart does not prove this path. Record any actual fallback or access limitation.

The existing catalog test spec (`chatgpt/oai-maintained-plugins/manage/applied_spec.py` in the monorepo) runs the [Data inline CI gate](../ci/run-inline-chart-ci.sh), including deterministic build and browser regressions through `npm test` and `npm run test:inline-chart-browser`. This manifest does not cause Buildkite to query a warehouse, launch model evaluations, create user tasks, or grant permissions. Run live cases only when an operator has explicitly authorized them and the required source access already exists.

## Run a case

1. Confirm the installed Data plugin revision and the intended Codex Desktop or Work Mode web build. Use a fresh, projectless task for each case with unchanged default model, reasoning, permission, and sandbox settings. Record the actual defaults and source availability; do not silently enable another provider, change a setting, or reuse prior conversation context.
2. Submit only the case's exact `prompt` string. Do not include expected routes, renderer names, tool choices, assertions, or reviewer hints in the user prompt. The optional internal Kepler control intentionally names a provider; it does not replace the source-neutral baseline.
3. Observe the run through completion or a real stop condition. Never automatically answer an approval, access request, or clarification on the user's behalf. Record `blocked` or `needs_user_input` with the exact observed reason; a legitimately blocked run is not a successful chart delivery.
4. Capture the exact task ID, final response, emitted output references, approved artifact paths, source/query identifiers, reviewed row evidence, material caveats, runtime verification and reuse, and any observed package or cache activity in an access-appropriate run ledger outside the repository. Record the actual source definition, population, filters, grain, date range, timezone, units, execution metadata, and freshness separately. Compare the final chart values with those reviewed rows rather than with a remembered or hard-coded WAU value.
5. Open the actual delivered native sandbox and inspect the rendered result. Check real React/Recharts marks, readable and distinct labels for distinct displayed axis ticks, correct units and tooltips, missing-data behavior, and light/dark and wide/narrow layouts. On Desktop outside Work Mode, exercise each chart's Sources receipt immediately below it and any final receipt for uncharted findings. Check available tabs, long-content scrolling without answer movement, keyboard navigation, exact recorded SQL preservation, explicit SQL omission, and default source-URL exclusion. For inline charts, also follow [Exercise inline editing](#exercise-inline-editing). Save permitted screenshots or observations in the run ledger; a generated HTML file or `file://` preview alone does not prove live delivery.
6. Apply the common assertions that fit the selected surface and the case-specific expectations. For multiple inline charts, verify distinct IDs/files and one real reference per chart in the same final response. On Desktop outside Work Mode, also verify distinct receipt files and one reference per receipt, each directly after its chart before following prose or charts. Inspect each receipt payload for only the corresponding findings and supporting evidence; preserve shared query context when it supports more than one chart. Observe whether the shipped, data-free prebuilt runtime was verified and reused without an npm install, network access, or customer dependency cache. A fresh-machine claim requires observed evidence; never clear a user's cache merely to manufacture it. Never place source rows, SQL, source URLs, or generated charts in the installed plugin or any shared cache.

The three-chart default-mode case expects a report. Its explicit-three-inline companion checks the user's output override. The supplied-data cases need no live warehouse and must remain visibly synthetic. `supplied-two-inline-and-uncharted-finding` checks two chart receipts plus a final receipt containing only the uncharted finding, with source isolation verified in both the delivered frames and payloads. The live-governed cases need current, governed source evidence; unavailable access must remain an explicit limitation. Do not publish reports or share private artifacts merely to complete an evaluation; inspect only reviewed SQL from authorized source executions.

## Exercise inline editing

Use the controls in the delivered sandbox. Do not send a follow-up model prompt to perform the edits being tested.

1. Record the original chart spec and reviewed source rows in the approved run ledger. Find **Edit chart** even when the original request did not mention editing. Open it by keyboard; check its accessible name, initial focus, visible focus, contained focus, and narrow/light/dark layout.
2. Change the title and a supported presentation setting, then choose **Apply**. Check that the same frame displays the change without a query or artifact rebuild. For a conventional chart, try a compatible type or an already-approved series. Compare values, nulls, units, metric definitions, provenance, hover/legend behavior, and the available source tabs against the original evidence. No excluded field, SQL, source URL, or new source access may appear.
3. Reopen the editor, make another change, and choose **Cancel**; repeat with close/Escape. The last applied chart must remain. Choose **Reset to original** and then Cancel: the last applied chart must still remain. Choose Reset to original and then Apply: the embedded original must return. An invalid or failed draft must not replace the last valid chart.
4. Apply another change and check that reopening the editor, resizing, and an ordinary rerender preserve it within the same live frame. Reload the frame or reopen the artifact and verify that it starts from the embedded original. This editor is session-only; do not report that edits were saved to the task, source file, dashboard, or backend.
5. For the two-chart case, use the two separate, actual sandbox frames. Change one chart while checking the other chart's applied spec, draft, legend selection, source data, and IDs. Then edit the other chart and reset the first. Neither operation may affect the other frame. For a specialized chart such as a histogram, verify that incompatible type/data-mapping operations are absent or explained while supported cosmetic edits still work.

For a focused editing smoke run, start with these four cases. Submit the exact prompt from the manifest; the checks remain reviewer-only.

| Case                                 | Main check                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------- |
| `chatgpt-wau-default`                | Ordinary source-backed request exposes editing without an extra prompt.            |
| `chatgpt-wau-dau-two-inline`         | Two delivered frames can be edited independently.                                  |
| `supplied-sample-editing-gap`        | Compatible types/series, missing values, Apply/Cancel/Reset, and session lifetime. |
| `supplied-latency-histogram-editing` | Specialized type/mapping restrictions and supported cosmetic edits.                |

## Evidence record

Keep one record per attempt. Populate exact IDs and references from the real run; do not infer them from a filename, invent them, or use the illustrative `null` values below as evidence. Store sensitive source rows and screenshots only in an approved location, and keep user-specific task IDs, local paths, query links, metric values, tokens, and live results out of this reusable suite. Retain `cacheObservation` for compatibility with existing ledgers; record shipped-runtime verification and reuse, the absence of customer dependency-cache writes, and any unexpected installation or package-network activity in that field.

```json
{
  "caseId": "chatgpt-wau-default",
  "attemptedAt": null,
  "taskId": null,
  "pluginRevision": null,
  "appBuild": null,
  "actualDefaultSettings": {},
  "sourceAvailability": [],
  "status": "not_run",
  "stopReason": null,
  "observedResponseMode": null,
  "finalResponseRef": null,
  "outputRefs": [],
  "approvedArtifactPaths": [],
  "sourceEvidenceRefs": [],
  "reviewedRowsRef": null,
  "materialCaveats": [],
  "cacheObservation": null,
  "sandboxEvidenceRefs": [],
  "editorEvidence": {
    "originalSpecRef": null,
    "appliedSpecRef": null,
    "controlsExercised": [],
    "sourceIntegrityRef": null,
    "lifetimeObservation": null,
    "frameIsolationObservation": null
  },
  "assertionResults": [],
  "reviewer": null
}
```

Use `passed`, `failed`, `blocked`, or `needs_user_input` only after observing the corresponding result. Distinguish source-access failures, source/metric errors, routing failures, generation failures, delivery failures, and visual defects. Include the exact failed assertion and supporting evidence; do not call a run passed merely because a command exited successfully or a task produced an attachment.

To validate the reusable manifest without running live services:

```sh
python3 -m json.tool chatgpt/oai-maintained-plugins/plugins/data-analytics/tests/live-evals/inline-chart-prompts.json >/dev/null
```
