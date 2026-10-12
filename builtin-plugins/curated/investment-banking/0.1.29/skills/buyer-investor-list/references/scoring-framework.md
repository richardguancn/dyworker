# Scoring Framework

Use scoring to force discipline, not to create false precision. Always allow MD judgment to override the model with explanation.

## Table of Contents

- [Default scorecard](#default-scorecard)
- [Hero report treatment](#hero-report-treatment)
- [Weight adjustments by objective](#weight-adjustments-by-objective)
- [Tier thresholds](#tier-thresholds)
- [Required row-level outputs](#required-row-level-outputs)
- [Confidence labels](#confidence-labels)
- [Rationale quality test](#rationale-quality-test)

## Default scorecard

Use a 0-5 scale for each positive dimension, then convert to 100-point output.

| Dimension | Default weight | Meaning |
|---|---:|---|
| Strategic or mandate fit | 25% | Product, sector, geography, customer, channel, platform, fund, lender, or investor mandate alignment. |
| Ability to transact | 20% | Corporate balance sheet, fund capacity, check size, hold size, leverage capacity, financing certainty, or approval path. |
| Probability of interest | 20% | Evidence of current strategy, acquisition activity, fundraising, portfolio need, prior interest, or stated mandate. |
| Execution certainty | 15% | Speed, diligence capability, ic complexity, documentation, regulatory burden, financing certainty, reputation. |
| Process value | 10% | Competitive tension, valuation stretch, signaling value, stalking-horse value, financing alternative, relationship leverage. |
| Relationship/access | 10% | Warm path, known decision maker, prior deal history, coverage relationship, responsiveness. |

Script note: `scripts/score_buyer_universe.py` treats `strategic_fit`, `mandate_fit`, `credit_mandate_fit`, and `lender_mandate_fit` as aliases for one combined `strategic_or_mandate_fit` dimension. Do not double count strategic fit and mandate fit as separate 25% buckets.

Risk adjustments are negative and should be called out separately:

| Risk | Typical penalty |
|---|---:|
| High confidentiality risk | -10 to -25 |
| Significant antitrust/regulatory risk | -10 to -30 |
| Portfolio/company conflict | -10 to -30 |
| Financing or capital capacity uncertainty | -5 to -20 |
| Known retrade/leak/bad process behavior | -10 to -30 |
| Weak contact path or stale evidence | -5 to -15 |

## Hero report treatment

Scoring is a working analytical tool, not the first-read recommendation. For a standalone HTML buyer-universe report, lead with tier/wave, buyer thesis, handling requirements, validation needs, next action, and confidence. Include raw scores, penalties, and final scores in the hero table only when the user asks for numerical scoring or the numbers explain a non-obvious sequencing decision.

Do not let a score imply verified interest, ability to transact, client authorization, relationship access, conflict clearance, or regulatory acceptability. A high-scoring party with unverified capacity, ownership, conflicts, or outreach permission must remain conditional or held until the applicable gate clears.

## Weight adjustments by objective

### Maximize valuation

Increase strategic/mandate fit, ability to pay, and process value. Include stretch buyers, but label risk.

### Maximize certainty and speed

Increase execution certainty, relationship/access, and ability to transact. Deprioritize slow strategics, uncertain cross-border buyers, and parties that require heavy education.

### Preserve confidentiality

Increase risk penalty and relationship/access. Prefer trusted parties, sponsors, relationship-led strategics, and staged disclosure. Hold direct competitors unless approved.

### Founder-friendly recap

Increase cultural fit, structure fit, governance flexibility, and founder partnership reputation. Family offices/permanent capital may outrank higher-price but culturally poor sponsors.

### Lender process

Replace strategic fit with credit mandate fit. Increase hold size, leverage appetite, documentation flexibility, speed, and existing relationship. Penalize lenders that cannot lead.

### Distressed/restructuring

Increase speed, legal sophistication, fresh-money capacity, collateral/recovery view, willingness to transact through bankruptcy, and ability to provide dip/exit financing. Penalize slow committees and unclear authority.

## Tier thresholds

Use these as defaults after risk adjustment:

- 85-100: tier 1 / must contact.
- 75-84: tier 1 controlled outreach or tier 2 depending on risk.
- 65-74: tier 2 / strong fit.
- 50-64: tier 3 / selective wave 2 or 3.
- 35-49: watchlist / validate.
- below 35: low priority.

Override thresholds for hard screens:

- Explicit do-not-contact: exclude regardless of score.
- High confidentiality/regulatory risk: hold or controlled outreach even if score is high.
- Insufficient check/hold size: cannot be tier 1 unless participating as part of a syndicate.
- Wrong mandate/structure: exclude or watchlist unless a clear exception exists.

## Required row-level outputs

For each party, include:

- Raw score.
- Risk-adjusted score or qualitative risk-adjusted tier.
- Tier.
- Confidence level: high, medium, low.
- Source quality: direct, structured, public, relationship, inference.
- MD judgment note.
- Recommended action: contact, validate, client approval, hold, exclude.

When using `scripts/score_buyer_universe.py`, these map to appended fields:

| Required concept | Appended field |
|---|---|
| Raw score | `buyer_list_raw_score` |
| Risk-adjusted score | `buyer_list_final_score` |
| Risk penalty | `buyer_list_risk_penalty` |
| Tier | `buyer_list_suggested_tier` |
| Wave | `buyer_list_suggested_wave` |
| Recommended action | `buyer_list_recommended_action` |
| Confidence level | `buyer_list_confidence_level` |
| Source quality | `buyer_list_source_quality` |
| MD judgment note | `buyer_list_md_judgment_note` |
| Score basis / dimensions used | `buyer_list_score_basis` |
| QA exceptions | `buyer_list_qa_flags` |

## Confidence labels

High confidence:

- Multiple recent sources or direct user/connected-source evidence.
- Clear mandate/fit/capacity.
- Credible relationship/contact path.

Medium confidence:

- Good evidence but one or two material gaps remain.
- Fit is strong but capacity, contact, or timing needs validation.

Low confidence:

- Inferred from sector/portfolio/category logic.
- Evidence is stale, thin, or not specific enough.

## Rationale quality test

A rationale is not acceptable unless it answers at least three of the following:

- Why would this party care?
- What specific asset gap or mandate does this fill?
- How can they pay, finance, or hold the investment?
- What evidence suggests interest now?
- What is the best outreach angle?
- What risk should the banker manage?
