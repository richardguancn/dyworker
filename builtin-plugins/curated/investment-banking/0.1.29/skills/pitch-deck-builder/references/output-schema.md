# User-Facing Deck Plan Schema

Use this JSON structure for the pitch-deck-builder user-facing deck plan, also called the page plan or structured storyboard. This is the banker-readable control layer that states the deck objective, MD storyline, page sequence, page messages, evidence status, sources, open items, and downstream work needed.

This is not the lower-level slide construction blueprint. Do not use this file to specify exact PowerPoint object geometry, coordinates, component trees, rendering instructions, or slide-engine implementation details. A presentation builder may later translate this plan into a slide blueprint, but this contract should remain focused on what each page needs to say, why it belongs in the deck, what evidence supports it, and what remains unresolved.

Preserve nuance rather than flattening the plan into a simple slide list. The fields below are intended to keep commercial storyline, source discipline, non-destructive editing mode, assumptions, footnotes, open items, and QC status visible before any slide-generation step.

Create the deck plan before any slide generation or lower-level blueprinting. It should capture page purpose, argument, evidence, source needs, diligence items, and senior-review issues rather than exact slide-engine construction.

For each planned slide, define: slide number, conclusion-led title, purpose, key message, recommended visual, required inputs/sources, metrics/calculations, speaker notes or talk track, risks/caveats, downstream skills needed, and evidence status.

## Table Of Contents

- [User-facing deck plan schema](#user-facing-deck-plan-schema)

```json
{
  "deck_metadata": {
    "deck_type": "buyer_pitch | sell_side_pitch | financing_pitch | strategic_alternatives | company_profile | market_map | board_client_meeting",
    "client_or_subject": "string",
    "audience": "string",
    "objective": "string",
    "prepared_date": "YYYY-MM-DD",
    "source_confidence": "high | medium | low",
    "template_or_style_source": "string or unknown",
    "non_destructive_mode": true
  },
  "md_storyline": {
    "recommended_action": "string",
    "why_now": "string",
    "proof_pillars": ["string"],
    "key_risks_or_objections": ["string"],
    "next_steps": ["string"]
  },
  "style_profile_package": "optional package using style_guide_adapter_style_profile",
  "style_change_log_package": "optional package using style_guide_adapter_change_log",
  "sources": [
    {
      "source_id": "S1",
      "name": "string",
      "type": "user_provided | connector | primary | data_provider | public_web | assumption",
      "document_date": "YYYY-MM-DD or unknown",
      "accessed_date": "YYYY-MM-DD or unknown",
      "supports": ["metric or claim"],
      "freshness": "current | stale | unknown",
      "confidence": "high | medium | low"
    }
  ],
  "slides": [
    {
      "slide_number": 1,
      "section": "string",
      "slide_title": "conclusion-led title",
      "slide_purpose": "string",
      "key_message": "string",
      "recommended_visual": "string",
      "content_blocks": ["string"],
      "metrics": [
        {
          "metric": "string",
          "value": "string or number",
          "period": "string",
          "unit": "string or unknown",
          "source_id": "S1 or assumption",
          "evidence_label": "fact | source_derived_estimate | model_derived_estimate | banker_judgment | client_assumption | external_assumption | placeholder | unknown",
          "canonical_evidence_category": "optional shared taxonomy category from ../../../references/evidence-label-taxonomy.md"
        }
      ],
      "speaker_notes": "string",
      "footnotes": ["string"],
      "open_items": ["string"],
      "evidence_status": "supported | needs_source | assumption | placeholder",
      "downstream_skills": ["string"]
    }
  ],
  "appendix": [
    {
      "slide_title": "string",
      "purpose": "string",
      "evidence_status": "supported | needs_source | assumption | placeholder"
    }
  ],
  "qa": {
    "all_material_numbers_sourced": false,
    "template_preserved": true,
    "generic_titles_removed": false,
    "conflicts_disclosed": true,
    "assumptions_labeled": true,
    "ready_for_ib_deck_qc": false
  }
}
```

Do not fill unknown fields with invented information. Use `unknown`, `placeholder`, or `needs_source`.

Preserve pitch-deck-native `evidence_label` values in this schema. When passing a deck plan to another Investment Banking skill, add `canonical_evidence_category` using the crosswalk in `../../../references/evidence-label-taxonomy.md`; do not overwrite labels such as `banker_judgment`, `client_assumption`, `source_derived_estimate`, or `placeholder`.

## Standalone HTML Storyboard Pattern

Use this structure when the user asks for HTML or no native slide tool is available. Produce a polished standalone HTML reader-facing artifact following `../../../references/html-artifact-standard.md`; do not package ordinary storyboard output through `dashboard-builder`.

```markdown
# [Client / Company] [Deck Type] Pitch

Prepared: [date] | Audience: [audience] | Objective: [objective] | Source confidence: [high/medium/low]

## MD-level storyline

[One paragraph: client decision, why now, recommendation.]

## Proposed deck architecture

|   # | Slide title | Purpose | Visual | Evidence status                       |
| --: | ----------- | ------- | ------ | ------------------------------------- |
|   1 | ...         | ...     | ...    | supported / needs_source / assumption |

## Slide-by-slide draft

### 1. [Conclusion-led title]

**Key message:** ... **Recommended visual:** ... **Content:** ... **Speaker notes:** ... **Sources / footnotes:** ... **Open items:** ...

## Source register and open items

[Table]
```

For structured handoffs, use the JSON schema above and validate it with `../scripts/validate_deck_plan_json.py`. Use `../scripts/build_deck_storyboard.py` only when a support storyboard file is explicitly requested or needed by downstream tooling.

## Mapping To `ib-deck-qc`

When the deck plan feeds `ib-deck-qc`, map it to the shared `pitch_deck_builder_to_ib_deck_qc` contract in `../../../references/handoff-contracts.md`:

- `deck_metadata` stays `deck_metadata`.
- `md_storyline` stays `md_storyline`.
- `slides` become `page_plan`, `key_numbers_to_tie`, `claim_register`, and `chart_and_visual_register` as applicable.
- `sources` become `source_log` with `native_evidence_label` and `canonical_evidence_category` added when available.
- `qa` becomes `qa_status`.
- `template_or_style_source`, `style_profile_package`, and `style_change_log_package` carry style context only; they do not prove factual claims.
