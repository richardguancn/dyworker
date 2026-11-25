# Charts embedded in a Page

For a new chart, use the installed Visualize component library and its reviewed interface for the chosen family. Prepare the HTML fragment with the chart configuration, actual component import and reviewed rows. Pass the HTML itself to the advertised Pages visualization upload and insert the returned visualization ID into that same Page. A chat visualization reference or a local file link is insufficient. When a saved chart uses a different renderer, keep its existing implementation.

Supply only reviewed plotted fields, retaining precision and explicit missing values. Keep queries, unplotted source fields and calculation detail in the source Page. The UTF-8 fragment must fit 256 KiB; make any reduction explicit. Pass the fragment itself to the active Page visualization tool and follow the [report/source workflow](../../../../output_formats/space_page/report.md#create-connect-and-finish). Reuse the same fragment in both places.

Assume the successfully prepared and saved standard component renders. Check the save results and final Page references, open the report for the user, and deliver without browser polling, screenshots, hover tests, theme checks or a second offline check. Do not describe assumed rendering as visually verified. Standard component rendering is tested during release qualification.

## Custom charts and fallbacks

Use [custom visuals](custom-visuals.md) only for an unsupported encoding or explicitly requested custom behavior. Use the selected renderer’s validation and exercise custom behavior in the intended reader.

For an explicit visual-review request or a concrete reported failure, follow the shared [chart preservation procedure](../../../../shared/shared-skill-instructions.md#preserve-charts-during-verification). Prefer the host’s in-app viewer and assess each chart on each Page separately. Preserve an interactive chart that works in an intended reader. Loading, a timeout, unavailable inspection or a generic host notice alone does not justify adding an image; record the reader limitation without changing the chart.

If a confirmed rendering or delivery failure remains after those checks and any applicable scoped repair, and no intended reader is known to render that chart, a verified static fallback can replace it. Export and inspect an image from the same reviewed chart input, then replace the failed embed through supported, guarded Page edits. If the image has already been inserted, remove only the failed embed rather than adding another image. Keep the source link immediately below the remaining chart, and preserve unrelated content and working charts. Retain the original HTML and reference in task evidence and disclose that interaction is unavailable.

Keep one representation of each chart per Page; do not retain the failed embed under a collapsed heading. Honor an explicit request for both formats. Reusing the chart on a separate source Page is intentional: assess that Page independently and preserve its chart and source relationship. Check the final saved blocks, chart count and source links without restarting browser verification.
