# Adaptive Deliverable Intake Policy

Use this policy before an Investment Banking skill acting as the lead owner creates a new substantive human-facing artifact. It applies to memos, reports, briefings, decks, models, schedules, trackers, dashboards, and monitoring views. Support skills and renderers inherit the lead skill's resolved choices; they do not independently interrupt an already scoped workflow.

## When To Ask

Before source gathering, substantive analysis, building, or rendering, determine whether the user's current prompt and conversation context give high-confidence direction on the deliverable package or output format, level of analysis, intended audience/use, and any decision-critical focus.

- Ask only for choices that are materially unresolved.
- Do not ask the deliverable-package question when the requested surface or package is high-confidence from explicit wording or strong contextual cues, such as a Word memo, HTML report, PowerPoint deck, Excel workbook, dashboard, inline answer, update to an existing artifact, model build, tracker, or combined dashboard-plus-workbook package. The user does not need to name a file extension; infer the surface or package when the prompt and conversation make it clear.
- Treat the deliverable package as materially unresolved for any new memo, report, note, briefing, model, dashboard, tracker, or similar substantive deliverable when two or more surfaces or artifact bundles would be plausible from the prompt. In those semi-ambiguous cases, ask with `request_user_input` before building.
- A format-only request resolves only the delivery surface. For example, "make a doc" can select a Word document, but does not resolve depth, audience/use, or analytical focus. Do not silently infer those choices.
- When editing or reviewing an existing deck, workbook, or document, preserve that artifact's format as the selected surface unless the user asks for a conversion. Ask only missing depth, audience/use, or focus questions that would change the work.
- Apply a saved reader-facing output preference as a bias only when multiple reader-facing formats are reasonable. Do not let a saved HTML preference override an obvious workbook, deck, document, or existing-artifact workflow. Models, model updates, trackers, workbook audits, workbook-first calculations, deck requests, document requests, and edits to an existing artifact keep their natural format unless the user explicitly asks for conversion.
- Reuse answers already given in the current conversation or multi-step workflow. Downstream skills, QC steps, and `dashboard-builder` do not ask again unless a new hero artifact introduces a material unresolved choice.
- Keep these preferences in conversational context; do not add preference fields to manifests, handoff payloads, or renderer schemas.

## Native Prompt Contract

When a material choice remains unresolved and `request_user_input` is callable in an interactive runtime, call `request_user_input` before generating the hero artifact:

- Include only unresolved decisions and no more than three questions.
- Give each question two or three meaningful options.
- The UI supplies a free-form `Other` response automatically; never include an `Other` option in the options list.
- Batch all known material questions into the same `request_user_input` call whenever possible. If deliverable package and analysis assumptions are both unresolved, ask them together up front rather than asking a package question first and a horizon, scenario, depth, or audience question later.
- Filter deliverable-package choices to artifacts that the active runtime can produce. If a requested format is unavailable, ask the user to choose a feasible surface rather than silently substituting one.
- Put the recommended option first and suffix its label with `(Recommended)`.
- Set `autoResolutionMs` so the picker times out to the recommended option when the user does not answer. Use `120000` milliseconds as the normal timeout, `60000` for lightweight preference checks, and up to `240000` only when the choice materially changes the workflow or artifact. If the timeout resolves automatically, continue with the recommended option and disclose that assumption outside the banker-facing artifact.

If `request_user_input` is unavailable or errors in an interactive run, the missing material choices still require intake: ask all known unresolved material questions together in the next normal chat response and wait for the answer. Use a concise numbered list, front-load the questions before any analysis, and keep the same question set you would have sent to `request_user_input`. For bounded choices, show two or three plain-text options with the recommended/default option first and marked `(Recommended)`; if the tool picker would have relied on its automatic free-form option, include `Other/free-form` as the final plain-chat fallback option. For open-ended deal facts, ask a short free-form question. Do not ask the questions one by one unless the user's answer creates a new material ambiguity, and do not silently select deliverable package, depth, horizon, scenario framing, or audience. In a non-interactive run, apply the existing workflow default and state the assumed deliverable package, format, and depth in the result.

When using the interactive chat fallback, ask the grouped questions directly and wait for the answer. Do not suggest switching products or modes instead of asking the unresolved scoping questions.

## Deliverable Package Choices

Use the deliverable-package options for the routed artifact lane. A package option can include more than one artifact when that is likely to match the user's job, such as an HTML dashboard plus an Excel workbook, or a Word memo plus supporting XLSX model. The recommended option should be context-sensitive: pick the most useful first-read artifact and companion set implied by the prompt, not a fixed favorite format.

| Artifact lane | Options |
| --- | --- |
| Formal memo, note, or briefing for banker, committee, board, client, or lender review | `Word document (.docx) (Recommended)`, `Word document (.docx) + Excel support workbook`, `HTML report + Excel support workbook` |
| Source-heavy narrative report, diligence packet, or web-style readout | `HTML report + Excel workbook (Recommended)`, `HTML report only`, `Word document (.docx)` |
| Quick memo answer, narrow update, or conversational briefing | `Inline response (Recommended)`, `Word document (.docx)`, `HTML report` |
| CIM, teaser, or CIM storyboard | `Polished HTML CIM / storyboard (Recommended)`, `PowerPoint storyboard or deck (.pptx)`, `Word document (.docx)` |
| Covenant package, amendment, or waiver review | `Polished HTML covenant review memo + Excel headroom workbook (Recommended)`, `Polished HTML covenant review memo only`, `Excel covenant headroom workbook only` |
| Debtor-side recovery, sale-path, or restructuring alternatives review | `Polished HTML restructuring memo + Excel recovery workbook (Recommended)`, `Polished HTML restructuring memo only`, `Excel recovery waterfall workbook only` |
| Sponsor LBO model, take-private screen, or acquisition-financing model | `Excel sponsor LBO workbook + HTML underwriting summary (Recommended)`, `Excel sponsor LBO workbook only`, `Polished HTML underwriting summary only` |
| Merger model, accretion/dilution screen, or pro forma ownership model | `Excel merger / accretion workbook + HTML transaction summary (Recommended)`, `Excel merger / accretion workbook only`, `Polished HTML transaction summary only` |
| Private credit screen, lender underwriting memo, or acquisition-financing credit review | `Polished HTML lender underwriting memo + Excel lender-case workbook (Recommended)`, `Polished HTML lender underwriting memo only`, `Excel debt-capacity / lender-case workbook only` |
| Deck or presentation | `PowerPoint deck (.pptx) (Recommended)`, `PowerPoint deck + Excel appendix`, `HTML storyboard` |
| Model, schedule, tracker, or tabular package | `Excel workbook + HTML summary/dashboard (Recommended)`, `Excel workbook (.xlsx) only`, `HTML summary/dashboard only` |
| Dashboard or monitoring view | `HTML dashboard + Excel workbook (Recommended)`, `HTML dashboard only`, `Excel tracker/workbook only` |

For single-artifact prompts, labels such as `HTML report (Recommended)` or `Excel workbook (.xlsx) (Recommended)` remain valid when the user's wording makes the companion unnecessary. The chosen package does not remove mandatory calculation or control artifacts. For example, a model workflow may still need its workbook as a companion even when the user wants an HTML executive view. Conversely, if DOCX is offered and selected for a memo, create a real full DOCX rather than a thin companion to HTML.

## Material Ambiguity Choice Sets

Use `request_user_input` for consequential ambiguity. A choice is consequential when it would materially change the banker workflow, deliverable package, first-read artifact, source/control packet, circulation posture, reliance standard, analysis horizon, scenario architecture, or the user's next action. Format ambiguity for a new memo, report, note, or briefing is consequential unless the prompt and conversation already make one surface high-confidence. If the prompt gives a strong answer, proceed with that surface and state any assumptions outside the banker-facing artifact.

Do not use the picker merely because several skills could contribute. The router and lead owner should infer the natural mandate from the prompt whenever possible. Do not ask when the user has already named a format, named a transaction workflow, supplied an existing artifact whose format should be preserved, or asked for a narrow calculation or markup. Support skills, QC, and renderers inherit the owning workflow's resolved choices and do not re-prompt.

When the picker is appropriate, keep it tight:

- Ask one question when one fork controls the work.
- Ask up to three questions only when each answer changes the artifact or analysis path.
- If more than three choices are material, prioritize: deliverable package first, then analysis horizon/scope, then audience/use, source posture, or focus depending on what most changes the work. State any remaining assumptions outside the banker-facing artifact.
- Put the context-specific best option first and suffix its label with `(Recommended)`.
- Do not include an `Other` option; the UI supplies it.
- Filter options to choices the active runtime can execute.
- If the picker is unavailable, ask the same unresolved questions together in plain chat with the recommended choices first and include `Other/free-form` where the picker would have supplied an automatic free-form response.

Use these choice sets as reusable patterns, adapting labels to the client, target, mandate, source packet, or artifact named in the prompt:

| Ambiguity | Use when | Options |
| --- | --- | --- |
| Transaction workflow | A broad banker request could reasonably become sell-side execution, buy-side/committee diligence, or financing/restructuring work. | `Sell-side process/materials (Recommended)`, `Buy-side or committee diligence`, `Financing / restructuring mandate` |
| First sell-side artifact | A sell-side process request does not state whether the immediate need is buyer-facing materials, the outreach universe, or execution tracking/QC. | `CIM/source teardown (Recommended)`, `Buyer universe / outreach wave`, `Process tracker / final QC` |
| Board or committee first artifact | A board, committee, or IC request could start with a decision memo, deck/board book, or model/control pack. | `Decision memo/report first (Recommended)`, `Deck / board book first`, `Model/audit/tracker pack first` |
| Source/control packet | The user references materials or diligence but does not specify whether there is a controlling packet to use before drafting. | `Use named/provided packet as control (Recommended)`, `Build source-control pack first`, `Proceed with public/prompt context and gaps` |
| Capital markets scope | A financing request names a company or mandate but not the instrument lane. | `Compare alternatives (Recommended)`, `Equity / ECM`, `Debt / convertibles / private capital` |
| Existing artifact handling | The user provides or references a workbook, model, deck, CIM, data room extract, or process tracker and wants "update", "review", "fix", or "use this" without stating whether to modify or only assess it. | `Review only / issue log (Recommended)`, `Additive refresh / new version`, `Remediate source artifact` |
| CIM or materials mode | A CIM/materials request does not specify whether the task is diligence/teardown, buyer-facing drafting, or conversion into a source pack or management presentation. | `Teardown/source diligence (Recommended)`, `Draft or refresh buyer-facing CIM`, `Source pack / management presentation conversion` |
| Buyer, lender, or investor universe objective | A universe request lacks the objective that controls scoring and outreach prioritization. | `Maximize valuation / tension (Recommended)`, `Maximize certainty / confidentiality`, `Raise debt or rescue capital` |
| Circulation posture | The user asks for a memo, deck, or model summary but the audience affects language, caveats, evidence, and polish level. | `Internal working draft (Recommended)`, `Senior / committee / board review`, `Client / lender / external circulation` |
| Valuation/model horizon | A DCF, LBO, merger model, capital markets analysis, scenario package, or model update needs a forecast period or time horizon and the prompt does not make it clear. | `5-year forecast / standard model (Recommended)`, `3-year screen`, `10-year long-range model` |
| Scenario framing | A model, valuation, board memo, restructuring, lender, or financing request could use materially different case architecture. | `Base / upside / downside (Recommended)`, `Downside-first risk case`, `Transaction / upside case` |
| Model granularity | A model request leaves whether the user needs a quick screen, reusable banker model, or segment/KPI build unresolved. | `Operating-driver build (Recommended)`, `High-level screen`, `Segment / KPI detail` |

## Depth And Framing

When depth is unresolved, offer:

- `Focused first pass`: top drivers, risks, targeted analysis, and next questions.
- `Full working analysis (Recommended)`: the complete normal working artifact.
- `Deep diligence package`: expanded scenarios, supporting tables, evidence requests, and appendices.

Depth is not readiness. A deeper output is not client-ready, committee-ready, or decision-grade without the evidence and QA gates required by the owning skill.

Use the third question slot for audience/use when it changes structure, circulation posture, citations, or delivery:

- `Banker working team`
- `Senior or committee`
- `Client or external`

If audience is already clear or immaterial and the scope remains broad, ask for focus instead:

- `Valuation / returns`
- `Process / materials`
- `Diligence risks`

## Expected Behavior

- A generic pitch-materials request with no stated surface asks for deliverable package, depth, and audience before building, and recommends `PowerPoint deck (.pptx)`.
- A generic CIM, teaser, or CIM storyboard request recommends a polished HTML document; use PowerPoint without a deliverable-package question only when the request explicitly asks for slides, a deck, a management presentation, or a lender presentation.
- A covenant package, amendment, or waiver review request recommends a polished HTML covenant review memo; use an Excel workbook as the first read without a deliverable-package question when the request is for computed headroom, basket capacity, or scenario calculations.
- A debtor-side sale-path, restructuring-alternatives, or board-recommendation request recommends a polished HTML restructuring memo; use an Excel recovery workbook as the first read without a deliverable-package question when the request is primarily for calculated recoveries, claims waterfalls, or value-break sensitivities.
- A sponsor LBO model, take-private screen, or acquisition-financing model recommends an Excel sponsor LBO workbook; use a polished standalone HTML underwriting summary only when the user selects or explicitly requests a narrative view.
- A merger model, accretion/dilution screen, or pro forma ownership model recommends an Excel merger/accretion workbook; use a polished standalone HTML transaction summary only when the user selects or explicitly requests a narrative view.
- A private-credit initial screen or lender underwriting memo recommends a polished standalone HTML lender underwriting memo; use a workbook as the hero deliverable for reusable debt-capacity, liquidity, covenant, or downside calculations.
- An internal transaction memo request with no high-confidence surface asks for deliverable package before drafting and normally recommends `Word document (.docx)`; when the memo depends on valuation, proceeds, buyer, lender, or scenario analysis, one option should offer a Word memo plus an Excel support workbook.
- Regression prompt: `Prepare an internal transaction memo for this process` with no selected or high-confidence surface should make the first action `request_user_input` with `Word document (.docx) (Recommended)`, `Word document (.docx) + Excel support workbook`, and `HTML report + Excel support workbook`.
- A broad valuation or model request with no high-confidence package or horizon should ask deliverable package and valuation/model horizon in the same `request_user_input` call, recommending `Excel workbook + HTML summary/dashboard (Recommended)` and `5-year forecast / standard model (Recommended)` unless the prompt points elsewhere.
- A dashboard/report/model request that could plausibly require both a reader-facing view and editable analysis may recommend a combined package such as `HTML dashboard + Excel workbook (Recommended)`, with single-artifact alternatives like `HTML dashboard only` or `Excel tracker/workbook only`.
- An HTML memo request or a prompt that clearly implies a web-style source-heavy report skips format intake and asks only any consequential unresolved depth, audience, or focus choice.
- A request to "make a doc" resolves Word format only and still asks for unresolved depth and audience before research begins.
- A review of an existing workbook preserves `.xlsx` as the surface and does not ask whether to turn it into a deck or report.
