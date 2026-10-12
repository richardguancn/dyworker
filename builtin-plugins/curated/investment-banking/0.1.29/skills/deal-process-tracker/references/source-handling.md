# Source Handling and Update Rules

Use this reference when extracting facts from callable connected routes, user-provided exports, uploaded files, existing trackers, or messy notes.

## Table of Contents

- [Source hierarchy](#source-hierarchy)
- [Extraction guidance by source type](#extraction-guidance-by-source-type)
- [Reconciliation rules](#reconciliation-rules)
- [Update rules](#update-rules)
- [Entity normalization](#entity-normalization)
- [Confidence labels](#confidence-labels)
- [Missing-data handling](#missing-data-handling)

## Source hierarchy

Default hierarchy:

1. Current user instructions.
2. Existing tracker or process artifact supplied by the user.
3. Source documents: process letters, signed NDAs, bid letters, CIM/teaser versions, diligence logs, board materials.
4. Callable connected routes or user-provided exports: email, calendar, drive/docs, chat, CRM/deal systems, VDR exports.
5. Public web sources for external market/company context only.
6. Explicit assumptions.

If a lower-priority source conflicts with a higher-priority source, do not overwrite. Mark as conflicting and recommend review.

## Extraction guidance by source type

### Emails

Extract:

- sender/recipient/date/time
- buyer names and contacts
- NDA status/redlines/execution
- buyer interest/pass language
- meeting scheduling
- diligence requests and responses
- process-letter distribution and deadline questions
- IOI/LOI/final bid submissions
- extensions or bid intent statements

Be careful:

- Do not infer a formal pass from silence.
- Distinguish "interested" from "likely to bid."
- Tone can inform judgment but should not be treated as fact.
- Preserve email/source reference for material status changes.

### Calendar

Extract:

- management meetings
- diligence calls
- counsel calls
- board/special committee meetings
- bid deadlines
- process check-ins
- site visits

Be careful:

- A scheduled meeting does not mean completed.
- A cancelled meeting may indicate process risk, but reason may be unknown.

### Data room / VDR exports

Extract:

- access granted date
- users added
- folder permissions
- document views/downloads
- advisors/financing sources added
- last activity date
- restricted-folder access

Be careful:

- Data-room activity is a signal, not proof of bid intent.
- Heavy activity by advisors may reflect confirmatory work or issue hunting.
- Competitor access to sensitive folders requires heightened flagging.

### Existing trackers / spreadsheets

Extract:

- current rows and columns
- formulas/derived fields where visible
- statuses, dates, owners, deadlines
- notes and pass reasons
- hidden assumptions or definitions

Be careful:

- Preserve formulas and formatting when editing existing workbooks.
- Do not delete rows or columns without explicit instruction.
- If cleaning, create a clean version and keep raw/source data.
- Keep original buyer names in an alias/notes field when normalizing.

### Process letters

Extract:

- issue/distribution date
- buyers covered
- bid due date/time/time zone
- required submission components
- valuation format
- financing evidence required
- legal markup requirements
- regulatory approval requirements
- expiration requirements
- submission contacts
- extension/clarification mechanics

Be careful:

- Bid deadlines must include timezone.
- Process-letter changes should be reflected in calendar and change log.
- Different letters to different buyers can create fairness/process issues.

### NDAs

Extract only process-relevant items unless asked for legal analysis:

- sent/executed dates
- status and latest redline
- open issues affecting access/timing
- standstill, affiliate sharing, financing source sharing, clean-team, competitor restrictions, term/expiration
- executed document source

Be careful:

- Flag legal/counsel review needs; do not give definitive legal advice.
- Do not recommend material access if NDA status is unresolved.

### Bid letters / IOIs / LOIs

Extract:

- submission time/date
- valuation range/headline value
- structure and consideration
- assumptions around cash, debt, working capital, debt-like items
- financing commitments/sources
- approvals required
- regulatory conditions
- diligence conditions
- timing to sign/close
- exclusivity request
- expiration
- requested seller/management commitments

Be careful:

- Separate headline value from risk-adjusted value.
- If bid terms are ambiguous, request clarification or mark as unknown.
- Do not round away material economics unless producing a summary.

## Reconciliation rules

When multiple sources mention the same item:

1. Prefer the most direct source: signed NDA over email summary; process letter over calendar invite; bid letter over banker note.
2. Prefer the most recent source when it clearly supersedes prior information.
3. Preserve prior values in the change log.
4. Mark confidence as conflicting when two credible sources disagree.
5. Add a human-review flag for material conflicts.

## Update rules

For each update, create a change-log entry with:

- timestamp/date
- module/tab
- buyer/issue ID
- field changed
- prior value
- new value
- source
- confidence
- human review needed
- rationale/note

Do not update a field when the new source is weaker than the current source unless you mark it as lower confidence or supplemental commentary.

## Entity normalization

Buyer names often appear inconsistently. Use a normalized buyer name and preserve aliases.

Examples:

- "ABC Corp", "ABC Corporation", "ABC" -> normalized buyer name plus aliases.
- sponsor and portfolio company should be linked, not automatically merged.
- parent/subsidiary names should be captured separately when process access or approvals differ.

If uncertain whether two names are the same entity, flag probable duplicate rather than merging.

## Confidence labels

- **confirmed**: directly supported by reliable source.
- **inferred**: reasonable conclusion from behavior or indirect source.
- **unverified**: user note or weak source without corroboration.
- **conflicting**: credible sources disagree.
- **needs human review**: high-impact item, legal/access issue, bid value, or unresolved conflict.

## Missing-data handling

Never hide missing data. Keep fields visible and use:

- missing
- unknown
- not provided
- not applicable
- pending confirmation

For high-impact missing fields, add them to open issues.
