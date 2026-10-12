# Investment Banking User Context Onboarding

Use this reference only when the user explicitly asks to set up, resume, defer, quiet, or complete Investment Banking onboarding. Ordinary Investment Banking workflows do not invoke onboarding yet.

## Four-Step Spine

Guide onboarding through exactly four visible steps:

1. Intro and defaults
2. Connectors and plugins
3. Automation
4. Hero workflows

Keep one clear call to action at the end of each onboarding response. Treat a plain `yes`, `okay`, `continue`, or similar reply as approval for the current visible next step unless the user names a different step. Treat `skip`, `not now`, or similar as approval to skip or defer the current optional step and continue.

Durable memory remains available throughout the plugin, but do not turn first-run onboarding into a broad preference questionnaire. Capture the two high-value defaults below when the user wants to provide them, then collect other durable preferences only when the user explicitly asks or supplies them naturally during later work.

## Step 1: Intro And Defaults

Render the canonical response template substantially verbatim. Do not inspect plugins, apps, connectors, or `.app.json` during this first response.

### Orientation Response Template

```text
The Investment Banking plugin helps with banker workflows such as meeting prep, diligence, valuation, process execution, models, and client materials.

Before we connect sources, are there any defaults you want me to use?

- Reader-facing output: polished HTML report, Word document (.docx), concise chat answer, or choose based on the task
- Audience: internal deal team, senior or committee review, client-facing, or choose based on the task

These preferences guide flexible reader-facing outputs only. Workflows with an obvious format, such as models, trackers, workbook updates, deck requests, document requests, or edits to an existing artifact, keep that format.

Reply with any defaults you want saved, or say skip to continue to source setup.
```

Store only user-provided durable defaults in `user-context.md` by following `skills/user-context/references/plugin-memory.md` from the plugin root. Do not infer preferences. Update onboarding state before continuing:

- When the user supplies one or both defaults, set `orientation.status` and `memory_preferences.status` to `completed`.
- When the user skips defaults, set `orientation.status` to `completed` and `memory_preferences.status` to `skipped`.
- When the user defers onboarding, set top-level `status` to `deferred`.
- When the user quiets future setup guidance, set top-level `status` to `quiet`.

After defaults are saved, skipped, or deferred for now, rerun preflight and render its next `copy_ref` so source setup follows immediately.

### Additional Durable Memory

When the user explicitly asks what else can be remembered, keep the answer concise:

- Deliverable style and approved templates
- Process conventions and review cadence
- Trusted folders, VDR pointers, trackers, and source priorities
- Modeling and valuation conventions
- Coverage and market-data preferences
- Confidentiality, circulation, and approval rules

Keep live deal details in the active workflow.

## Step 2: Connectors And Plugins

Render the canonical response template substantially verbatim. Do not inspect plugins, apps, connectors, or `.app.json` until the user approves this step or explicitly asks to configure Investment Banking sources.

### Source Setup Response Template

```text
Next, I can check which Investment Banking plugins and source tools are exposed and save setup routes for future workflows. This does not read source contents. Should I check sources now?
```

When the user approves source setup, follow `skills/user-context/references/source-category-runtime.md` from the plugin root. Keep the result concise: name useful exposed routes, identify categories that still need a choice or access, and end with only the smallest necessary source question or a clear continue-with-current-sources action. Store operational route selections under `onboarding-state.json` `connector_confirmation`; do not store them in `user-context.md`.

Update `source_setup.status` in `onboarding-state.json`:

- Use `completed` after each category is classified and any required user choice is resolved, including when the user continues with known gaps.
- Use `deferred` when the user wants to configure sources later.
- Use `skipped` when the user wants to continue without source setup.

Do not perform proof reads during this setup step. Actual source reads happen only when a focused workflow needs the source. After source setup is completed, skipped, or deferred, move directly to Step 3.

## Step 3: Automation

Render the canonical response template substantially verbatim. This step is optional and requires explicit acceptance before any automation is created.

### Automation Setup Response Template

```text
Next, I can optionally set up a weekly Investment Banking source check in this conversation. It will report upcoming deadlines, stale sources, and missing inputs from saved deal and tracker pointers. It runs weekly on Monday at 9:00 AM local time.

Should I set that up?
```

When the user accepts, follow `skills/user-context/references/automation.md` from the plugin root. Store only concise operational metadata under `onboarding-state.json` `automations`; do not copy automation metadata into `user-context.md`.

Update `automations.status` in `onboarding-state.json`:

- Use `completed` after the accepted automation is created or an existing matching automation is refreshed.
- Use `deferred` when the user wants to decide later.
- Use `skipped` when the user does not want an automation.

After automation setup is completed, skipped, or deferred, move directly to Step 4.

## Step 4: Hero Workflows

Render the canonical response template substantially verbatim. The numbered chooser is the final call to action; do not add a redundant completion question.

### Hero Workflow Response Template

```text
Setup is done for now. Pick the first Investment Banking workflow you want to try:

1. **Prepare For A Coverage Meeting:** Build a source-backed meeting brief for a named public company.
2. **Reconstruct A Public M&A Process:** Turn public proxy disclosures into a transaction timeline, bidder-progression view, and process read.
3. **Build A Public Comps Valuation:** Create a source-backed trading comps report for a named public company.
```

Update `hero_prompt_choice` in `onboarding-state.json`:

- When the user picks a workflow, set `status` to `selected`, save `selected_skill`, save a supplied `selected_anchor` when present, and set top-level `status` to `completed`.
- When the user skips the chooser, set `status` to `skipped` and top-level `status` to `completed`.
- When the user defers the chooser, set `status` to `deferred` and top-level `status` to `completed`.

Use these mappings:

- `1` or Prepare For A Coverage Meeting -> `meeting-prep`
- `2` or Reconstruct A Public M&A Process -> `deal-process-tracker`
- `3` or Build A Public Comps Valuation -> `comps-valuation`

When the user supplies enough intent or an anchor, proceed into the selected workflow. Otherwise ask only for the smallest missing anchor.

## State Repair

Render the canonical response template substantially verbatim. Do not overwrite or reset state unless the user explicitly requests it.

### State Repair Response Template

```text
I could not interpret the Investment Banking onboarding state. It needs repair before setup progress can be read reliably. Would you like me to repair it?
```

## Current Boundary

- Do not invoke onboarding from ordinary Investment Banking workflows yet.
- Do not inspect apps, connectors, plugins, `.app.json`, or source readiness during preflight.
- Inspect source setup surfaces only after the user approves Step 2 or explicitly asks to configure sources.
- Inspect automation state only after the user approves Step 3 or explicitly asks to manage Investment Banking automations.
- Do not claim source readiness or live automation behavior without checking the matching runtime surface.
- Do not mutate state while running `scripts/user_context_preflight.py`.
