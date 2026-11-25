# Running the local preview

### Proactively open the in-app browser

In local desktop tasks, use `open_in_codex` with a browser target at the first useful build, or before editing an existing app. After creating or updating an artifact, ensure the latest result is open in the in-app browser before final handoff, reusing and refreshing the same tab. Include the artifact link in the handoff so it remains easy to copy and share; do not rely on the user clicking it to open the preview. Honor an explicit request not to open a preview.

Serve compiled `dist` over localhost HTTP, never `file://`. In a local desktop task, use Data's preview helper after the first useful build:

If sandbox permissions block preview-state writes, login-service registration, or loopback listening, use the host's available scoped permission-request tool for the required paths and network access, then retry after approval. An initial sandbox denial is not a permanent delivery blocker; use the fallback below only if permission is denied, unavailable, or insufficient. Open the browser only after preview startup returns a healthy URL; never guess a URL after a failed start.

```sh
"<codex-node>" "<data-plugin-root>/output_formats/html/scripts/data-app-preview.mjs" start --project-dir "<absolute-app-project>"
```

The helper registers a user login service for this project on macOS (LaunchAgent), Linux (systemd user service), or Windows (Task Scheduler), serves its compiled files on loopback, and returns its stable URL and health. It keeps running after the task or Codex closes and restarts after the user logs in following a machine restart. Windows uses the current user's interactive session without administrator access or a saved password; its scheduled recovery can take up to one minute after a worker exits. Starting a requested local artifact preview needs no separate confirmation. Briefly explain that restart behavior in the handoff. This lifecycle belongs to Data; do not use Sites or a development server to manage it. Run it only on the local desktop execution host, never in a cloud task or to expose the app publicly.

Keep the returned URL and browser tab across rebuilds and future tasks. Repeated `start` calls reuse the project's registered port; use `status` to inspect an existing preview. Optional `--port <1024..65535>` selects the port on first registration or confirms the existing assignment. An occupied registered port is a failure to resolve, not permission to change the origin or stop an unrelated listener. When replacing an older task-owned server, release that server before requesting its port. If the original origin or path cannot be retained, preserve presentation through the app's supported controls and disclose any browser-local edits that cannot transfer.

```sh
"<codex-node>" "<data-plugin-root>/output_formats/html/scripts/data-app-preview.mjs" status --project-dir "<absolute-app-project>"
"<codex-node>" "<data-plugin-root>/output_formats/html/scripts/data-app-preview.mjs" stop --project-dir "<recorded-projectRoot>"
```

`stop` stops and unregisters only this project's login service, preserving its files and assigned port for a later `start`. Use it when the user asks to pause the background preview or before moving the project. Both `stop` and `remove` require the exact canonical `projectRoot` returned by `start` or `list`, which may differ from an original symlink or abbreviated path; cleanup never follows a replacement project symlink.

For requests such as “list my previews,” run `list` without a project argument. It returns every saved preview, including stopped previews and projects with missing builds, with its canonical `projectRoot`, URL, service registration, and health. Use the recorded project path to identify a preview for cleanup:

```sh
"<codex-node>" "<data-plugin-root>/output_formats/html/scripts/data-app-preview.mjs" list
"<codex-node>" "<data-plugin-root>/output_formats/html/scripts/data-app-preview.mjs" remove --project-dir "<recorded-projectRoot>"
```

For “remove the preview for X,” resolve that app from the list and use `remove`. It stops and unregisters that service, then deletes only its saved preview state, copied worker, and logs. Project files and browser data remain. Removal forgets the assigned port: a later `start` may return a different URL, and browser-saved edits tied to the old URL do not migrate automatically. Use `stop` when the URL should be retained.

Before uninstalling Data, list the saved previews and remove the specific previews the user wants cleaned up. Plugin uninstall does not automatically unregister services or delete preview state; do not sweep unrelated service jobs. Preview state and the worker live under `CODEX_HOME/plugin-data/data-analytics/previews`, outside the versioned plugin cache. Keep that machine-local state out of app content and publication.

Keep the project and resolved Node executable on disk. If a runtime update removes that executable, rerun `start` with the current Codex Node to repair the service while retaining its URL. Windows requires Windows PowerShell and permission to manage the current user's scheduled tasks; its runtime and preview-state paths must not contain `%`, which Task Scheduler expands. Linux requires a running systemd user session. If the host's policies block registration or it reports an unsupported platform or unavailable login service, explain the actual limitation. Do not request administrator access or change machine policy to install a preview. A loopback static server in the task terminal can provide a clearly labeled session-only preview; do not claim restart persistence for that fallback. Preserve the same project and follow the existing delivery policy.

If a command reports a lock conflict, wait for the active preview command or inspect the reported local listener; do not stop an unrelated service. Current locks recover after the command exits, including a crash. Older numeric lock files are retained while their recorded PID is alive because that may be an older preview command: verify the process and remove only a confirmed stale lock, never an active command's lock.

The service reads rebuilt files without automatically reloading the browser. Refresh and verify the current output when no unsaved presentation edits would be lost; keep an unsaved draft open and honor its unload warning. A healthy server does not establish rendered correctness. Navigate the same tab to the verified Site after publication. Use the available browser skill for tab control and inspection.

Current dashboard/report actions pass a short instruction and the exact view URL. Desktop handoffs also supply that URL to the existing browser pane opener. Web handoffs prepare the composer without submitting; the agent reuses or opens the exact view in the conversation browser after the user sends. Do not infer that a visible pane automatically supplies its contents to the model. Machine-local preview links require a task on the same machine; the chooser explains why they cannot open in an unrelated web task.

Read the linked page using the browser workflow below before executing the action. No transfer capture is saved, no context file is uploaded, and no composer extension is required for this handoff. Retain legacy full-text/context-attachment requests: read all supplied context, including explicit resets, without silently substituting the current page.

Links identify live data and current shared presentation with the sender's selected view, not an immutable capture. If the page changed, cannot be reached, or cannot supply required context, explain the mismatch before acting. Never reconstruct reviewed data or publication settings from the title or chart pixels alone.

Keep verified project and HTML paths in task context for exports, copies, or edits, passing them to another task only when needed. Never add local source paths to the published app. If an app action is unavailable, handle the request in the current task using that context.

When migrating a `file://` preview, carry over presentation through supplied overrides or supported app controls. Browser-saved edits do not transfer across origins or paths; retain the old tab until edits are verified, and disclose any loss.

If local serving or browser access is unavailable, provide the available artifact/link and explain any resulting access or usage limitation under the [shared handoff guidance](../../../shared/shared-skill-instructions.md#links-in-the-conversation). Do not switch to `file://`, publish, or rehost to bypass unavailable inspection. Cloud tasks follow the publication policy above; their loopback server is not a desktop-local preview.

Builds may attach transient local `CODEX_SESSION_ID` (fallback `CODEX_THREAD_ID`) for same-task handoff. Never hard-code task IDs in source, evidence, or URLs. Published handoffs start a new task; local handoffs may reuse only their valid originating task. Leave host-specific routing to the shell. Direct publication preserves existing HTML bytes, including any build-attached local task metadata; the limited secret scan does not strip metadata or establish that it is appropriate to share.

### Preview a standalone export

The persistent preview helper serves the project's `dist/index.html`. For a requested standalone HTML file, render the completed export returned as `htmlPath` instead. Use a native file-preview target only when its advertised contract explicitly renders HTML; a generic `file` target may open source.

Otherwise, on a local desktop, reuse the session-only loopback static-server path above to serve the final file unchanged, then call `open_in_codex` with a `browser` target at its exact filename URL. Confirm the server is healthy and serves the exported bytes before opening it. Keep the server alive for review and retain the final file link; describe the preview as session-only. Do not rebuild, wrap the report in another page, or substitute the project's `/` preview. If the host cannot serve or open that artifact, follow the [delivery fallback](delivery.md#publication-and-final-delivery).
