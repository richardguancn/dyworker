# Reports in Spaces

Start a new Page with the [report starter](../../../output_formats/space_page/report.md). Use the sections below for detailed Page operations, revisions or exports. A complete report has a readable main Page, native embedded charts, and source subpages that let a reader trace each material finding to its evidence. Keep the substantive analysis and important caveats in the report; move reproducibility detail into sources rather than shortening the analysis.

## Resolve the destination

Apply the [native Page destination and editing guide](../../../output_formats/space_page/guide.md). Keep the report composition and claim/source conventions below.

## Compose the main Page

Apply the report skill’s [title and opening principles](../SKILL.md#report-principles): a concrete subject or supported finding title, compact date/known-author byline, and visible Executive Summary for a substantial report. Use sections whose headings state the supported findings. Put workspace/sample identity and comparison setup in Sources and methods below the main findings, retaining periods on charts and material caveats beside claims. Keep interpretation close to its chart. Use native headings, paragraphs, lists, and occasional comparison tables; do not embed the entire report as an HTML app.

Keep prose unboxed and readable. Apply the task’s supplied or applicable context-skill style guide to the Page and charts. Native Page typography and layout may be host-controlled; disclose material unsupported styling accurately rather than replacing the surface. Compact large numbers in the narrative while retaining exact values in sources. Explain overlapping segments, incomplete periods, denominator changes, attribution limits, and causal uncertainty where they affect a conclusion. Put detailed scope and methodology later. Use recommendations only when supported by the findings. Preserve a requested title, structure, and user edits.

### Show report progress

Before opening an unfinished main Page, place this notice in its own first block, above the report body:

```markdown
> ⏳ **Report in progress.** Data agent is working, and this Page’s content may change.
```

Retain this block when replacing draft content or adding charts and source pages; a chat update alone is not a visible Page status. Remove the notice when the requested report and available verification are complete, following [completion versus uncertainty](../SKILL.md#report-completion-and-uncertainty). An unresolved explanation or unavailable visual check alone does not keep a finished report in progress; record the limitation and preserve any qualification that changes a conclusion. Read back the saved Page to confirm removal before the final handoff.

If ending the turn with unfinished work, change the notice to **Draft — incomplete** and state what remains. On resumption, read the current Page and update the same status block. This is ordinary Page content, not an automatic activity indicator; do not invent percentages or imply that work continues after it has stopped. Small edits to an otherwise complete report need no construction notice.

### Claim citations

Group related numbers and calculations on one source subpage when the reader can verify them together. Give distinct evidence its own subpage. Follow the [Page citation grouping rule](../../../output_formats/space_page/report.md#prepare-the-report-and-evidence) when placing visible links. A claim about why customers churned needs its own supporting evidence.

Number sources in order of first appearance, including chart sources, and keep a mapping from claim/chart identity to number and Page ID. Keep source-page titles short: the citation number and usually two or three identifying words, such as `[1] Sites adoption`, `[2] Weekly activation`, or `[3] Rollout timing`. Put the full finding in the source body. Omit redundant `Source` and `Chart:` prefixes; retain enough context to distinguish neighboring sources. Follow an explicit preference for numeric-only titles, but do not assume the host supports hiding destination titles in inline links.

Pages renders the source list automatically. Retain claim citations and source subpages; do not append a duplicate Sources list or expandable source heading to the main Page.

Create children in citation order and use a supported ordering operation if available. Preserve numbers and IDs during small edits; shortening a title must not recreate its Page. Do not promise custom sibling sorting or collapsed headings unless the current Page tools support and verify them.

When using an inline citation, place it directly after the first claim it supports, with only the numeral linked. Use literal brackets outside the Markdown link:

```markdown
Active users reached 112k, up 12% from the prior week. \[[1](SOURCE_PAGE_URL)\]
```

The result is an ordinary inline `[1]`, not a superscript. Use the returned source Page URL. Do not link the whole claim or put an extra standalone citation block after every sentence. Native Page-link decorations are controlled by the host; do not invent a flag to remove them.

### Charts and their source links

Use the [Page chart preparation path](../../visualize-data/docs/rendering/page-chart-fragment.md). Use the installed Visualize library for new charts and keep the saved renderer when revising an existing chart. Prepare the reviewed HTML fragment before uploading it with the active Pages visualization tool. Correct a failed preparation before upload. Reuse the successful fragment within the 256 KiB UTF-8 limit. If Visualize is unavailable, include the reviewed comparisons in the Page and disclose any requested chart you could not deliver.

Follow the shared [chart surfaces and style](../../../shared/shared-skill-instructions.md#chart-surfaces-and-style). When moving an HTML report to Pages, carry over units, series order and color identity, scale, legend behavior, and the interaction target. For example, hovering anywhere in a week should show that week and every series, not require hitting a point to see one value. Keep transient hover local, not in shared Page state. Use an inspected static image only under the shared fallback conditions, through Pages' supported image upload and embed workflow.

The report and its chart source Page use the same reviewed fragment, with destination-specific file access as described below. Page charts load the pinned chart CDN asynchronously. Apply [chart preservation during verification](../../../shared/shared-skill-instructions.md#preserve-charts-during-verification) during diagnosis, then follow [Visualize Data’s Page guide](../../visualize-data/docs/rendering/page-chart-fragment.md#custom-charts-and-fallbacks) for any fallback. Assess each Page separately and preserve working charts.

Give each chart one visible title inside its visualization HTML, in both the report and its source subpage. Omit adjacent native Page headings or captions that repeat or paraphrase that title. Preserve section headings that state a distinct finding, source-page document titles, and useful chart subtitles, units, and labels. Keep the visualization tool’s title, embed alt text, and chart accessibility descriptions meaningful; they do not require another visible heading.

For source-link placement, follow the [Page report guide](../../../output_formats/space_page/report.md#create-connect-and-finish):

```markdown
[View source](CHART_SOURCE_PAGE_URL)
```

Keep raw chart data tables, SQL, chart mappings, and chart-data expanders out of the main Page and visualization. A small comparison table that is itself part of the argument is still appropriate. Include the same chart near the top of its own source subpage, plus the exact plotted values and transformations there. Reuse the reviewed chart HTML and data; do not rebuild a different chart for the source page. Only image-style visualization embeds execute, for example `![Chart title](visualize:RETURNED_FILE_ID)`; ordinary Markdown links are downloads. Never invent file IDs.

When reusing a visualization or image across Pages, confirm that the current tool contract supports reuse and the file is accessible from each destination Page. A working source-subpage reference or shared Space/parent does not establish destination access. If reuse is unsupported or unverified, create the visualization using the destination Page's ID and the same reviewed HTML, or use its supported image-upload workflow; retain the exact returned reference. Check saved media references through supported Page-scoped reads. Page and file permissions are independent: a successful read verifies the acting user's access, not every reader's access or the rendered result. Repair a failed reference in place without changing the Page's audience or sharing.

Keep charts legible at the Page width: labeled units and dates, readable ticks, sufficient contrast, sensible axes, and enough room for long category names. Avoid truncating labels, scrolling a tiny plot inside a large frame, or crowding several unrelated charts into one embed. State a material nonzero-axis choice in the chart’s source explanation. Do not claim unsupported editing or persistence capabilities.

Pages can use light or dark mode. Apply the shared [colors and appearance guidance](../../../shared/shared-skill-instructions.md#accessible-colors-and-appearance) to report text, tables, and embedded charts. Prefer native Page styling for prose and the visualization host's supported theme colors throughout each chart. Theme the chart background, marks, axes, labels, legends, and tooltips together; changing a wrapper's background or text color may not style its child chart. Avoid fixed light backgrounds with theme-dependent light labels, or the reverse. If a requested style uses a fixed chart background, give its contents a complete, contrasting palette. Standard components supply this appearance without a per-report browser check; inspect both modes only for custom appearance.

## Build source subpages

Follow the shared [source content and title guidance](report-sources.md). Use native sections with a compact overview before detailed data, SQL and calculations. Keep the same organization across sibling sources, omitting inapplicable detail. Add the report backlink and retain the same reviewed chart in each chart source. Preserve complete saved evidence, access and stable source identities while shortening presentation.

## Create and connect the Pages

1. Plan the report’s narrative, chart specifications, and claim/source mapping from reviewed evidence. Prepare and validate chart fragments before the upload phase. Reuse existing relevant Pages if revising; do not make duplicate sources for repeated claims.
2. Create the main Page in the resolved destination once the first useful slice is ready. Include the [progress notice](#show-report-progress) in its initial blocks. Apply [creation metadata](../../../shared/output-and-template-handling.md#creation-metadata) to it and every source child; children do not inherit the namespace. Keep the main Page's returned ID and apply [automatic Page opening](../../../shared/output-and-template-handling.md#opening-and-report-handoff). Create source children under it in citation order, retaining their returned IDs and URLs.
3. Include complete prose and comparison tables in the initial blocks. Write each source child with its inputs, explanation, provenance, results, and report backlink. Once source URLs exist, batch the main Page's citation replacements and chart-source links using the observed blocks. Read the report and chart source together, then upload the same prepared chart to those two independent destinations concurrently. Keep writes to the same Page sequential and use each destination's own current guards. Inspect both results before continuing; retry or repair only the failed destination. Update block-specific backlinks only after observing the main Page’s actual block IDs.
4. Keep the saved identities and mapping available and continue editing the same Pages as the report develops. On a partial failure, verify what was saved and resume; do not restart by creating another report tree.

Follow the live schema for insertion anchors, sequence/hash guards, and HTML upload limits. In particular, do not assume every Page editor accepts `after_block_id` for Markdown insertion; use the supported position object returned by its contract. A visualization size error should be addressed by simplifying the embed or using a supported chart artifact, not by moving the report to Sites.

Keep each Page's latest observed snapshot and write receipts in task state. Read a target and its guidance before its first visualization operation; reuse that read while it is still current. Do not reread the same unchanged source Page before each local calculation or tool call, or read non-chart sources during chart insertion merely to reconstruct their already returned IDs and URLs. Refresh affected state when the contract requires it, after edits that invalidate needed guards/anchors, after an unknown save outcome, or on a conflict. Inspect every operation result; a successful tool call can contain a rejected edit. If an upload already returned a file reference but insertion failed, follow the tool's recovery contract and reuse that uploaded file after access/state checks instead of uploading it again. Finish with one coordinated content readback of the report and source children, plus verification of progress-notice removal after its final edit.

Batch independent Page reads, sharing checks and Page-scoped file reads as well. For example, read both uploaded chart references together rather than adding a round trip per copy. Use settled results so one failure does not hide another Page's successful save; preserve successful identities and receipts. This does not permit parallel edits within one Page or reuse of a file whose destination access is unknown.

## Revise and refresh

Read the current main Page and affected source pages first, including relevant collaborator changes. Apply the smallest requested change with current edit guards. Preserve unrelated content, user edits, parent/Space, audience, source Page IDs, and working citations. Update both copies of an affected chart and its exact values/calculation. If a claim repeats, update all affected mentions while retaining its source identity.

A presentation-only edit uses saved evidence. A requested data refresh rechecks the original source, definitions, comparisons, claims, captions, scope, and timestamps; it does not merely change the as-of label. State newly unavailable inputs and retain traceable prior evidence where needed. Do not apply an HTML app’s scheduler, source-binding API, or publication contract to a Page. Use only a supported, authorized Page refresh mechanism, and do not imply that a saved Page updates automatically.

## Export or share a Page report

For a requested document, slide deck, or PDF, read the current Page and relevant source pages and use the corresponding installed Documents, Presentations, or PDF skill. Preserve its narrative, exact claims, source links, definitions, caveats, and chart meaning. Capture or export the existing chart through supported read-only tools when possible; if a chart must be recreated from saved plotted values, verify it against the original and record that in working evidence. Inspect the resulting artifact with the format skill’s validation workflow. Do not create an intermediate Data app or call app-only snapshot, presentation, or conversion endpoints for a Page.

For a requested shareable summary, use the current Page as evidence and retain its real authorized URL. A Page link does not require Sites publication. Drafting a summary does not authorize sending it or expanding the Page’s audience; follow the requested channel’s write and sharing rules.

## Verify and deliver

Read back the saved report and source pages, including the shared attribution checks. Check the destination/parent metadata, completeness of the narrative, unique source mapping, working citations and backlinks, exact arithmetic, evidence scopes, and every visualization reference. Ensure only numerals are linked in claim citations, chart links say “View source,” raw chart data is in sources, and each chart source contains the same chart. Keep citation destination titles short and recognizable because the host may display them beside numeric links. Check that each source opens with a compact overview before detailed evidence and that each chart has one visible title without a redundant adjacent heading or caption. Confirm that relevant SQL, rows, definitions, timing, and caveats survived any migration or revision.

For standard chart components, content and reference checks complete ordinary authoring. Assume the saved components render; do not poll the browser, test hover or keyboard behavior, check multiple widths/themes, or generate images as a completion gate. Open the main report for the user without waiting for chart initialization. Keep any unperformed visual checks out of the user-facing report; do not claim they ran.

For custom charts, an explicit visual-review request, or a concrete reported rendering failure, use the [Page chart guide](../../visualize-data/docs/rendering/page-chart-fragment.md#custom-charts-and-fallbacks). Inspect only the affected behavior in the intended reader, preserving the interactive embeds. These checks do not become routine checks for standard charts.

Return to the main report if another Page is selected, then use the [Page handoff](../../../shared/output-and-template-handling.md#opening-and-report-handoff), keeping queued opening distinct from confirmed visibility. Do not create an HTML companion, publish a Site, or offer a second location as a required completion step for a successful Spaces report.
