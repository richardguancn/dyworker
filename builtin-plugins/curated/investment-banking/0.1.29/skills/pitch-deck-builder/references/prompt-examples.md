# Prompt Examples

## No-context request

User: "Build a buyer pitch deck."

Response behavior:
- Ask one targeted question if needed: target/client/audience.
- If proceeding, create a generic buyer-pitch skeleton with placeholders and a source request checklist.
- Do not invent a target or buyer rationale.

## Partial-context request

User: "Build a strategic alternatives deck for ACME. Use the latest model and public comps."

Response behavior:
- Locate/use supplied model or connected files first.
- Use source hierarchy for public comps.
- Draft banker thesis and slide blueprint.
- Label missing valuation, market, or shareholder data.

## Existing deck edit

User: "Refresh this pitch book and make it more MD-ready."

Response behavior:
- Preserve existing deck content by default.
- Create a revised version / proposed revisions.
- Improve storyline, action titles, slide order, source notes, and executive implications.
- Add change log by slide.
- Do not delete pages unless explicitly requested.

## Finished PPTX request

User: "Create a 15-page financing pitch for XYZ using this template."

Response behavior:
- Use the template style, masters, layout, and visual conventions.
- Create a new deck file.
- Include source blocks / notes for external claims.
- Flag placeholders and assumptions.
- Recommend final `ib-deck-qc` before circulation.
