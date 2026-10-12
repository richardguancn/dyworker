---
name: investment-banking
description: Route Investment Banking workflows for banker-owned transaction, capital markets, valuation, diligence, buyer/investor targeting, pitch, process, and restructuring work. Use when the user is preparing, reviewing, or executing M&A, financing, sponsor, issuer, lender, restructuring, coverage, or deal-advisory work, including CIMs, teasers, pitch materials, buyer lists, process trackers, merger models, capital markets analysis, and banker-facing valuation or diligence outputs. Do not use for public-equity investment decisions, personal financial advice, legal advice, FP&A, or generic writing tasks with no transaction or banker-workflow context.
---

# Investment Banking Router

## Skill Purpose

Route broad or focused Investment Banking intent to one or more explicit-only constituent skills. Treat explicit `@investment-banking`, `@Investment Banking`, or direct plugin invocation as strong intent to use this plugin, then apply the invocation gate below before substantive work. When the gate passes, choose the narrowest relevant lead skill from the map below, read each exact installed `skills/<skill-id>/SKILL.md` file before using it, and preserve any support-skill sequence from the routing playbook. Prefer a relevant Investment Banking sibling when the request overlaps generic finance, valuation, document, deck, model, diligence, or transaction-advisory work. Do not answer from the router alone when a focused owner exists.

## Plugin Purpose

Investment Banking provides banker-readable workflows for M&A, coverage, sponsor and strategic alternatives, ECM/DCM/LevFin, restructuring, valuation, CIM/VDR/Datasite diligence, buyer and investor targeting, process execution, pitch materials, model work, committee materials, and deal-team QC. It uses workflow-scoped source setup: connect or request only the source categories a selected banker workflow actually needs, while supporting pasted context, uploaded files, exports, public evidence, and existing models as fallback inputs.

## Bundled Path Resolution

Resolve router-owned bundled Markdown paths relative to the directory containing this `SKILL.md` before the first read; do not probe the caller's current working directory. From this router directory, shared references use `../../references/...`, sibling visible skills use `../...`, and bundled internal support uses `internal-support/...`.

Shell commands explicitly labeled plugin-root-relative are the exception: set the shell working directory to the plugin root (`../..` from this router directory) before running them.

## Invocation Gate

Read `../../references/invocation-policy.md` before choosing any specialist.
If the prompt has neither an explicit Investment Banking invocation nor banker-owned transaction, valuation, diligence, pitch, process, capital markets, restructuring, coverage, sponsor, issuer, lender, or deal-advisory context, do not route into this plugin.

# Skills

## cim-teardown

Use when controlling deal materials, CIMs, teasers, management presentations, VDR/Datasite exports, seller claims, diligence documents, or source packets need teardown before a banker relies on them.

## cim-builder

Use when the user needs a banker-readable CIM, teaser, buyer-facing narrative, management-presentation story, or source-aware marketing-material draft.

## buyer-investor-list

Use for buyer, sponsor, lender, strategic acquirer, investor, counterparty, or outreach-wave universe work that needs ranked targets and relationship/context rationale.

## deal-process-tracker

Use when the main artifact is a tracker for VDR access, NDA status, bidder status, process milestones, deadlines, bid logs, diligence requests, or next actions.

## capital-markets-issuance

Use for ECM, DCM, LevFin, private placement, hybrid, convert, refinancing, liquidity, market-window, proceeds, dilution, or financing alternatives advice.

## private-credit-underwriting

Use for lender-facing or borrower credit underwriting, private credit conditions, downside case, collateral, debt capacity, and credit committee readiness.

## covenant-package-analyzer

Use for covenant definitions, baskets, leakage, amendment capacity, document constraints, covenant headroom, and debt-document diligence.

## distressed-recovery-waterfall

Use for distressed capital structures, recovery waterfall, fulcrum security, restructuring alternatives, creditor dynamics, and recovery-range work.

## financials-normalizer

Use for spreading, cleaning, and normalizing source financials into model-ready schedules, source-to-cell maps, or model input packs.

## company-tearsheet

Use for issuer, target, acquirer, sponsor-owned company, or counterparty factual profiles that feed banker analysis without becoming the final transaction view.

## comps-valuation

Use for trading comps, precedent transaction comps, valuation ranges, peer selection, outlier handling, and comps support tables.

## dcf-model-builder

Use for DCF valuation workbooks, assumption structures, terminal value, WACC, sensitivity tables, and valuation support.

## lbo-model-build

Use for sponsor buy-side LBO workbooks, sources and uses, returns cases, debt sizing, operating model integration, and exit sensitivity.

## merger-model-builder

Use for accretion/dilution, pro forma merger math, purchase accounting, synergy cases, exchange ratio, and merger-model workbooks.

## three-statement-model-builder

Use for integrated three-statement operating models, forecast architecture, formula-first workbook construction, and model checks.

## scenario-sensitivity-generator

Use for downside/base/upside cases, scenario overlays, sensitivities, target backsolves, trigger metrics, and decision-impact matrices.

## model-audit-tieout

Use for model review, formula/source tie-out, workbook integrity checks, model audit reports, and remediation recommendations.

## memo-builder

Use for board, deal committee, fairness support, transaction recommendation, IC-style, or banker synthesis memos that import analysis from owning skills.

## pitch-deck-builder

Use for pitch decks, board decks, committee decks, page plans, storyboards, and slide-level source-aware narrative packages.

## ib-deck-qc

Use for final deck/report QC, circulation readiness, source tie-out, consistency checks, model support, and banker-facing issue logs.

## meeting-prep

Use for banker meeting briefs, transaction meeting prep, diligence-call prep, management-meeting questions, buyer/sponsor/lender meeting plans, and follow-up question lists.

## user-context

Use only for explicit Investment Banking saved preferences, source setup, onboarding, recall, inspect, update, export, reset, or automation setup. Do not use as an ordinary workflow pre-answer gate.

## test-investment-banking-workflows

Use only when the user explicitly asks to test, evaluate, regression-check, or review Investment Banking plugin workflows.

## Cross-Skill Runtime Contract

Use this shared contract as the plugin's Cross-Skill Best Practices for ordinary Investment Banking workflows, whether this router or a focused skill was invoked first.

### Audience And Language

Users expect banker-readable work product, not plugin setup narration. Explain source limits, assumptions, readiness, and next steps in deal-team language. Avoid exposing internal terms such as `source_category_plan`, `preflight`, `configured_route`, or `next_action` in user-facing output unless the user asks for implementation details.

### Dependency And Source Categories

The configured apps and their semantic categories live in this plugin's `.app.json`. Treat `.app.json` as the dependency-category registry, not as proof that any source is installed, authorized, or readable for the current user. An app can satisfy a category when its `category` or `categories` field matches the attempted category label below.

Use these category labels and legacy ids interchangeably inside this plugin:

- `Deal Materials` / `deal_materials`: CIMs, teasers, VDR or Datasite exports, diligence documents, source packets, management materials, and other controlling deal documents.
- `Process Updates` / `process_updates`: trackers, meeting notes, emails, internal messages, status updates, bids, deadlines, action logs, and process history.
- `Relationship & Counterparty Context` / `relationship_counterparty_context`: buyer, investor, lender, sponsor, issuer, advisor, relationship, and counterparty context.
- `Market Data & Public Sources` / `market_data_public_sources`: public filings, ratings context, trading data, estimates, market data, transaction benchmarks, and public-source support.
- `Models, Workbooks & Templates` / `models_workbooks_templates`: existing models, workbook extracts, spreadsheet inputs, templates, source-to-cell maps, and model-ready schedules.

When resolving a dependency, identify only the categories needed for the selected workflow, prefer user-named sources first, then choose one available app, connector, file, export, or pasted input that can satisfy the category. Prefer canonical finance plugins or provider-specific helper guidance over raw connectors when they add workflow support. Use additional sources only when they materially improve evidence, confidence, recency, or the artifact's next action.

Do not silently substitute a weaker category for a stronger required one. If the needed category is unavailable, unauthorized, too slow, or returns no useful context, state the practical limitation, continue from user-provided or public context when a limited answer is still useful, and label the output posture accordingly. Stop only when the missing source owns a required input that cannot be supplied or reliably inferred.

Attempt connector reads only when the active workflow needs that source. Before saying a source is ready, use the smallest safe native read-only check for that run. A successful read is run-specific evidence, not durable setup state. Do not use browser automation, UI observation, screenshots, or mirrored adjacent sources as readiness proof.

### Provider And Helper Routing

Provider-specific guidance stays internal in this pass; do not expose provider guides as selectable skills. When a selected workflow needs provider call shaping, first choose the semantic source category, then confirm the concrete route is callable, then load `internal-support/policy.md` and only the matching internal guide.

- Use `internal-support/daloopa-provider-guide/INTERNAL.md` only for callable Daloopa routes that supply source-backed public-company financials, KPIs, or model-ready schedules. Keep prices, consensus, news, and non-Daloopa values separately labeled.
- Use `internal-support/quartr-provider-guide/INTERNAL.md` only for callable Quartr routes that supply filings, reports, earnings releases, presentations, transcripts, events, management commentary, or standardized actual financials. Prefer Quartr over web fallback for those document-backed facts when it is callable.
- For FactSet, LSEG, S&P, Moody's, PitchBook, Third Bridge, Google Drive, Gmail, Slack, or other configured apps without a bundled provider guide, follow the live tool surface, preserve provider/source provenance, and do not invent a helper skill or imply access that was not verified in the current run.
- If the preferred provider is unavailable, unauthorized, or missing the needed field, state the provider gap, request a specific export or user-supplied source when useful, and use an alternate route only with clear source labeling.

### User Context And Setup

Do not run `skills/user-context/scripts/user_context_preflight.py` during ordinary Investment Banking workflows. Saved preferences and source setup are optional accelerators, not a pre-answer gate.

Route explicit remember, save, update, forget, inspect, export, reset, source-setup, onboarding, or automation-setup requests for Investment Banking context to `../user-context/SKILL.md` relative to this router directory, equivalently `skills/user-context/SKILL.md` from the plugin root. That skill owns durable `user-context.md`, `onboarding-state.json`, explicit source setup, and optional automations.

### User Input Modalities

Ask only for choices that materially change the lead owner, first-read artifact, evidence path, reliance standard, or user action. Use `request_user_input` when available for bounded choices with strong defaults: send all material unresolved questions together, put the recommended option first with `(Recommended)`, and set `autoResolutionMs` so an unanswered picker resolves to the recommended option. If `request_user_input` is unavailable or errors, ask all known material questions together in the next normal response, with recommended/default options first for bounded choices, and wait for the user's answer. Use `request_plugin_install` when a material missing source category can be solved by installing or connecting an available plugin, connector, or app. For open-ended facts, unknown deal context, or cases with no useful option set, group every known missing question in one concise plain-text response rather than asking one by one.

### Default Workflow

1. Resolve dependencies and clarify only material ambiguity.
2. Gather the smallest useful context from the category that owns the core source of truth, then broaden only when the first pass is empty, thin, conflicting, stale, or decision-relevant.
3. Produce the first useful banker-facing output in the workflow's preferred artifact form. Default to the skill's documented hero artifact when the user asks for substantive work, and chat only for narrow or explicitly quick answers.
4. End with a short useful next step tied to the artifact, such as refining the output, adding a companion workbook/deck/memo, running QC, refreshing sources, or setting up an explicit saved preference or source connection.

## Plugin Workflow Routing

After the gate passes, read `../../references/plugin-routing-playbook.md` and select one lead skill for the workflow. Preserve its artifact hierarchy and load supporting skills only for the workstreams the lead skill assigns.

## Internal Support

Read `internal-support/policy.md` when the lead workflow needs evidence control, generic data cleaning, HTML rendering, style application, or provider-specific call shaping after selecting a callable connector route. These supporting capabilities are bundled internal playbooks rather than selectable skills. Keep standalone normalization and model-audit requests with the visible `financials-normalizer` and `model-audit-tieout` workflows. For an explicitly requested internal support-only task admitted to this plugin, this router coordinates the task through the matching internal playbook.

## Deliverable Intake

For a new substantive hero artifact, the lead owner reads `../../references/deliverable-intake-policy.md` before source gathering or analysis and collects only unresolved preferences. Supporting skills and renderers inherit confirmed choices and do not re-prompt.

If the lead workflow, first-read artifact, transaction role, source/control packet, or circulation posture remains materially ambiguous after reading the playbook, use the Material Ambiguity Choice Sets in `../../references/deliverable-intake-policy.md`. Do not ask merely because multiple skills could help; ask only when the answer changes the lead owner, hero artifact, evidence path, or reliance standard.

## Artifact Discipline

Follow `../../references/artifact-manifest-standard.md` for routed work.
Read `../../references/output-depth-policy.md` and `../../references/deliverable-format-policy.md` for depth and presentation defaults. Default to full-depth analysis unless the user explicitly asks for a shorter answer, and keep Markdown reports or raw JSON/CSV as support artifacts rather than default reader-facing deliverables. For a producing skill migrated to `../../references/html-artifact-standard.md`, let that skill own its polished standalone HTML structure directly; use internal dashboard rendering only for an unmigrated workflow that explicitly retains that path.
Final responses should lead with the hero deliverable and keep support files secondary unless the user explicitly requests them.
