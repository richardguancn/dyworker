# Report sources

Apply this content standard to Page source subpages and HTML source detail. Keep destination-specific creation, rendering and delivery in the selected surface guide.

## Titles and labels

Use a citation number plus a short identifying phrase, usually two or three words: `[1] Sites adoption`, `[2] Weekly activation`, `[3] Rollout timing`. Put the full finding in the source body. Omit redundant `Source` or `Chart:` prefixes. Keep enough context to distinguish sources; follow an explicit preference for numeric-only titles. Use compact numbered links beside claims and reuse the same source identity for repeated evidence. Preserve existing identifiers and numbering when shortening a title.

## Source-page format reference

Use this format as the default for a data-backed Page source subpage or standalone HTML source detail. Replace the placeholders with this source's evidence; they are not facts to copy. Adapt or omit a section only when it does not apply, and state material unknowns rather than inventing them. For a short document-only source, a concise overview and the relevant document evidence may be enough. For app reports, convey the same applicable information through the supported source inspector and its fixed controls; do not alter protected components to reproduce this layout.

The first line is the native Page's title, not an additional heading in its body. In standalone HTML it may be the document heading.

```markdown
# [1] Short source title

## Overview

[One or two sentences: what happened, what the measure counts, and the comparison.]

- **Reporting period:** [Period covered and comparison period, with timezone when relevant.]
- **Population and filters:** [Who or what is included and the material filters.]
- **Caveats:** [Assumptions, unknowns, or limitations needed to interpret the finding.]
- **Metric definition:** [A short definition, including the denominator for a rate.]
- **Source:** [The tables, files, or documents underlying this source.]

## Data

### Source and Provenance

[Identify the saved source, its origin and scope, recorded execution or retrieval time and data cutoff when known, and any unknown freshness.]

### Data Shape

[Describe what one row represents, the number of rows and columns when known, and relevant units or overlap.]

### Column Definitions

- `field_name`: [What this field counts or represents, its unit, and any needed qualification.]
- [Define each field shown or used; identify any definition the evidence does not establish.]

### Saved Data

[Show the complete saved result within the stated scope, or label a preview and link the accessible complete result.]

## SQL Query

[When there is a recorded query, retain the exact SQL and its available run metadata.]

## Evidence Flow

[Give the calculations, transformations, and checks needed to reproduce or qualify the finding.]
```

For Page and standalone HTML sources, keep the overview's labeled bullets visible without opening detail; do not turn them into a single paragraph. Put technical detail behind the overview. For wide results, define every field displayed or used and link the complete schema when available. Keep genuine document or file sources concise and do not manufacture SQL, metadata, or column definitions.

## Source content

Use the dashboard source inspector's information groups: **Overview**, **Data**, **SQL query**, and **Evidence flow**, retaining its [reviewed metric definitions and provenance](../../../output_formats/html/docs/evidence.md#reviewed-data-and-provenance). Express these groups as native Page sections or HTML source-modal content, with supported linked detail where useful. Omit groups that do not apply; the groups are a way to find evidence, not a quota of prose or headings.

Put the **Overview first**, before full tables, SQL, or optional disclosures. Keep the same organization across sibling sources while allowing document evidence to be shorter. A Page source has a backlink; an HTML modal has an accessible close control that returns to the invoking link. Reuse the reviewed chart where the selected surface calls for it.

Scope each description to its actual tables, files or documents and the rows and finding it supports. State the result-changing inclusions, applied filters and relevant exclusions directly, distinguishing source-defined restrictions from additional analysis filters. Include a qualification only where it still affects that source after filtering or aggregation; limitations of excluded rows or unused measures do not belong in every derived source. Preserve material missing-data, denominator, overlap and causal limits. Keep saved or synthetic status clear, but put routine retrieval details in provenance rather than repeating an inventory of absent systems or metadata. Reuse a caveat only after checking that it applies to each source's rows and finding.

- **Overview:** orient a reader with no prior context to what this source supports, then use a short, scannable bullet list in everyday language when the surface supports it. State what happened and the relevant comparison when known, without claiming a cause the evidence does not establish. Use clear labels for the reporting and comparison periods; population and filters; assumptions or caveats that change interpretation; short metric definitions, including rate denominators and aggregation; and source tables, files or documents. Combine related points and omit categories that do not apply. Do not retell the report. Keep each bullet focused and explain unfamiliar terms. State what a measure counts directly instead of adding vague negatives or a list of things it does not measure. Keep definitions and material limitations visible even when a separate source has more detail; for example, identify an unavailable baseline or unknown cohort when it affects the claim. Move run IDs, execution and retrieval timestamps, detailed freshness notes, exact calculations and other provenance into the relevant detail sections unless essential to interpreting the finding. Retain original links and distinguish saved snapshots from verified refreshes there; never imply an unknown value is known.
- **Data:** explain what each row represents, the number of rows and columns when known, the relevant fields and units, and any important definitions that the evidence does not supply. Retain exact inputs and complete saved results within the declared scope, including fields needed to reproduce the result and exact plotted rows. A small table may be the whole section. For large or wide results, show a clearly scoped preview and link a supported durable attachment or accessible canonical result with its scope and limitations. Do not call a preview complete. Reuse canonical evidence with a direct link when several claims share it; each source's own inputs must remain understandable without duplicating the full result.
- **SQL query, when applicable:** retain exact executed SQL and its original run links/IDs, engine, execution time, row counts, and scope. Keep multiple runs distinguishable. A local calculation over saved results links its upstream runs; it is not another query execution. Preserve unknown metadata honestly. Files and documents need no empty SQL section or repeated “not applicable” boilerplate.
- **Evidence flow:** explain only the transformations and checks needed to reproduce or qualify this finding: formulas with actual inputs and denominators, aggregation, chart mappings, filters, ranking/“Other” buckets, rounding, and reconciliation or residuals. Keep unrounded values available. State which checks actually ran; do not turn planned verification into a completed audit or a completeness guarantee. Avoid repeating the overview or narrating tool operations.

For file-backed evidence, name the file, relevant sheet/range or columns, and read/transform details. Keep the necessary rows in the delivered artifact or an authorized attachment readers can open. For document-only sources, retain the title, original link, reviewed passage or concise evidence summary, freshness, and whether it was directly read or only indexed; an overview with that evidence is often sufficient. Preserve all provenance during shortening, including original SQL and saved rows. A presentation edit must not silently rerun the analysis. Keep historical analyses clearly labeled and separate from the current source overview.

Before finishing, read each source opening with all detail closed: the finding, what each number counts, its comparison period and material limits should be understandable there. Exact rows and arithmetic remain available in the detail.
