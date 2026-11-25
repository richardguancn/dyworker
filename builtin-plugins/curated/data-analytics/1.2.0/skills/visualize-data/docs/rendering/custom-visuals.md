# Custom quantitative visual fallback

Read this only for an unsupported quantitative encoding or confirmed delivery limitation. Standard charts use [Visualize Data](../../SKILL.md) and selected types. General diagrams, simulations and UI previews retain their selected visual workflow; this reference does not broaden Data's trigger. Preserve reviewed values and the requested surface. Use standard plotting tools for scientific or publication figures.

For a supported chart inside an exported HTML report or dashboard, keep the CDN-loaded React component in the saved artifact if the preview cannot fetch its library. Record the failed request and qualify the handoff. A blocked script or stylesheet in the verification environment is a delivery issue, and redrawing the same chart as SVG would break the export contract.

For simple static unsupported geometry, write a small inline SVG with explicit scales, labels and an accessible summary. Reuse the reviewed rows and preserve the missing analytical feature; no dependency install, chart-source exploration, runtime rebuild or speculative retry is needed. A node/link flow may preserve adjacent-stage counts without fabricating complete individual paths. Define scoped colors or explicit fallbacks such as `var(--foreground, #242424)` and `var(--card, #fff)`; host variables are not guaranteed. Keep node labels outside opaque bands or use contrasting fills. Put crossing-link quantities in a keyed legend or working tooltip instead of overlapping text at link midpoints. A `data-tooltip` attribute alone does not implement a tooltip. For dense custom labels or crossing links, make one targeted desktop/narrow preview to check contrast and collisions.

`<skill-dir>` is the parent `visualize-data` directory inside the **Data** plugin, not the separate Visualize plugin. The host contracts below apply to custom inline fragments, not full dashboard projects. Select delivery from the main guide's capability table. The file-reference examples apply only when the host provides that protocol; for native HTML/AppBlock use [native inline delivery](native-inline-visualizations.md).

## Inline HTML output contract

### File

- When the host uses a file reference or an executor is available for checking, choose a concise ASCII lowercase-hyphenated title and write `<title>.html` in an explicitly writable, durable, task-owned location. Prefer the thread-scoped visualization directory when it appears in the writable roots. Otherwise, use the task's supplied `work/` directory or create an output directory under its authorized working directory.
- Never save inline visualization fragments to Library; they are response content, not user-facing file deliverables.
- Never add `sandbox:` links to inline visualization HTML unless the user specifically requests a download.
- Do not choose system temp as a separate fallback. Write access alone does not guarantee that the conversation can read the file.
- Use the absolute path on the executor that creates the file. Never assume `~/.codex` is writable unless its thread directory appears in the writable roots.

### Fragment

- Write only an HTML fragment: no `<!doctype>`, `<html>`, `<head>`, or `<body>`.
- Write literal markup: use `<div class="card">Hi</div>` plus a real newline, never `<div class=\"card\">Hi</div>\n`. Escape only for the chosen file-writing mechanism; do not leave literal escapes in the delivered markup.
- Keep CSS and JavaScript in the fragment only when base classes are insufficient. Load static resources only from the CDN allowlist. Never use `fetch`, XHR, WebSocket, or other API calls.
- Give the fragment root a unique ID and select it with `document.getElementById(...)`. Never derive the root from `document.currentScript`; scripts may sit outside the root.
- Keep visualizations under 1 MB. Aggregate, bin, downsample, reduce precision, or drop unused fields from large inline datasets.
- Check that JavaScript has no undefined identifiers, every queried element exists, and the primary interaction updates the visual. For concrete rendering/interaction breakage or explicitly requested testing, prefer the actual target surface. If a standalone diagnostic is needed, follow [Data-owned standalone preview and export](native-inline-visualizations.md#standalone-preview-and-export). Its preview places the fragment inside a restricted iframe: scope Playwright locators to `page.frameLocator("iframe")` and evaluation to that frame. Do not wrap the fragment as a prerequisite for native delivery.

### Content and response

- Keep the fragment focused on the visualization. Do not include explanatory paragraphs, formulas, instructions, or narrative callouts. Include only necessary labels, legends, values, and accessible text alternatives.
- Use the active host's delivery contract and put any necessary concise explanation outside the fragment. When the host provides visualization references, add this reference on its own line where the visual should appear, using the absolute executor-side file path:

```text
visualize{"path":"<absolute-path>/<title>.html"}
```

- Add `"mode":"wide"` only when several compact chart panels must remain side by side for direct comparison and would be unreadable at the normal width. Never widen a single plot, map, grid, or timeline merely because it is dense; stack separate self-contained views vertically. Wide visualizations render in an expandable inline surface up to 1,024px:

```text
visualize{"path":"<absolute-path>/<title>.html","mode":"wide"}
```

- Whenever you create or update an inline visualization, include its selected host reference or HTML container only in that same turn's final response (never in commentary or progress updates), including updates to an existing fragment.
- Deliver the fragment through the selected host reference or native HTML container, never a Markdown download link. Keep surrounding prose focused on interpretation without repeating the visual's data. Follow the main guide’s inline delivery rules; custom output remains a fallback, not standard-component adoption. The visual does not limit the depth of the answer.

### External resources

- Honor the active host's resource policy. Data's standalone helper permits chart scripts/styles under `https://persistent.oaistatic.com/plugins/visualize/charts/` and the shared CDN resources; that helper does not grant permissions to a native host. Preserve existing pins and distinguish a resource-policy failure from an unsupported encoding.

## Exporting an existing visualization

- Keep the fragment as the editable inline source. For an explicitly requested standalone export of the existing custom visualization, use the **Data-owned** helper in [standalone preview and export](native-inline-visualizations.md#standalone-preview-and-export). A native Page embed or an inline visualization reference does not require this wrapper.
- This export flow produces a standalone copy of an existing visualization. For a new report/dashboard or general website request, use its selected workflow instead of treating an inline fragment as the entire deliverable.
- Keep only `window.openai.widgetState` and `window.openai.setWidgetState` calls from window\.openai.\* when exporting: the standalone wrapper supplies fallback state storage. Replace other host-only interactions before using the standalone HTML outside Codex.
- When the user asks to publish or host an existing visualization and the `sites` skill is available, use it to choose the project, write the rendered standalone document as `index.html`, and publish it.
- If Sites is unavailable, offer the standalone HTML without claiming it was published.

## Runtime styles

### Color

- In each color pair, the base token is a surface and its `-foreground` token is the content on that surface. `--muted` is a surface fill; use `--muted-foreground` for secondary text.
- Make every fill, stroke, text, border, shadow, chart, and canvas color theme-aware. Never hardcode light or dark palettes such as white panels, off-white backgrounds, black text, slate strokes, or Tailwind color literals.
- Available theme variables include `--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`, `--popover-foreground`, `--primary`, `--primary-foreground`, `--secondary`, `--secondary-foreground`, `--muted`, `--muted-foreground`, `--accent`, `--accent-foreground`, `--destructive`, `--border`, `--input`, `--ring`, `--blue`, `--orange`, `--green`, `--red`, `--purple`, and `--yellow`. Use `currentColor` inside SVG.
- Use `--viz-series-1` for one measure or active state. Use `--viz-series-2` through `--viz-series-6` only for important persistent category, series, or status identity; never give every peer a different color by default.
  - For categorical tiles or nodes, prefer a soft low-opacity series fill with a neutral or transparent border; never color every outline.
  - Keep mappings stable and pair color with labels, shapes, or line styles.
  - Secondary series colors are theme-derived; never assume hues or use them decoratively.
- Use series colors only for chart lines, marks, and legend swatches. Keep values, axis text, and direct labels in `--foreground` or `--muted-foreground`.
- Use `.btn-primary` for high-emphasis actions; its neutral fill is supplied by the utility. Use `--primary` and `--primary-foreground` for filled selected, active, or pressed controls. Reserve `--accent` and `--accent-foreground` for subtle interactive surfaces and soft highlights. Buttons with `aria-pressed="true"`, `aria-selected="true"`, or `.is-selected` already use the primary pairing; `.nav-pills .nav-link.active` keeps selection neutral.

### Typography

- Scale type with `--font-size-base`. Use normal text by default and `.text-small` only for secondary annotations; at the default scale these are 14px and 12px. Never make supporting text smaller than 11px.
- `h1`, `h2`, and `h3` are available; use one concise visible heading for a self-contained chart or graph, with short panel headings only when needed. Do not restate the prompt or add a redundant title to other visualizations.
- Use only weights `400` and `500`. Never set custom font sizes or line heights.
- Use `.tabular-nums` on changing or aligned numbers. Avoid it for editorial or decorative numerals.

## Local interaction

Keep filters and presentation state local. For an explicitly labeled investigation action, call `await window.openai.sendFollowUpMessage({ prompt, title })`; include selected values and the requested investigation, and keep the optional confirmation title under 250 characters.

### Remembering inline interaction state

- Read saved state from `window.openai.widgetState` when rendering. Listen for `openai:set_globals` and apply `event.detail.globals.widgetState` when present. Use defaults for missing or incompatible state.
- After meaningful interactions, call `window.openai.setWidgetState({ modelContent, privateContent }).catch(() => {})`. Updates are optimistic. Both fields accept JSON or `null` and may be omitted (treated as `null`). Each call replaces the snapshot; keep it under 16 KiB. Never save on load or state events.
- Put choices useful for follow-up questions in `modelContent`, UI details worth restoring in `privateContent`, and transient or recomputable values in memory. Only `modelContent` may reach the model: delivery is best-effort and not guaranteed across clients. Never rely on it; saving never starts a turn. No secrets or images.

## Layout and accessibility

- Use `aria-live="polite"` for dynamic results, selections, and simulator updates. Use `role="alert"` for validation errors. Do not announce every hover or animation frame.
- Keep the top-level surface transparent and unframed, and fill the available conversation width. Design for 736px, or 1,024px in wide mode, and support widths down to 320px. Stack side-by-side content when it no longer fits.
- Size every SVG from its actual container. At narrow widths, reduce ticks, declutter annotations, and keep visible text at least 11 screen pixels; never shrink a fixed-width `viewBox`.
- Keep native tab order; never add `tabindex`.
- Use native `button`, `input`, `select`, and `textarea` elements with matching utilities; never recreate controls.
- Keep browser or utility focus styles; never override them.
- On coarse pointers, provide non-overlapping effective targets about 44px by 44px without breaking 320px layouts; visible icons and marks may stay small. Keep fine-pointer controls compact, and let shared utilities own touch sizing and at least 16px editable-field text.
- Try to keep 90×50px clear for host controls (top-right in LTR hosts, top-left in RTL hosts).

## Host utilities

Use existing utilities without overriding their geometry, colors, descendants, focus styles or interaction states. Keep charts and the top-level fragment unframed; use `.card` only for a useful bounded numeric/selected-item summary, with no nested cards or recreated card chrome.

| Need | Host contract |
| --- | --- |
| Summary | `.card.viz-stat`, one muted label, `.viz-stat-value`, optional short delta |
| Peer summaries | `.viz-grid` for compact groups; not the whole visual or a scrolling card row |
| Controls | `.viz-controls`; native fields with `.form-label`, range current value and units beside its label |
| Actions | `.btn`, optional `.btn-primary`/`.btn-ghost`; `.btn-block` only for intentional full-width actions |
| Inputs | `.form-control`, `.form-select`, `.form-range`; `.form-check` label wraps checkbox/radio and text, `.form-switch` for switches |
| Tables | Semantic `.table`, optional `.table-sm`; `.table-responsive` for genuine column overflow; `.text-end` for numbers |
| Text | `.text-muted`, `.text-small`, `.tabular-nums`, `<code>`, `.sr-only` |
| Tooltips | `data-tooltip="Label: value unit"` on the actual accessible trigger; host handles hover/focus/touch. No `title` or initialization. Optional `data-tooltip-placement`: top/right/bottom/left. |

Use `.cursor-interaction` on custom interactive elements rather than hardcoded pointer cursors; preserve text/drag/disabled cursors. Put full truncated labels in `data-tooltip` on their existing accessible trigger. Essential content must remain visible without hover.

### Tabs

The host wires `.nav.nav-pills[role="tablist"]` automatically. Label the group; each native `.nav-link[role="tab"]` needs a unique ID, `type="button"`, `aria-controls` and `aria-selected`. The initial tab has `.active` and `aria-selected="true"`. Matching `[role="tabpanel"]` uses that controlled ID and `aria-labelledby`; inactive panels are `hidden`. Do not add another tab event implementation. `.nav-justified` optionally makes tabs equal width.


## Charts

**General Instructions:**

- Resolve theme colors before passing them to canvas or chart APIs that cannot parse CSS variables or `light-dark(...)`; redraw when the theme changes.
- Use a tooltip unless it would distract from a simple, directly labeled chart. Keep chart-library tooltips and grouped legend interactions native; never replace them with a custom one-point tooltip.
- Animate transitions between chart states so lines and marks move to their new values, resampling paths when point counts differ. Do not animate initial appearance or use fade-only effects; never loop motion, and honor `prefers-reduced-motion`.
- Include labeled axes, units, and directly labeled important values. Give every chart, SVG, canvas, and widget a concise screen-reader summary using a role and accessible name or description, SVG `<title>`/`<desc>`, fallback text, or an `.sr-only` heading or description.
- Reserve space for the longest formatted label at every supported width. Axis ticks are secondary and may use `.text-small` when space is tight. Never overlap or clip text against marks, axes, legends, labels, or edges; move or reduce labels rather than squeeze them.
- Add a legend only when multiple series cannot be labeled directly.
- Pair color with shape or text so meaning never depends on color alone.

### Fallback chart rendering

- Prefer inline SVG for simple charts and version-pinned approved-CDN libraries when native interaction, scales, legends, or layout materially improve the result.
- Prefer `<line>` for straight SVG axis, tick and connector segments. Explicitly set `fill="none"` on stroke-only `<path>` or `<polyline>` axes and leader lines: SVG fills open paths by implicitly closing them, so an L-shaped axis can otherwise become a filled triangle. Scope this to stroke-only geometry; preserve intentional fills on area bands, filled markers and other chart shapes.
- For a custom chart, check its data, calculations and geometry offline. Use an available preview only to diagnose concrete rendering or interaction breakage, or for explicitly requested testing. If rendering was not inspected, do not claim it was verified.
- For SVG, attach `data-tooltip` directly to the real pointer-accessible mark and include its label, value, and units; the sandbox handles themed positioning, keyboard focus, and touch.
- Keep decorative SVG fills, bands and leader lines from intercepting interactive marks (`pointer-events: none`). When observations overlap, use a grouped tooltip or series selection/focus so every observation remains inspectable; do not rely on tiny exposed edges. When a preview is needed under the validation policy, inspect an overlapping observation in the primary interaction.
- Scope SVG styles to the chart class. Never target every `svg` in a container that also contains Lucide icons.

## Icons and specialized references

- Use the sandbox-provided global `lucide`. Add an icon name with `data-lucide`:

  ```html
  <i data-lucide="search" aria-hidden="true"></i>
  ```

- Never author inline icon SVG or icon paths. Use only supplied Lucide names; the sandbox replaces each placeholder with a host-sized `currentColor` SVG. Reserve authored inline SVG for charts and data marks.
- Mark decorative icons `aria-hidden="true"`. Put action icons inside labeled controls; use a visible label or `aria-label` for icon-only actions.
- Let the sandbox initialize static icons after the fragment without blocking first render. After adding icons dynamically, use `lucide.createIcons({ attrs: { width: 16, height: 16 } })`.
- Never load Lucide or another icon library from the network.

Read [maps](maps.md) only when the quantitative fallback needs sourced geographic geometry. It is not a standard-chart prerequisite.
