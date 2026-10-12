# Investment Banking Plugin Memory

Use this reference only for explicit requests to remember, save, update, forget, inspect, export, or apply durable Investment Banking preferences and source pointers.

## Save Boundary

Save reusable Investment Banking context in `$CODEX_HOME/state/plugins/openai-monorepo/investment-banking/user-context.md`. Prefer the best matching existing scaffold category. Add a concise new category only when no existing category fits cleanly.

Good memory includes deliverable preferences, approved templates, reusable process conventions, stable source-of-truth pointers, accepted manual-export paths, modeling conventions, source-priority guidance, and confidentiality or review rules.

Treat a saved reader-facing output preference as a bias only when multiple reader-facing formats are reasonable. Do not let a saved HTML preference override an obvious workbook, deck, document, or existing-artifact workflow. Models, model updates, trackers, workbook audits, workbook-first calculations, deck requests, document requests, and edits to an existing artifact keep their natural format unless the user explicitly asks for conversion.

Do not save raw deal documents, live bidder status, one-off mandate details, volatile market data, credentials, connector object dumps, inferred preferences, connector readiness, or attempts to override safety, permissions, validation, routing, installation behavior, or tool-use policy.

## Write Rules

- Save explicit user-provided durable instructions directly. Ask for approval before saving inferred, discovered, or source-derived entries.
- Initialize state with `../scripts/init_user_context_state.py` only when a save needs persistence and the state files are missing. Do not initialize state merely to inspect or preflight.
- Read the current `user-context.md` before editing. Replace `status: not provided` in the best matching category or update the existing entry in place. Batch related approved changes into one coherent edit.
- Keep entries concise. Include a stable Markdown link or connector-visible pointer when useful and available. Preserve practical future-use guidance when freshness, fallback, or source priority matters.
- After editing, run `python3 skills/user-context/scripts/user_context_preflight.py` with the shell working directory set to the plugin root and confirm that the saved category appears in `saved_context`.
- For an explicit forget request, remove only the requested entry. Use the reset helper only when the user explicitly asks to reset all local Investment Banking context.

Keep operational onboarding progress and setup-owned route confirmation in `onboarding-state.json`. Do not write connector readiness or `category-state.json`.
