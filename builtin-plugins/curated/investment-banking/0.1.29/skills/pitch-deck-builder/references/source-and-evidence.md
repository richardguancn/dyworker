# Source and Evidence Rules

This skill must work with `financial-source-of-truth` when available. Use these rules when that skill is not loaded or when a compact deck-specific protocol is needed.

## Table of Contents

- [Source priority](#source-priority)
- [Context levels](#context-levels)
- [Citation requirements](#citation-requirements)
- [Evidence labels](#evidence-labels)
- [Quality rules](#quality-rules)
- [Source request language](#source-request-language)

## Source priority

1. User-provided files, prompt context, existing decks, models, VDR materials, company/client materials.
2. Callable connected routes and user-provided exports.
3. Primary sources: filings, investor relations, earnings releases, transcripts, company presentations, press releases, exchange filings, credit agreements.
4. Callable financial-data provider routes or user-provided exports: market data, consensus, ownership, transaction databases, credit ratings, private-market databases.
5. Reputable public web and industry sources.
6. Clearly labeled assumptions or placeholders.

## Context levels

### No context provided

- Infer only safe items from the prompt: company name/ticker, industry, transaction type, audience, meeting type, and objective.
- Search callable connected routes or user-provided exports first when available.
- For public entities, use primary filings, investor materials, transcripts, and market-data providers before public summaries.
- For private or unknown entities, return a source request checklist and a strong deck skeleton with placeholders rather than fabricating numbers.

### Partial context provided

- Treat supplied files, notes, and prompt facts as controlling context for the facts they cover.
- Fill non-blocking gaps from callable connected routes, user-provided exports, or reputable public sources only where needed.
- Keep internal/client assumptions separate from externally sourced facts and mark outside-sourced additions as supplemental.
- If an existing deck is supplied, preserve its structure and propose additive pages or replacement language; do not remove content unless requested.

### Full context provided

- Build from the provided source package unless the user asks to supplement.
- Create a source register, identify stale data, source conflicts, missing pages, open questions, and required follow-ups.
- Do not override client, VDR, internal-model, or management-package data with public data unless it is clearly supplemental or the provided data is stale/conflicted.

## Citation requirements

Every material numeric or factual claim should include one of:

- source footnote in slide notes;
- source register row;
- inline citation in a storyboard;
- explicit `needs_source` flag.

A source note should include:

- source name;
- date accessed or document date;
- period covered;
- metric / claim supported;
- confidence: high / medium / low;
- freshness status: current / stale / unknown;
- whether the source is primary, connector, user-provided, public web, or assumption.

## Evidence labels

Use these pitch-deck-native labels in deck plans and page storyboards. Preserve the native value in `evidence_label`; do not replace it with a shared taxonomy category.

- `fact`: directly stated by a reliable source.
- `source_derived_estimate`: calculated from sourced figures.
- `model_derived_estimate`: calculated from a user model or analysis output.
- `banker_judgment`: professional interpretation based on evidence.
- `client_assumption`: assumption supplied by the user/client.
- `external_assumption`: assumption inserted by the agent due to missing data.
- `placeholder`: content intentionally left for later sourcing.
- `unknown`: cannot be determined from available sources.

For downstream handoffs, map these labels to the shared Investment Banking taxonomy at `../../../references/evidence-label-taxonomy.md`. Add a companion `canonical_evidence_category` field when a receiving skill expects shared labels.

| Native pitch-deck label/status | Shared taxonomy category | Handoff note |
| --- | --- | --- |
| `fact` | `verified_fact` or `reported_fact` | Choose based on source hierarchy, exact claim support, and whether the controlling source has been checked. |
| `source_derived_estimate` | `estimate` | Preserve method, input source IDs, period, currency, and scale. |
| `model_derived_estimate` | `estimate` | Cite the model or run output and carry upstream source posture. |
| `banker_judgment` | `inference` | Keep underlying facts visible and avoid proof language. |
| `client_assumption` | `assumption` | Preserve client/user ownership and caveat placement. |
| `external_assumption` | `assumption` | Keep low confidence until replaced by cited support. |
| `placeholder` | `unknown` | Convert to `needs_source`, source request, or open item before decision-grade use. |
| `unknown` | `unknown` | Do not fill with invented support. |
| `needs_source` status | `unknown` | Status only; do not polish into a factual claim. |
| `assumption` status | `assumption` | Status only; preserve the native label and source owner where known. |

Stale or conflicting support can override the mapped category at handoff time under the shared taxonomy precedence rules. For example, a native `fact` with outdated market data should hand off as `stale`, and a cited value with unresolved source variance should hand off as `contradicted`.

## Stale data rules

Flag as stale or potentially stale:

- market prices, rates, spreads, and trading multiples older than 1 market day when presented as current;
- buyer/investor ownership, ratings, debt trading levels, or public-market data older than 30 days unless historical;
- earnings, guidance, consensus, or KPI data superseded by a newer filing/release;
- private-company financials or VDR materials older than 90 days unless the period is explicitly historical;
- process timelines, buyer interest, or financing terms older than the latest client communication.

## Source conflicts

When sources disagree:

1. State the conflict.
2. Identify which source controls and why.
3. Use the controlling source in the main slide.
4. Footnote the conflict or include it in source notes.
5. Do not average or blend without explanation.

## Private and confidential data

If using confidential or user-provided data:

- mark it as user-provided or confidential source context in the source register;
- do not supplement with public data in a way that reveals or contradicts confidential assumptions without flagging;
- preserve anonymization if the user asks for anonymous teaser-style materials.
