# Slide Blueprint Schema

Use this schema only after the deck plan has been approved, stabilized, or otherwise accepted as the controlling page plan.

This is the lower-level slide construction contract for generating or handing off editable presentation pages. It translates the approved page plan into slide-by-slide build instructions: action title, executive takeaway, construction-ready visual choice, content blocks, source references, caveats, and downstream handoffs.

Do not use this schema as the user-facing deck plan or first-pass page architecture. For the user-facing structured handoff, use `output-schema.md` and validate with [`scripts/validate_deck_plan_json.py`](../scripts/validate_deck_plan_json.py). Once that plan is stable, use this blueprint to specify how the presentation should actually be built.

Use this mode only when a downstream tool, agent, or native deck builder needs construction-ready instructions. A blueprint should include executive takeaway, content blocks, visual type, data needed, source IDs, status, and handoffs. Do not use a blueprint to hide unresolved storyline choices, weak sourcing, or missing MD review.

## Deck object

```json
{
  "deck_type": "buyer_pitch | sell_side_pitch | financing_pitch | strategic_alternatives | company_profile | market_map | board_client_meeting",
  "audience": "client / buyer / lender / board / sponsor / internal / other",
  "objective": "decision or action the deck should drive",
  "entity": "company, issuer, borrower, fund, or sector",
  "prepared_date": "YYYY-MM-DD",
  "source_confidence": "high | medium | low",
  "banker_thesis": "one-paragraph thesis or missing-context note",
  "plan_status": "approved | stabilized | md_reviewed | user_confirmed",
  "plan_reference": "path, id, or short description of the approved deck plan",
  "slides": [],
  "source_register": [],
  "assumptions": [],
  "conflicts": [],
  "open_questions": []
}
```

## Slide object

```json
{
  "slide_number": 1,
  "section": "Executive summary",
  "slide_title": "Action-title conclusion",
  "executive_takeaway": "One sentence explaining why the slide matters",
  "slide_purpose": "What decision point this slide supports",
  "recommended_visual": "table | chart | matrix | map | timeline | bridge | bullets | combo",
  "content_blocks": [
    {
      "label": "Key argument",
      "text": "Concise banker-grade content",
      "evidence_label": "fact | source_derived | model_derived | banker_view | assumption | placeholder | unknown",
      "canonical_evidence_category": "optional shared taxonomy category from ../../../references/evidence-label-taxonomy.md",
      "source_ids": ["S1"]
    }
  ],
  "data_needed": ["specific metric, chart, source, or model output"],
  "sources": ["S1"],
  "risks_or_caveats": ["caveat"],
  "status": "ready | needs_source | assumption | placeholder",
  "handoffs": ["company-tearsheet", "comps-valuation", "dcf-model-builder"]
}
```

## Source object

```json
{
  "source_id": "S1",
  "name": "source name",
  "type": "user_file | connected_app | filing | transcript | provider | web | model | assumption",
  "date": "YYYY-MM-DD or unknown",
  "as_of_date": "YYYY-MM-DD or unknown",
  "reliability": "high | medium | low",
  "notes": "period, currency, scale, caveat"
}
```

## Validation rules

- Blueprint should represent a stabilized lower-level construction spec, not an initial user-facing page plan.
- Include `plan_status` and `plan_reference` when available so builders can trace the blueprint back to the approved deck plan.
- Deck must have at least one slide.
- `deck_type` must be one of: `buyer_pitch`, `sell_side_pitch`, `financing_pitch`, `strategic_alternatives`, `company_profile`, `market_map`, `board_client_meeting`.
- Each slide must have an action title, purpose, recommended visual, status, and executive takeaway.
- Slides with `ready` status must have at least one source or explicit `banker_view` / `model_derived` label.
- `placeholder` and `needs_source` slides must not be presented as final.
- Metrics in content blocks should reference source IDs when available.
- Preserve blueprint-native `evidence_label` values. When handing blueprints to another Investment Banking skill, add `canonical_evidence_category` from `../../../references/evidence-label-taxonomy.md` rather than replacing local labels. For example, `banker_view` maps to `inference`, `source_derived` maps to `estimate`, and `placeholder` maps to `unknown`.

## Slide content rules

- Title must state the answer or implication.
- Body must support the title; remove details that do not support the message.
- Include only metrics that matter for the client decision.
- Use chart/table visuals when they clarify the story; do not over-table pages.
- Put citations, footnotes, and source notes in a consistent location.
- Keep placeholders explicit: `[needs source]`, `[client assumption]`, `[banker judgment]`, `[to be confirmed]`.
- Include appendix pages only for support, not to bury important logic.
