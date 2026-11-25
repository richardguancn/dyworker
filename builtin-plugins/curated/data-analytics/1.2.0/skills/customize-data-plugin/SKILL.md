---
name: customize-data-plugin
description: Create, update, package, or share reusable Data working conventions and context skills for personal or team use. Use when the user explicitly requests an editable skill for preferred tools, report and dashboard style, or analysis practices.
---

# Customize Data Plugin

Use editable skills for explicitly requested reusable working conventions. This release has no native settings controls or persistent plugin defaults. Apply ordinary preferences to the current task, and explain the limitation when the user asks for plugin settings.

## Overall Instructions

- Before choosing or changing the deliverable, apply [presentation routing](../index/SKILL.md#output-and-presentation). For consequential missing details, use [task intake](../../shared/task-intake.md).
- Apply the [shared Data instructions](../../shared/shared-skill-instructions.md) and the shared guidance referenced below. Use instructions already loaded for this task, including by the index or another skill; read only what is missing.

## Choose the requested scope

- **Today's task only:** Apply the instruction to the task without persisting it. A one-off preference is not permission to create a reusable skill.
- **Reusable working guidance:** Use the workflow below when the user explicitly requests an editable or shareable skill containing tool preferences, analysis practices, style, or conventions.
- **Context reference:** Keep an existing metric-definition or context-layer entry point with its access prerequisites in the requested skill. Follow the shared authoritative-definition policy when the task needs its content; do not copy or redefine governed metrics.

Honor draft-only, source-only, package-only, no-install, and specified-location instructions. For a mixed request, complete each authorized part without restarting intake or repeating a save confirmation.

## Principles

- Reuse supplied scope, sources, answers, and reviewed drafts. Ask only for information that changes the requested result. A single useful instruction is enough; do not require a broader onboarding scan.
- Follow shared [task intake](../../shared/task-intake.md) for missing essentials or requested interaction. Group independently answerable questions when useful; keep dependent choices in order. Put the needed explanation with the question. If waiting for input, make the final response self-contained rather than referring to a collapsed progress message or form.
- Keep working guidance specific to its audience and workflow. Optional team style defaults allow personal variation; they do not redefine metrics or override mandatory requirements. Preserve unrelated content and explicit scope restrictions.
- Write preferences as direct instructions, preserving their meaning without labels such as “explicit user input.” Infer style only from relevant inspected examples; do not infer analytical methods, query budgets, collaboration preferences, or tool choices from their appearance.
- Keep accepted answers, skips, deferrals, and research logs in task notes. Save only useful instructions and their supporting evidence, without generic background, installed-tool inventories, or empty scaffolding.
- Use personal memories only when authorized. Review them before incorporating them into shared packages; exclude secrets, private transcripts, and personal or customer records from shared guidance.

## Save a specific preference

For “always use this tool,” “remember this dashboard style,” or a similar concrete instruction, reuse a matching writable preference skill when available and preserve its audience. Introduce the reusable skill and offer the unresolved content and audience choices together before drafting:

> I can save that in a **context skill**—editable instructions for future work. It can include preferred tools, report and dashboard look and feel, and analysis practices.
>
> **1. What would you like to include?** Just this instruction, more preferences or examples you provide, or relevant context I find by searching your connected tools?
>
> **2. Who is this for?** Your own use or guidance to share with your team?

Omit choices already answered by the request or existing context. Honor “just this instruction,” source-only, and no-scan instructions; do not request more content or research in those cases. Use the actual answers before audience-dependent drafting, and do not infer personal scope from “my plugin.” The offer is an input choice, not a post-completion suggestion to expand later. A scan requires authorization and follows P2; one supplied instruction remains sufficient.

Prepare the smallest useful skill with the supplied instruction and appropriate discovery metadata. Discover a named tool only as needed to resolve its identity; saving a preference does not require querying data or claiming access is verified. For an instruction explicitly requested for the user's future work, complete the supported local save/install outcome after the content and destination are clear, without a second confirmation. Honor no-install or file-only constraints and distinguish prepared files from active guidance.

## Reusable customization workflow

### P1 · Establish coverage

For broader customization, explain briefly that the result is an editable set of instructions for future data work. Useful inputs include preferred tools, report or dashboard examples, style guides, analysis practices, and workflow conventions. Reuse the requested work as coverage; ask “What would you like to customize for future work?” only when it is missing.

For an existing skill update or package request, enter at the affected step. When definitions or source authority affect the requested conventions, apply the shared [Authoritative metrics and definitions](../../shared/metric-definitions.md) policy to read the existing guidance and keep its actual provider pointer distinct from working preferences. Preserve semantic content in legacy combined skills unchanged.

### P2 · Choose an approach

Use supplied instructions or examples immediately. Research is optional unless requested or needed to interpret a supplied source. If the user wants help discovering conventions, offer a bounded scan of relevant connected sources and ask only for missing direction. Do not require a scan decision before drafting from sufficient supplied material. Honor source-only restrictions and show only actual connected capabilities.

If neither useful input nor a research direction exists, ask for a starting point:

> Share the instructions or report/dashboard examples you want me to use, or tell me what to look for in your connected sources.

A scan request authorizes a bounded pass within the established workflow. It does not authorize querying a warehouse to invent preferences. Record newly found candidates and use [Review scan discoveries](#review-scan-discoveries) when selection remains unresolved.

### P1A · Clarify intended audience when needed

Audience matters for reusable packages, not task-only preferences. Reuse explicit personal/shared scope and an existing skill's applicability. Team or company subject matter alone does not establish who should receive the guidance. Ask once only when the distinction materially affects new reusable content:

> Is this for your own use or guidance you want to share with your team or company?

Do independent source inspection while awaiting the answer. Do not interpret silence as personal scope. Keep named teams and workflows as applicability limits; shared guidance does not become company-wide merely because it is packaged. Selecting shared use does not authorize distribution or installation for other people.

If shared defaults and different personal behavior are requested, reuse the stated differences or clarify them. Keep personal exceptions in a separate user-owned skill; do not add a per-preference classification questionnaire.

### Prepare either draft

Use the [annotated context sample](references/sample-context-skill.md), retaining only useful working preferences. Reference an existing canonical layer through its actual entry point and access prerequisites when needed; applicable task context may already provide this. Do not copy, extract, or author domain definitions. Split generated preferences only for distinct audiences or an explicit request, and preserve semantic content and approved layouts in legacy combined skills unchanged.

Each generated `SKILL.md` starts with valid YAML containing a folder-matching `name` and a short `description` defining when to apply the guidance. Describe the audience and data workflow, not an inventory of individual metrics, files, or style tokens. Preserve personal-use and workflow restrictions. For example, “Use when preparing product reports for Acme’s Growth Team” is a useful activation boundary. Remove authoring comments and template-origin citations; retain evidence for actual saved rules.

For new reusable skills, use `context-{team-slug}-{topic-slug}` and match the single-skill plugin name when applicable. Preserve meaningful words from the established company, team, or person name and use a concise topic such as Weekly Reporting. Resolve a missing audience identity only when required to finalize a new package; preserve suitable existing identities and inspect the destination before reusing a name. Keep slugs lowercase ASCII, hyphenated, and no longer than 64 characters. For longer or colliding identities, use a shortened descriptive prefix plus a stable hash suffix; never overwrite unrelated guidance.

Begin generated working guidance with its applicability and scope. Where several levels coexist, use the established hierarchy once:

> More-specific applicable context takes precedence for working conventions; levels to the left take priority.
>
> Individual > Team > Business unit > Company > Default

Mark the established level with **bold** and “(this skill).” This precedence applies to working conventions; authoritative definitions and mandatory rules retain their own authority.

### Write clearly from the first draft

Write for a teammate reviewing the guidance and for the agent applying it. Use short action bullets, precise scope, descriptive labels, and exact tool names or specification values where they matter. Keep detailed visual specifications beside the relevant rule and sources adjacent to supported claims. Do not turn evidence gaps into generic instructions.

During the normal content review, compare the draft with explicit instructions and source evidence. Preserve useful constraints, source locators, uncertainty, and audience boundaries. Fix concrete clarity or accuracy issues without requiring an extra review stage.

### Interpret reporting examples

When a report, deck, or dashboard is supplied as an example, use the relevant artifact-reading skill to inspect text and representative rendered pages when layout, charts, or formatting matter. Text extraction alone does not establish visual style. Cite inspected pages or sections for inferred conventions and disclose visual access limitations.

Draft supported writing, visual, and output-structure conventions as direct instructions scoped to this workflow and audience. The normal draft review lets the user adjust them; no special approval stage is needed. Do not claim an example is an official standard unless that is established. Apply the shared [Authoritative metrics and definitions](../../shared/metric-definitions.md) policy to check labels or calculations against existing definitions; do not encode semantic changes as style preferences. Report missing or conflicting definitions for the source owner to resolve.

### P3A · Research working guidance

Start from supplied references or maintained owner hubs. Inspect relevant official design guides, endorsed reporting examples, and explicit workflow guidance. Distinguish intentional conventions from vendor defaults or incidental past choices. A tool preference inferred from overlapping connectors needs actual evidence that the chosen route is authoritative for that workflow; several installed connectors alone establish nothing.

#### Review scan discoveries

For additional sources discovered in an optional scan, show a compact set of linked candidates, what each would contribute, and consequential access or authority limits. Ask which to include when the user has not already authorized incorporating useful discoveries. Continue independent drafting from supplied or accepted material while selection is pending; silence does not select sources. Do not repeat this checkpoint for already accepted sources, routine verification, or explicit instructions to incorporate the scan results.

After selection, reuse the inspected evidence and continue to the draft. Do not ask the user to approve an empty list of discoveries or restart intake.

### P3B · Use supplied guidance

Preserve the user's instructions, exact URLs, scope, and known uncertainty. Inspect examples as above when needed; do not add a routine question because a link has not yet been read. If promised input has not arrived, request the missing material once. If useful content is already present, draft it.

### P4 · Present the editable draft

Save and validate the useful draft files, then open them in the supported editor when available. State the actual saved files and give a short summary of concrete instructions that will affect future work. Name any existing context-layer dependencies and distinguish team guidance from personal exceptions. Do not claim the editor opened until the action succeeds.

A draft handoff completes a draft request. The user can review it at their convenience; no mandatory review questionnaire, keyword, or separate acknowledgement is needed. An existing installation or packaging request proceeds to P6 without another gate. Otherwise link the files and explain how to request changes or install them through the actual supported route. Honor no-install and file-only outputs.

### P4A · Apply corrections

Apply requested edits to the existing draft, preserve unrelated content, and check the affected files. Accept ordinary instructions to edit, install, or package. If the user wants time to review, leave the draft ready without another question.

### P6 · Finalize the customization

When installation, packaging, or another save outcome was requested, read back the latest edits and follow [packaging and sharing](references/packaging-and-sharing.md). Remove unused placeholders and empty sections, preserve evidence and applicability, and complete the authorized outcome without another confirmation. Explicit future-use instructions authorize the appropriate personal local persistence; draft-only and no-install limits still apply.

Keep existing context-layer dependencies as verified entry points with truthful access prerequisites. Preserve semantic content in legacy combined skills unchanged, and include only shared content in a team package.

### P7 · Customization ready

Report what changed and whether it is saved, prepared, packaged, or installed. For reusable skills, use the [handoff template](references/packaging-and-sharing.md#context-handoff-template), link the actual files, and provide one natural task prompt that matches the saved scope and should invoke it implicitly. Present that prompt as a suggested test, not a claim a behavioral test ran.

For new shared guidance, offer future sharing help. Provide a ZIP and administrator handoff only when sharing or packaging was requested.

## Sharing existing guidance

Enter [packaging and sharing](references/packaging-and-sharing.md) directly. Reuse the selected skill, reviewed scope, and established audience instead of restarting setup. Share only the requested content and required resources; personal guidance outside the team bundle stays private. Resolve only a missing content selection or sharing destination.

For a requested workspace handoff, inspect relevant available sources for a potential administrator, provide the validated package and supported installation instructions, and distinguish a plausible contact from a verified administrator. Do not send messages, distribute the package, or install for others without the relevant request.
