# Data native form elicitation

`form_elicitation_v2_request` collects answers in one **blocking** native form. Even with `required: false`, the tool and task runtime wait for final submission. Use it only when missing required source material prevents meaningful progress, the user requests a form/picker, or the user explicitly asks to wait. Otherwise follow [task intake](../../shared/task-intake.md): continue useful work and prefer a non-blocking clarification.

Never proactively block on template selection. [Templates and prior work](../../shared/templates-and-prior-work.md#templates-and-prior-work) owns discovery and automatic choice; when the user asks or accepts an offer to choose, use only a rich `resource`/`resources` picker, not async or plain-choice questions. Plugin installation and sign-in use the host's Plugin Management flow.

## Choose a question type

| Type | Use | Answer |
| --- | --- | --- |
| `text` | Free text | String |
| `single_select` | One option | Exact option ID |
| `multi_select` | Several options | Array of distinct option IDs |
| `resource` | One template or previous analysis | Exact offered URI |
| `resources` | Several references | Array of distinct offered URIs |
| `files` | Upload chosen, or a referenced uploaded file is missing | Array of offered or user-selected local file URIs |

Use real discovered resources for resource questions. File selection does not transfer bytes to another host; verify that the selected resource is readable in the execution environment.

## Compose the form

Include only current independent blockers or requested choices. Native forms have no conditional visibility: separate dependent questions. If the source route is unresolved, establish it before requesting files; do not ask again when upload is already chosen or a referenced uploaded file is missing. Keep Data intake fields skippable with `required: false`, including files; a source may still be needed to finish the analysis afterward.

| Form | `message` | Question `title` |
| --- | --- | --- |
| One text or choice question | Actual question | Same question; the host may hide the separate label |
| Resource picker | Action, e.g. **Choose a report template** | Distinct collection label, e.g. **Relevant report templates** |
| File picker | Action, e.g. **Upload your data** | File request, e.g. **Select the missing CSV** |
| Several independent questions | Shared heading | Self-contained question for each field |

Keep headers and question titles within 80 characters. Use a question description only for helpful context. The adapter suppresses a duplicate header for a single matching text question. Resource card descriptions are not displayed; use concise, format-prefixed titles such as **Page · Weekly review**.

Single-choice and single-resource radios do not clear a selected answer. Optional fields can be skipped before selection. For a clearable enum, use an explicit **No preference** option or `multi_select` with `maxItems: 1`; use `resource` for a normal single-template picker.

## Prepare resource previews

Follow [template previews](../../shared/template-previews.md) for fresh provider images, retained thumbnails, local Page-content previews, and authentic icons. Missing previews must not delay the picker. The same resource title and icon appear in the caption and thumbnail hover strip; there is no separate hover-label parameter. The server does not fetch or authenticate images.

## Handle the result

The tool returns `accept` with answers keyed by question ID, `decline`, `cancel`, or an error. A selected URI establishes neither readability nor permission to edit. Do not reopen cancelled forms automatically. For `unsupported_client`, use a supported question or text fallback for ordinary clarification; template selection requires another supported rich picker or an explanation of the limitation. For result shapes, all error codes, field limits, and native protocol details, see the [API reference](API.md).

An explicitly selected template determines format; a reference does not. Continue under [output and template handling](../../shared/output-and-template-handling.md).

## Runtime and fixtures

The Data stdio MCP exposes `data_home`, `search_mentions`, and `form_elicitation_v2_request`. It advertises no settings capability. The plugin remains usable beyond desktop (`requires_local_executor: false`); native forms require host support.

`node mcp/forms/examples/prepare-demo.mjs /absolute/fixture-directory` generates synthetic CSVs, templates, and call JSON for contract coverage. Its multi-field setup forms exercise protocol combinations; they are not a recommended default intake flow or real user submissions. Generate fixtures on the target host; copying JSON paths does not transfer files. A simulated protocol round trip does not establish that a real user completed the native UI.
