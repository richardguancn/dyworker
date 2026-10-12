# Output Templates

Use these templates when producing user-facing outputs from the style-guide-adapter skill.

## Table Of Contents

- [Style profile](#style-profile)
- [Restyle change log](#restyle-change-log)
- [Style QC report](#style-qc-report)
- [No-context fallback response](#no-context-fallback-response)
- [Source conflict note](#source-conflict-note)

## Style profile

For structured handoff, wrap this output as `style_profile_package` using the shared `style_guide_adapter_style_profile` contract in `../../../../../../../references/handoff-contracts.md`.

```markdown
# Style profile: [target institution / client / artifact]

## Source basis
| Source | Type | Priority | Freshness | Relevance | Confidence |
|---|---|---:|---|---|---:|

## Style rules
### Visual system
- Colors:
- Fonts / type hierarchy:
- Spacing / grid:
- Logos / marks / imagery:

### Layout grammar
- Titles:
- Footers / sources:
- Section dividers:
- Exhibit placement:
- Appendix treatment:

### Charts and tables
- Chart styling:
- Table styling:
- Units / decimals / number format:
- Scenario / variance color logic:
- Footnotes / sources:

### Writing voice
- Tone:
- Headline style:
- Bullet style:
- Caveat / risk style:
- Citation style:

## Do-not-change rules
- [Sensitive content/data/formulas/citations/notes to preserve]

## Assumptions and open questions
- [Style assumption] [basis] [confidence]
- [Conflict / missing input] [recommended resolution]

## Handoff fields
- style_profile_id:
- target_style_scope:
- style_confidence:
- style_freshness_status:
- visual_review_status: [rendered_review_complete / metadata_only / not_performed / blocked]
- style_limitations:
- circulation_caveats:
```

## Restyle change log

For structured handoff, wrap this output as `style_change_log_package` using the shared `style_guide_adapter_change_log` contract in `../../../../../../../references/handoff-contracts.md`.

```markdown
## Style adaptation summary

**Style sources used:** [sources and confidence]
**Mode:** [extract / apply / create / QC]
**Artifact:** [deck / memo / spreadsheet / text]

### Changes made
| Area | Change | Basis | Confidence |
|---|---|---|---:|
| Visual/layout |  |  |  |
| Charts/tables |  |  |  |
| Writing/voice |  |  |  |
| Footnotes/sources |  |  |  |

### Preserved
- Data/formulas:
- Citations/source links:
- Notes/comments/tracked changes:
- Hidden sheets/slides/appendix:
- Other sensitive elements:

### Open issues
- [Missing source, conflict, or style assumption]

### Handoff fields
- style_profile_id:
- data_formula_source_integrity_status:
- visual_review_status: [rendered_review_complete / metadata_only / not_performed / blocked]
- non_client_ready_reasons:
- downstream_qc_required: [yes / no]
- circulation_caveats:
```

## Style QC report

```markdown
# Style QC report: [artifact]

## Overall assessment
- **Match level:** [high / medium / low]
- **Primary gap:** [one-sentence diagnosis]
- **Highest-priority fixes:** [top 3]

## Findings
| Priority | Location | Issue | Target rule | Recommended fix | Risk if ignored |
|---|---|---|---|---|---|
| High |  |  |  |  |  |

## Source and evidence notes
- [Style facts and inferences]
- [Conflicts or stale-source concerns]
```

## No-context fallback response

When the user provides no style source, do not stop. Use this structure:

```markdown
I can apply a conservative institutional finance style now. Fidelity will improve if you provide a final approved precedent, template, or style guide.

Default style assumptions:
- clean executive layout, high contrast, restrained palette
- concise so-what titles and parallel bullets
- clear source lines, units, and footnotes
- no deletion or overwrite of data, formulas, notes, citations, or hidden content

Next best source to provide: [one targeted ask]
```

Then proceed with the task using generic institutional finance conventions.

## Source conflict note

```markdown
I found a style conflict: [source A] uses [rule], while [source B] uses [rule]. I followed [selected source] because [hierarchy reason]. I left [conflicting item] unchanged / applied [safe compromise] where the conflict was unresolved.
```
