# HTML Artifact Standard

Use this standard whenever an Investment Banking workflow creates a user-facing HTML artifact. HTML should make the banker-facing question easier to understand and act on, not force every deliverable into the same dashboard shell.

## Design Principles

- Produce a polished, investment-banking-professional artifact appropriate for a deal team, senior banker, committee, board, or client audience as scoped.
- Let the mandate determine the hierarchy. An M&A coverage screen should lead with the coverage angle; a borrower profile should lead with financing and credit relevance; a sell-side target profile should lead with business, transaction, and diligence context.
- Prefer restrained color, readable typography, clear hierarchy, compact decision-useful tables, and generous but disciplined spacing over colorful panels, repeated control surfaces, or a fixed dashboard module inventory.
- Put the first-read banker view, the most important metrics, and the mandate's primary analytical object above supporting detail.
- Use tables, charts, timelines, and callouts only when they reduce interpretation time or support comparison.
- Avoid repeating the same conclusion through a hero box, metric card, action register, and summary section.

## Evidence And Integrity

- Cite material figures, confirmed dates, date-sensitive facts, derived valuation references, management claims, and consequential factual statements close to where the reader uses them.
- Before displaying current valuation, security price, leverage, financing capacity, market data, or transaction value as a headline metric, verify the entity, period, units, and applicable as-of date. If the source is stale or incomplete for the stated use, demote the figure to supporting context or show the gap instead of making it a hero metric.
- Keep citations traceable and readable. Cite a complete figure, fiscal period, date, metric phrase, or statement; do not fragment text such as `FY2025`, `10-K`, `March 31, 2026`, or `$7.8bn` into separately linked tokens.
- Distinguish reported facts, company-defined metrics, analyst calculations, assumptions, stale inputs, and missing diligence evidence in plain banker-facing language.
- Keep evidence gaps proportionate. A compact readiness or diligence block is preferable to a long internal control register unless the requested task is itself an evidence review.
- Do not expose internal renderer contracts, schema fields, manifests, support JSON, or implementation notes in the first-read report unless requested.

## Output And QA

- Deliver one polished standalone HTML file unless the user asks for another format or the workflow's primary deliverable is a workbook, deck, or native document.
- Keep JSON, Markdown, CSV, manifests, logs, render inputs, and handoff payloads secondary unless explicitly requested.
- A standalone HTML report may include concise banker-useful print or export affordances where the workflow warrants them; do not add generic dashboard controls or related-files panels by default.
- Before delivering a substantive HTML artifact, render and visually inspect screenshots of the opening viewport and important downstream sections, then iterate on hierarchy, legibility, clipping, density, citation noise, and whether the mandate is immediately clear.
- For local `.html` files or `file://` URLs, use local headless-browser screenshots rather than the in-app Browser plugin, which may not open local HTML reliably.

## Migration Direction

Producer skills own their standalone HTML structure and banker judgment. A skill that adopts this standard should generate its report directly rather than mapping ordinary narrative analysis into a fixed dashboard contract. Existing skills may retain legacy rendering paths until migrated individually; those paths are transitional and should not define new skill architecture.
