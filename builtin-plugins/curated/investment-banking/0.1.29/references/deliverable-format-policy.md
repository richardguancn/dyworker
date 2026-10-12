# Deliverable Format Policy

Investment Banking skills should be hero-deliverable first.

Before an artifact-owning lead skill begins source gathering or analysis for a new substantive hero deliverable, read `references/deliverable-intake-policy.md` and resolve any materially missing deliverable package, format, analysis horizon/scope, depth, audience/use, or focus preference. Respect an explicit requested surface or package and preserve the format of an existing artifact being reviewed or edited. Support and rendering steps inherit choices already resolved by the lead workflow and do not re-prompt.

## Default Reader-Facing Formats

Use these as primary human deliverables. A resolved deliverable package may contain more than one artifact; pick the primary human deliverable the user should read first, then build any companion workbook, dashboard, deck, issue log, or source-control file needed to make the package complete.

- XLSX workbook for model, tracker, issue-log, normalization, and data-cleaning work.
- The selected or high-confidence inferred deliverable package or surface for substantial memo, note, briefing, report, tearsheet, CIM, teaser, CIM storyboard, credit, diligence, QC, meeting-prep, source-of-truth, or narrative work. When a new written deliverable is semi-ambiguous, use `references/deliverable-intake-policy.md` before choosing. Formal banker, committee, board, client, or lender memos normally recommend a Word document; source-heavy web-style reports normally recommend HTML or an HTML-plus-workbook package; quick conversational notes normally recommend inline response.
- HTML dashboard for explicit MD cockpit, process monitoring, sensitivity dashboard, valuation dashboard, or diligence-overview work.
- Native deck/document when the user asked for a deck, slides, management presentation, lender presentation, style-adapted artifact, or document.
- Chat-only answer when the task is narrow, quick, conversational, or a file would add friction.

For model-heavy work, keep the workbook as the hero deliverable unless the resolved package explicitly makes a dashboard or report the first-read artifact. For workbook-derived HTML claims, cite exact workbook cells or ranges through `model_citations` / `model_citations_path` when available, or cite source IDs with an explicit model-derived label.

For CIM and teaser work, a request for a written draft, storyboard, page flow, or exhibit plan defaults to a polished standalone HTML document unless the user selects another surface. For deck work, use a native deck when slide tools are available. If native deck generation is unavailable, produce an HTML storyboard/report as the reader-facing artifact. JSON deck plans, slide-blueprint JSON, and markdown storyboard files are internal handoff or support artifacts unless the user explicitly asks to receive them.

For covenant package, amendment, or waiver review work, default to a polished standalone HTML finance-side memo. Use a workbook as the hero deliverable for supported covenant headroom, basket-capacity, or scenario calculations. An ordinary covenant review should not acquire a dashboard shell or renderer contract merely because HTML was requested.

For debtor-side sale-path, restructuring-alternatives, or board-recommendation work, default to a polished standalone HTML restructuring memo. Use a workbook as the hero deliverable for calculated recovery waterfalls, claim allocation, collateral waterfalls, or value-break sensitivities. An ordinary recovery or sale-path memo should not acquire a dashboard shell or renderer contract merely because HTML was requested.

For sponsor LBO models, take-private screens, or acquisition-financing model builds, default to a banker-readable XLSX workbook. If HTML is explicitly requested, produce a polished standalone underwriting summary grounded in workbook cell provenance; an ordinary LBO summary should not acquire a dashboard shell or renderer contract merely because HTML was requested.

For merger models, accretion/dilution screens, or pro forma ownership models, default to a banker-readable XLSX workbook. If HTML is explicitly requested, produce a polished standalone transaction summary grounded in workbook cell provenance; an ordinary merger-model summary should not acquire a dashboard shell or renderer contract merely because HTML was requested.

For private-credit initial screens and lender underwriting memos, default to a polished standalone HTML lender underwriting memo. Use a workbook as the hero deliverable when reusable debt sizing, lender-case, liquidity, covenant, or downside calculations are requested or supported. An ordinary lender underwriting memo should not acquire a dashboard shell or renderer contract merely because HTML was requested.

When HTML is selected, high-confidence inferred, or timeout-resolved for a substantive narrative deliverable or package, create the HTML artifact before responding. Do not substitute a full inline Markdown report for the selected HTML deliverable; use the chat response as a concise cover note linking to the hero artifact. When DOCX is selected, high-confidence inferred, or timeout-resolved for a substantive memo, create a real full DOCX as the hero deliverable rather than treating it as a thin companion to HTML. When the package includes both reader-facing HTML and editable XLSX/DOCX/PPTX companions, make each artifact complete enough for its role instead of using the companion as a placeholder.

For workbook work, the first visible tab should be an insight-led `Cover`, `Executive Summary`, or `Dashboard` tab. Follow `references/workbook-first-tab-standard.md`.

## Formats That Should Not Be User-Facing Defaults

Do not make Markdown report files the default rich deliverable. Create a polished standalone HTML report under `references/html-artifact-standard.md` for migrated narrative skills; keep any legacy renderer route transitional while remaining skills are migrated.

Do not present JSON contracts, manifests, run logs, or handoff payloads as the main output. Keep them internal/audit-facing unless the user asks for machine-readable files.

Do not present CSV files as the main answer unless the user explicitly asks for CSV. CSV is appropriate as a backing ledger, import layer, validation table, or workbook source. Explain whether a CSV contains new analysis or only support data.

## Final Response Standard

Every final response after generating artifacts should call out:

1. Hero deliverable: the file, folder, or chat answer the user should look at first.
2. Companion deliverables: HTML dashboard/report, workbook, native deck, or issue log.
3. Supporting artifacts: CSV/JSON/logs, with one sentence explaining why they exist.
4. Blocked or partial status: what is missing and how to unblock it.

If the hero deliverable is a folder, state which file inside the folder is the first read.
If the resolved package contains multiple user-facing deliverables, state which artifact is primary and why the companion exists.
