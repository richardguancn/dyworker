from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence

from shared.artifacts import artifact_item, write_artifact_manifest


def write_model_manifest(
    output_dir: str | Path,
    skill: str,
    artifact_mode: str,
    workbook_path: str | Path | None,
    model_status: str,
    support_paths: Sequence[tuple[str | Path, str]] | None = None,
    hard_failures: Sequence[Any] | None = None,
    warnings: Sequence[Any] | None = None,
    extra: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    out = Path(output_dir)
    support_items = []
    for path, description in support_paths or []:
        path_obj = Path(path)
        support_items.append(
            artifact_item(
                path_obj,
                "support_artifact",
                None,
                description,
                False,
                path_obj.name == "model_citations.json",
                "Model support file for audit, import, validation, or downstream dashboard/source-gate use.",
            )
        )
    status = "complete"
    reason = ""
    if model_status in {"blocked", "not-decision-ready"}:
        status = "blocked" if model_status == "blocked" else "partial"
        reason = "Model output has hard failures or is not decision-ready."
    elif model_status in {"screen-grade", "template-ready"}:
        status = "partial"
        reason = "Model is usable as a workpaper but requires source/tie-out review before senior or external reliance."
    manifest_extra = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "model_status": model_status,
        "hard_failure_count": len(list(hard_failures or [])),
        "warning_count": len(list(warnings or [])),
    }
    if extra:
        manifest_extra.update(dict(extra))
    return write_artifact_manifest(
        out,
        skill,
        artifact_mode,
        workbook_path if workbook_path else None,
        support_artifacts=support_items,
        blocked_or_partial_status={
            "status": status,
            "reason": reason,
            "missing_inputs": [],
        },
        extra=manifest_extra,
    )
