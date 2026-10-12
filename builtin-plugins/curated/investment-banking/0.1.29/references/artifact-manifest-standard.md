# Artifact Manifest Standard

Investment Banking skills must make the intended deliverable hierarchy explicit whenever files are written.

The manifest is not the deliverable. It is an audit and routing layer that tells the agent which artifact to show first, which artifacts are useful companions, and which files are support material.

## Required Hierarchy

Every file-writing workflow should resolve to one of these reader-facing shapes:

- XLSX workbook with the first visible tab named `Cover`, `Executive Summary`, or `Dashboard`.
- Polished standalone HTML report owned by a producing skill, or an HTML dashboard from a workflow that still explicitly uses a dashboard rendering path.
- Native deck or document when tooling is available.
- Generated package folder with a clear `first_read.path`.
- Justified `chat_only`, `support_only`, or `blocked` status when no polished file should be created.

CSV, JSON, Markdown, run logs, handoff payloads, debug files, and intermediate files may still be generated, but they are support artifacts by default. Do not make them the primary human deliverable unless the user explicitly requested that machine-readable format.

## Manifest Fields

Each manifest must include:

```json
{
  "manifest_version": "1.0",
  "skill": "skill-name",
  "artifact_mode": "workbook|html_report|html_dashboard|native_deck|native_document|support_only|generated_package|blocked|chat_only",
  "output_dir": "...",
  "first_read": {
    "path": "...",
    "role": "primary human deliverable",
    "why": "Open this first because it is the banker-facing artifact."
  },
  "primary_human_deliverable": "...",
  "human_deliverables": [],
  "companion_deliverables": [],
  "support_artifacts": [],
  "agent_artifacts": [],
  "support_artifacts_user_visible_default": false,
  "blocked_or_partial_status": {
    "status": "complete|partial|blocked|support_only",
    "reason": "",
    "missing_inputs": []
  },
  "final_response_guidance": {
    "lead_with": "primary_human_deliverable",
    "mention_support_artifacts": "only_briefly_unless_requested"
  },
  "discipline_note": "Use the human deliverable as the main output; support artifacts are for audit/import/debug only."
}
```

## Optional Routing Metadata

When the user prompt maps to a plugin-level transaction workflow, add these optional fields so downstream agents understand why the package used a given lead skill, support sequence, and handoff set:

```json
{
  "transaction_workflow": "sell_side_auction|sponsor_buy_side|levfin_financing|ecm|dcm|board_package|fairness_committee_support|restructuring_pitch|model_update|deal_committee",
  "process_status": "signed_transaction_pending_approval|open_marketing_process|exclusive_discussions|internal_draft_only|other_supported_status",
  "marketing_posture": "controlled_use_subject_to_counsel_clearance|buyer_facing_process_permitted|internal_only|other_supported_posture",
  "lead_skill": "memo-builder",
  "supporting_skills": ["model-audit-tieout", "ib-deck-qc"],
  "routing_confidence": "high|medium|low|manual_override|unknown",
  "handoff_contracts_used": ["pitch_deck_builder_to_ib_deck_qc"],
  "routing_reason": "Broad board-package prompt routed to memo-builder as lead because synthesis is the primary artifact; deck QC and model audit are support gates."
}
```

When a signed transaction, exclusivity, go-shop, superior-proposal right, regulatory restriction, or other constraint changes the permissible use of marketing materials, include `process_status` and `marketing_posture`. `transaction_workflow` may still describe the originating mandate, but it must not be allowed to imply that buyer outreach remains open when the process-status fields say otherwise.

Routing metadata is not a deliverable. It explains orchestration and should normally live in `manifest.json` or agent logs. It must not override the artifact hierarchy: the banker-facing human artifact remains the first-read deliverable, and handoff JSON remains support.

## Artifact Item Fields

Every artifact item should include:

- `path`: absolute or output-directory-relative path to the file or folder.
- `role`: `human_deliverable`, `companion_deliverable`, `support_artifact`, or `agent_artifact`.
- `artifact_type`: `xlsx`, `html`, `native_deck`, `native_document`, `csv`, `json`, `markdown`, `log`, `handoff_payload`, `folder`, or another explicit type.
- `description`: plain-English purpose.
- `user_visible_default`: `true` only for banker-facing deliverables.
- `contains_new_analysis`: `true` when the artifact contains analysis not reproduced elsewhere.
- `support_reason`: required for support artifacts.
- `user_requested_machine_readable`: `true` only when the user explicitly asked for CSV, JSON, Markdown, or another machine-readable/default-support output.

## Final Response Rule

Final responses should lead with the hero deliverable, then companion deliverables. Mention support artifacts in one short sentence only when useful for the user's next action or when requested; do not link to manifests or handoff payloads in ordinary delivery responses. Support artifacts should be described as backup, audit, import, debug, or handoff files; do not present them as the thing the banker should open first.
