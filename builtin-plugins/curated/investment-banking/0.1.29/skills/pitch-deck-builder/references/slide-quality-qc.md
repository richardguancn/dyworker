# Slide Quality QC

Run these checks before delivering any pitch deck or deck blueprint.

## Storyline checks

- The first 3 slides answer what the client should do and why now.
- The deck has a clear commercial recommendation or decision framing.
- The deck is tailored to the audience and not a generic sector overview.
- Each section advances the argument rather than repeating background.
- The final section has a concrete next step.
- A board deck does not restate an already established comparative thesis in another card-summary page unless the repeated page creates a new decision or oversight implication.

## Slide-level checks

- Each slide has an action title that states a conclusion.
- Each slide has one primary message.
- Tables and charts support the title.
- No slide is just a logo dump, tombstone dump, or unprioritized list.
- Dense detail is moved to appendix or backup.
- Key implications are visible without needing the speaker to explain everything.
- Native decks are reviewed using renders of the final exported `.pptx`, not only pre-export layouts or authoring previews.

## Evidence checks

- Every number has period, currency/scale, source, and evidence label.
- Market data includes as-of dates.
- Valuation and financing outputs tie to `comps-valuation`, `dcf-model-builder`, `lbo-model-build`, `private-credit-underwriting`, `covenant-package-analyzer`, or a supplied model/source.
- Buyer, investor, or lender lists are supported by `buyer-investor-list` or clear evidence.
- Assumptions and placeholders are visible.
- Conflicting figures are disclosed and resolved.
- Final QA reporting gives the actual layout warning count and states which warnings were visually reviewed as non-blocking.

## Non-destructive checks

- Existing decks were not overwritten unless explicitly requested.
- Existing slides were not deleted unless explicitly requested.
- Existing speaker notes, comments, charts, and source references were preserved where possible.
- If material was removed from the main flow, it was moved to appendix or listed in the change log unless the user asked for deletion.

## IB polish checks

- Formatting follows the user-provided template or firm style where available.
- Page titles, subtitles, labels, legends, footnotes, and sources are consistent.
- Units are consistent across pages.
- Tables align, decimals are consistent, and negative numbers follow firm convention.
- Chart labels match the underlying data.
- No unsupported superlatives remain: leading, best-in-class, unique, scarce, dominant, highly attractive.

## Final handoff

For final decks, recommend `ib-deck-qc` before circulation. For style work, use `style-guide-adapter` only after factual content is stable.
