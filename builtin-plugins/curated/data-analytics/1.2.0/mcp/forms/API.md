# Native form API reference

This reference distinguishes **Data's model-facing tool** from the **native host protocol** it compiles to. The native protocol has more capabilities than Data exposes. Source of truth: [`contract.mjs`](src/contract.mjs), [`registration.mjs`](src/registration.mjs), and [`adapter.mjs`](src/adapter.mjs). The shared [intake policy](../../shared/task-intake.md) determines when to call the tool.

## Model-facing tool

The tool name is `form_elicitation_v2_request`; a host may add a server namespace. It collects answers in one ordered native form and waits for final submission. It does not discover resources, fetch images, inspect files, install plugins, edit artifacts, or perform analysis.

### Input

```ts
{
  message: string;        // Required: short form header, 1–80 characters.
  questions: Question[]; // Required: 1–12 questions, in display order.
}
```

For a single text or choice question, use the actual question in both `message` and the field `title`, such as `What would you like to understand?`. The host may hide a separate choice label; for a single text field with a matching title, the adapter omits the redundant native header while retaining the visible, accessible field label. Use action titles for direct actions such as `Upload your data`. For multiple independent questions, use a concise shared heading and self-contained question titles. Put helpful context in the optional field `description`; omit repetition. Schema limits are ceilings, not suggested question counts. Common question fields:

| Field         | Required | Contract                                                                   |
| ------------- | -------- | -------------------------------------------------------------------------- |
| `id`          | Yes      | Unique within the form; `/^[A-Za-z][A-Za-z0-9_-]{0,63}$/`.                 |
| `type`        | Yes      | One of the six types below.                                                |
| `title`       | Yes      | Trimmed, nonempty, at most 80 characters.                                  |
| `description` | No       | At most 2,000 characters; omit when unnecessary.                           |
| `required`    | Yes      | Explicit boolean; no default. Data intake uses `false`, including files. This does not make the call asynchronous. |

All input objects are strict: unsupported properties cause an error. Serialized arguments are limited to 1 MiB as measured by the adapter's JSON string length. Question IDs and option IDs/URIs must be unique within their respective lists.

| Question type   | Additional input                                                                   | Accepted answer                                                       |
| --------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `text`          | Optional `maxLength`: integer 1–16,000, default 4,000.                             | String. Required text must contain a non-whitespace character.        |
| `single_select` | `options`: 1–24 choice options.                                                    | One exact option ID.                                                  |
| `multi_select`  | `options`: 1–24 choice options; optional `minItems`, `maxItems`.                   | Array of distinct exact option IDs.                                   |
| `resource`      | `options`: 1–24 resource options. **Use for templates.**                           | One exact offered URI string.                                         |
| `resources`     | `options`: 1–24 resource options; optional `minItems`, `maxItems`.                 | Array of distinct exact offered URI strings.                          |
| `files`         | Optional `options`: 0–24 resource options; optional selection limits and `accept`. | Array of offered URIs or user-selected absolute local `file://` URIs. |

Array selection limits apply only to `multi_select`, `resources`, and `files`:

- `minItems`: integer 0–24; defaults to 1 for required questions and 0 otherwise. A required array cannot have `minItems: 0`.
- `maxItems`: integer 1–24; defaults to the number of options, or 24 for `files`.
- Minimum cannot exceed maximum. For questions without user-added files, neither bound may exceed the option count.
- No answers are preselected. The tool has no `default` parameter and does not silently apply saved settings.

`files.accept` is an optional list of 1–12 filename extensions or MIME types, for example `[".csv", "text/csv"]` or `["image/*"]`. The host picker applies the filter. It is not proof of content type, successful upload, or readability by the agent. User-added URIs must use `file://`, an empty or `localhost` authority, an absolute path, and no username, password, query, or fragment. The plugin does not transfer laptop files to a remote host.

### Choice options

Used by `single_select` and `multi_select`:

```ts
{
  id: string;           // Same ID syntax as question IDs.
  title: string;        // Trimmed, nonempty; maximum 500 characters.
  description?: string; // Maximum 1,000 characters.
  thumbnail?: Image;
  preview?: Image;      // Older alias; cannot coexist with thumbnail.
}
```

These compile to native `oneOf`/`anyOf` options with `const: id`. Choice thumbnails compile to `x-openai-thumbnail`. Use `resource` when the answer identifies a real template or other resource, rather than an invented choice ID.

### Resource options: complete Data surface

Used by `resource`, `resources`, and optional offered choices in `files`:

```ts
{
  uri: string;          // Required identity; absolute URI, maximum 8,192 characters.
  name: string;         // Required logical name, trimmed/nonempty; maximum 500 characters.
  title: string;        // Required display label, trimmed/nonempty; maximum 500 characters.
  description?: string; // Maximum 1,000 characters; current native cards do not display it.
  mimeType?: string;    // Maximum 100 characters.
  icons?: Image[];      // Maximum two authentic provider or format icons.
  thumbnail?: Image;   // Provider/retained image or rendered Page-content preview.
}

type Image = {
  src: string;          // Maximum 262,144 characters; supported image URL/data URI.
  mimeType?: string;    // Maximum 100 characters.
};
```

For templates use `type: "resource"`, `required: false`, an action heading such as **Choose a report template**, and a distinct collection title such as **Relevant report templates**. Omit the question description unless it adds useful context. There is no “Leave empty to start fresh” subtitle. Single selection uses native radios: choosing another card replaces the previous choice. Before making a selection, the user may skip the question. Native radio controls do not toggle an already selected option off; `required: false` does not add a per-card clear control.

Resource `title` is used both below the card and in its existing thumbnail hover/focus strip. Prefix the title with its real type, such as `Presentation · Business review`, `Site · Growth dashboard`, or `Document · Weekly update`, and supply the available provider/format logo in `icons`. There is no separate `typeLabel`, `hoverTitle`, `tooltip`, hover description, layout, or caption-only parameter. Adding the type therefore affects both caption and hover. Long captions and hover titles can truncate in the native renderer; keep them concise even though resource labels allow 500 characters.

A resource thumbnail compiles to `_meta["openai/thumbnail"]`. With a thumbnail, the native card shows the supplied icon and title on hover/focus. Without a thumbnail, it uses the resource icon as the card visual when available, otherwise a generic fallback. It does not add the thumbnail hover strip to icon-only cards. The server does not fetch or authenticate any image.

### Thumbnail sources and image validation

Image discovery happens before this tool call under the shared [thumbnail and icon policy](../../shared/template-previews.md), which owns retrieval limits and conditionally links Page-rendering and Slides-thumbnail mechanics. The server validates supplied images; it does not discover or fetch them.

For Sites, use the fresh `screenshot_url` returned by the available Sites list/get/search response. This is the screenshot source used by the Sites tab; do not invent a separate screenshot URL from the site's public address. Pass it unchanged as `thumbnail.src` when it is usable. If the host has a private or relative screenshot path without a usable provider URL, do not reconstruct authentication or private endpoints. Use an available provider thumbnail, retained preview, or icon fallback instead.

Images allow HTTPS URLs or base64 `image/png`, `image/jpeg`, `image/jpg`, `image/gif`, `image/webp`, and `image/avif` data URIs. URL usernames/passwords and credential-like query parameters are rejected. The scoped exception permits the image-delivery `sig` parameter on HTTPS `sdmntpr*.oaiusercontent.com` hosts matching `/^sdmntpr[a-z0-9]*\.oaiusercontent\.com$/i`, because Sites returns expiring signed screenshot URLs there. Preserve these URLs and signatures as returned; refresh expired URLs through the provider. Other credential parameters remain disallowed, including on that host. Resource identity URIs do not receive this image-only exception. Neither SVG data URIs nor local file images are accepted through Data's image shape.

### Example and native mapping

The following uses illustrative URLs; replace every resource/image URL with verified discovery results:

```json
{
  "message": "Choose a report template",
  "questions": [
    {
      "id": "template",
      "type": "resource",
      "title": "Relevant report templates",
      "required": false,
      "options": [
        {
          "uri": "https://example.com/verified-business-review",
          "name": "business-review",
          "title": "Presentation · Business review",
          "mimeType": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          "icons": [{ "src": "https://example.com/verified-presentation-logo.png" }],
          "thumbnail": { "src": "https://example.com/verified-slide-preview.png" }
        }
      ]
    }
  ]
}
```

It compiles to a native property with `type: "string"`, `format: "uri"`, and `"x-openai-input": {"type": "resource", "options": [...]}`. `thumbnail` moves into each native resource's `_meta["openai/thumbnail"]`; the other resource fields are retained. The `template` property is omitted from the native form's `required` list. Selecting the option returns:

```json
{
  "action": "accept",
  "content": { "template": "https://example.com/verified-business-review" }
}
```

Skipping an optional scalar resource leaves its key out of `content`; an empty string, array, or `null` is not a valid scalar resource answer. Optional text and arrays may be empty or omitted. Only accepted content supplies answers. No answer, decline, cancellation, or error establishes a selected template or authorizes mutation.

### Results and errors

The MCP tool returns the same result in `structuredContent` and a JSON-encoded `content[0].text`:

```ts
{ action: "accept"; content: Record<string, string | string[]> }
| { action: "decline" | "cancel" }
| { error: { code: string; message: string } }
```

Error results also have MCP `isError: true`:

| Code                 | Meaning                                                                            |
| -------------------- | ---------------------------------------------------------------------------------- |
| `invalid_arguments`  | Input failed the advertised contract, uniqueness, size, or selection-limit checks. |
| `unsupported_client` | Host did not advertise native form support.                                        |
| `invalid_response`   | Submitted values or host response failed validation; no answers applied.           |
| `request_cancelled`  | The tool request was interrupted before valid submission.                          |
| `timeout`            | Submission did not arrive within the configured request timeout.                   |
| `transport_error`    | Elicitation failed before a valid response arrived.                                |

The server timeout defaults to 15 minutes. `DATA_FORMS_TIMEOUT_MS` can configure an integer from 1 to 1,500,000 milliseconds; it is a server environment setting, not a model parameter. It is passed as both request timeout and maximum total timeout. Timeout does not mean “accept the defaults” or a user decline.

### What the model sees, and what is internal

When this tool is surfaced/discovered, its advertised descriptor includes its name, behavioral description, JSON input schema (including required fields, enum variants, limits, and the resource-title/thumbnail/icon guidance), and annotations. The annotations are `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: false`, and `openWorldHint: false`. The descriptor does not advertise an `outputSchema`; results still include structured content as described above. Exact presentation and discovery of descriptors depend on the host.

The description is organized into **When to call**, **Question types**, **Build the form**, and **Results and boundaries**. It reserves this blocking tool for missing required source material that prevents meaningful progress or an explicitly requested interaction/wait. Shared task intake prefers best-effort delivery and async questions for other uncertainties. Field descriptions explain answer types, skippability, title placement, and card metadata; detailed preview retrieval stays in the shared preview guide. These are model instructions, not runtime enforcement of when the user intended a form.

The model supplies every question, option, image URL, and `required` boolean. Discovery results, current task context, previously selected templates, attached file bytes, and task preferences are not automatically inserted by this tool. No default choice is applied or described as a user answer. Computed text/array bounds and timeout are server behavior; the JSON schema does not insert these values for the caller.

At execution time the adapter checks `capabilities.extensions["openai/elicitation"].form`, compiles the native schema, invokes `OpenAIExtensions.elicitInput`, and validates the answer. Capability checks, native `requestedSchema`, layout, hover behavior, and timeout are not caller parameters. Making a question optional does not make the call nonblocking: for a sufficiently specified analysis, do not call it merely to collect optional preferences.

## Native resource/file question API

This is the broader existing host API, **not additional parameters accepted by Data's tool**. It is defined in `lib/js/oai_js_mcp_extensions/src/shared/forms/file-picker.ts` and the frozen MCP SDK's `ResourceSchema`/`IconSchema`.

A request uses method `openai/elicitation/create` with `{mode: "form", message, requestedSchema}`. The form is `{type: "object", properties, required?, $schema?}`. Field membership in the form's `required` array determines whether an answer is mandatory; there is no field-level `required` property in this native schema.

### Single-resource/file field

```ts
{
  type: "string";
  format: "uri";
  title?: string;
  description?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  default?: string;
  "x-openai-suggestions"?: NativeSuggestion[];
  "x-openai-input": {
    type: "resource" | "file";
    options: NativeResource[];
    userOptions?: { kind?: "file" | "directory"; accept?: string[] };
  };
}
```

`enum`, `oneOf`, `anyOf`, and `x-openai-input.selection` are forbidden for scalar resource fields. `x-openai-suggestions` is inherited from the native string schema; it is not rendered as resource-card suggestions by the current file/resource field UI. A suggestion has `{const: string, title: string, description?, "x-openai-thumbnail"?: NativeIcon, "x-openai-preview"?: NativeIcon}`; the preview name is deprecated.

### Multiple-resource/file field

```ts
{
  type: "array";
  title?: string;
  description?: string;
  minItems?: number;
  maxItems?: number;
  default?: string[];
  items: {
    type: "string";
    format: "uri";
    title?: string;
    description?: string;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    default?: string;
    "x-openai-suggestions"?: NativeSuggestion[];
  };
  "x-openai-input": {
    type: "resource" | "file";
    options: NativeResource[];
    userOptions?: { kind?: "file" | "directory"; accept?: string[] };
    selection?: "explicit" | "implicit";
  };
}
```

- Omitted `selection` behaves as `explicit`: checkboxes for arrays, radios for scalars. Data always uses explicit array selection.
- `implicit` is array-only: all offered options begin selected and the UI supports removing items instead of checkbox selection. It cannot be combined with an outer `default`.
- Every outer default URI must identify an offered option; the native validator does not synthesize answer defaults on submission. Data does not expose defaults or implicit selection.
- Without `userOptions`, responses must name offered resource URIs. With it, the host can add user-picked items; `kind` defaults to `file`, and `accept` filters file selection. Directory and scalar-file modes exist in the native API but are not exposed by Data.
- Native schemas do not impose Data's 12-question/24-option/title-length limits. They do not expose array `uniqueItems` on this resource field; Data separately rejects duplicate submitted identities.

### Native resource and icon metadata

```ts
type NativeResource = {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  size?: number;
  icons?: NativeIcon[];
  annotations?: {
    audience?: ("user" | "assistant")[];
    priority?: number; // 0–1.
    lastModified?: string; // ISO 8601 datetime with timezone.
  };
  _meta?: Record<string, unknown>;
};

type NativeIcon = {
  src: string;
  mimeType?: string;
  sizes?: string[]; // e.g. ["48x48"] or ["any"].
  theme?: "light" | "dark";
};
```

Unlike Data, the native resource schema makes `title` optional and accepts `size`, annotations, arbitrary `_meta`, and icon size/theme hints. The native renderer picks an appropriate supplied icon and falls back from `title` to `name`. Data exposes only the narrower fields listed earlier and does not permit caller-supplied `_meta`.

Renderer-recognized resource metadata:

| Key                         | Shape and behavior                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `_meta["openai/thumbnail"]` | `NativeIcon`; card image and thumbnail hover/focus strip.                                                                             |
| `_meta["openai/preview"]`   | Legacy `NativeIcon` thumbnail alias, or a preview target directly, or `{target: PreviewTarget}`. Prefer the thumbnail key for images. |
| `_meta["openai/target"]`    | `PreviewTarget` fallback when a preview target was not found above.                                                                   |

A native `PreviewTarget` is either `{type: "resource_link", ...NativeResource}` or `{type: "mcp_app_tool", name: string, arguments?: Record<string, JSONValue>}`. The host can show a Preview control when target metadata and preview handling are available. These targets are native capabilities, not fields in the current Data form tool, and supplying a plain resource `uri` alone does not request that preview action.

There is no native resource-card hover-title, type-label, subtitle, author, description-layout, tooltip, or thumbnail-aspect-ratio parameter. Resource descriptions and annotations are accepted metadata but the current carousel renderer does not display them. `title`, `icons`, and thumbnail metadata are the existing supported inputs for the requested title/type/logo hover treatment; richer presentation would require separately scoped core UI work.
