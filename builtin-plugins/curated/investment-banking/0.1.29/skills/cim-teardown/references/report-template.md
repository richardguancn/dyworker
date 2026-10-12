# Report Template (Standalone HTML Report + Readability QA)

## Table of contents
1. Output contract
2. Readability rules
3. Default report template
4. Requested-artifact variants
5. Readability QA

---

## 1) Output contract
Unless the user asks for another format, return a polished standalone HTML diligence report following `../../../references/html-artifact-standard.md`. Use chat as the cover note or for explicitly narrow quick screens. Do not create a dashboard render contract or a generic dashboard shell for an ordinary CIM teardown report.

Honor the user's requested format and level of depth. The default deliverable has three layers:
1. compact `Initial IC Recommendation` on one screen
2. curated diligence sections focused on material seller claims, red flags, kill tests, and first-wave gates
3. compact appendices or structured exports for full claims, evidence, questions, red flags, and tasks/workplan when useful

Default report sections:
- `Initial IC Recommendation`
- `Claims That Matter Most`
- `Red Flags And Kill Tests`, integrated with the initial gating table for initial IC screens or limited to incremental risks not already shown there
- `First-Wave Seller Data Request`
- `Quick Underwriting Implications` when price and a cashflow/earnings metric exist
- external triangulation pack when connectors or exports are missing
- executable workplan only when it adds ownership or timing beyond the seller request
- full appendices: `Full claims ledger`, `Full evidence list`, `Full question list`, `Full red-flag register`, and `Full task / workplan list`
- assumptions, missing evidence, and open questions

Default behavior:
- keep the primary deliverable in the HTML report
- create CSV, JSON, or XLSX exports only if the user explicitly asks or reusable structured output is clearly needed
- preserve the same IDs and linkages across the HTML report, chat cover note, and exported files
- if the user asks for less content, compress top-level sections but keep enough audit trail for the main claims, questions, red flags, and tasks
- avoid duplicating the same claim, ask, or risk in a second open-diligence table; use one authoritative row and refer to appendices for detail
- in an initial IC screen, use one primary first-read gating/red-flag table and do not repeat the same risks in a second main-body table
- avoid a navigation bar or contents strip unless report length or complexity makes it materially useful
- when missing seller evidence gates the recommendation, mark manifest posture as `partial`, even when the initial screen itself has been completed
- keep structured IDs and exports when they help downstream modeling, memo drafting, or reusable diligence tracking; they are not a reason to turn the HTML report into a control dashboard

## 2) Readability rules
- The first layer should be `<= 25` lines unless the user explicitly asks for a longer top-level memo.
- Any table shown in chat must be `<= 6` columns.
- Use restrained and readable status labels such as `Verified`, `Needs proof`, and `Gating risk`.
- Every red-flag row must include `What resolves it` in one sentence.
- Keep bullets short enough that an investor can scan the memo in about 60 seconds.
- In first-pass / screen / 60-second prompts, show only the top 3-5 gating items, top 5-8 asks, and top 5-8 red flags in the body. Put full ledgers at the bottom.
- Do not let ID strings or repeated citation chips overwhelm the IC view. Use IDs where they clarify traceability; keep dense cross-linking in appendices.

## 3) Default report template
Use this structure unless the user asks for something shorter:

```markdown
## Setup
Deal / company: `...`
Persona lens: `...`
Primary asset type: `...`
Artifacts used: `...`

---

## Initial IC Recommendation
**Deal snapshot:** ...
**Posture:** `proceed`, `72-hour gated sprint`, `pause`, or `hard pass`

### IC Gates And Kill Tests
| Gate / linked red flag | Why it matters | Proof request | Pause / reprice / pass test |
|---|---|---|---|
| `RF-0001` Gating risk: ... | ... | `E-0001` / `Q-0001`; basis: `sourced/calculated/screening default/assumption` | ... |
| `RF-0002` Needs proof: ... | ... | `E-0004` / `Q-0003` | ... |
| `RF-0003` Needs proof: ... | ... | `E-0006` / `Q-0007` | ... |

**Today's send-to-seller asks:** `E-0001`, `E-0004`, `E-0006`
## Claims That Matter Most
| Claim | Why it matters | Proof status | Required validation |
|---|---|---|---|
| `C-0001` ... | ... | seller claim / calculated / missing support | `E-0001` ... |

---

## Additional Red Flags And Kill Tests
Include only incremental risks not already addressed in `IC Gates And Kill Tests`; place the full red-flag register in the appendix when it would otherwise repeat the first-read table.

| Additional red flag | Impact | What resolves it | Pause / reprice / pass test |
|---|---|---|---|
| `RF-0001` ... | ... | ... | ... |

---

## First-Wave Seller Data Request
| E-ID | Gate | System | Fields / report | Window | Acceptance criteria |
|---|---|---|---|---|---|
| E-0001 | first_wave_gate | ... | ... | ... | ...; basis: `...` |

### Email-ready seller request
Hi team - to resolve the current gating items, please send the following by `DATE/TIME`:
- `E-0001`: `system` -> `fields/report` -> `window` -> `format` -> acceptance: `...`
- `E-0004`: `system` -> `fields/report` -> `window` -> `format` -> acceptance: `...`
- `E-0006`: `system` -> `fields/report` -> `window` -> `format` -> acceptance: `...`

---

## Quick Underwriting Implications
- Headline price: `...`
- Reported metric: `...`
- Implied multiple / cap rate / payback: `...`
- Key sensitivity: `...`
- Unknowns / assumptions: `...`

| Scenario | Metric | Multiple / Yield | Implication |
|---|---:|---:|---|
| Reported | ... | ... | ... |
| Adjusted | ... | ... | ... |
| Normalized | ... | ... | ... |

| Target return view | Required metric | Assumption basis | Gap vs reported |
|---|---:|---|---|
| ... | ... | ... | ... |

---

## Remaining sections
- `Second-wave diligence if gates clear`
- `External triangulation pack (web)` when connectors or primary exports are missing
- `Workplan`, when it adds ownership or timing not already captured in first-wave requests
- `Missing evidence, assumptions, and open questions`
- `Appendix A - Full claims ledger`
- `Appendix B - Full evidence list`
- `Appendix C - Full question list`
- `Appendix D - Full red-flag register`
- `Appendix E - Full task / workplan list`
```

## 4) Requested-artifact variants
- Claims ledger only: lead with the ledger, include citations and evidence gaps, and add only the minimum summary needed to interpret materiality.
- Red-flag register only: lead with severity, linked claims/questions, detection method, evidence needed, `What resolves it`, and potential impact.
- Seller data request only: lead with first-wave gating asks, exact export wording, acceptance criteria, owner, and basis label.
- Workplan only: lead with workstreams, dependencies, owners, deadlines/timing basis, output artifact, and linked IDs.
- External triangulation plan only: lead with the open item, primary source target, fallback source, confidence tier, and decision impact.

## 5) Readability QA
Before sending the result, confirm:
- the `Initial IC Recommendation` exists and is first
- the first layer is concise unless the user asked for a longer executive memo
- the highest-priority gating items are clear
- each gating item links to Evidence IDs and Question IDs when available
- kill criteria are explicit for each gating item
- no table in chat exceeds `6` columns
- every red flag row has `What resolves it`
- first-wave gating asks are separated from broader diligence
- owners, deadlines, acceptance thresholds, and benchmark tolerances are labeled when they are assumptions or screening defaults
- the right asset-specific KPI pack is reflected in the questions and evidence asks
- material CIM credibility anomalies are promoted to the IC view or explicitly deemed non-gating
- any non-CIM fact has a `WEB | ...` citation
- the underwriting section exists when price and earnings or cashflow are present
- the `First-Wave Seller Data Request` appears near the top when the user asks for seller asks or gating diligence
- no separate open-diligence section repeats the gating, red-flag, and first-wave request tables
- initial IC reports use one primary first-read gating/red-flag table and do not duplicate its rows in a second main-body risk table
- the report has no navigation bar or contents strip unless justified by material length or complexity
- a report relying on missing seller evidence uses manifest status `partial`, not unqualified `complete`
- citations are readable at point of use rather than repeated across headings, cells, and section footers
- the HTML has been visually inspected with local headless-browser screenshots
- bottom appendices include the full claims ledger, evidence list, question list, red-flag register, and task/workplan list unless the user explicitly asked for an ultra-short answer
