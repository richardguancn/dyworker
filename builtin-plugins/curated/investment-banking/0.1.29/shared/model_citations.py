from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence

REQUIRED_CITATION_FIELDS = {
    "citation_id",
    "workbook_path",
    "sheet",
    "cell_or_range",
    "metric_name",
    "value",
    "formula",
    "source_ids",
    "assumption_flag",
    "tie_out_status",
}
VALID_TIE_OUT_STATUSES = {"tied", "not_tied", "needs_review", "model_generated", "not_applicable"}


def _slug(value: Any) -> str:
    raw = str(value or "").strip().lower()
    raw = re.sub(r"[^a-z0-9]+", "-", raw).strip("-")
    return raw or "citation"


def _col_letter(index_1: int) -> str:
    out = ""
    n = int(index_1)
    while n > 0:
        n, rem = divmod(n - 1, 26)
        out = chr(ord("A") + rem) + out
    return out or "A"


def _cell(row_1: int, col_1: int) -> str:
    return f"{_col_letter(col_1)}{row_1}"


def _stringify_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, sort_keys=True)
    return str(value)


def _source_ids(
    row: Mapping[str, Any], default_source_ids: Sequence[str] | None = None
) -> list[str]:
    value = row.get("source_ids") or row.get("source_id") or row.get("source")
    if isinstance(value, list):
        out = [str(item) for item in value if str(item)]
    elif value:
        out = [str(value)]
    else:
        out = [str(item) for item in (default_source_ids or ["model-output"]) if str(item)]
    return out or ["model-output"]


def citation_item(
    citation_id: str,
    workbook_path: str | Path,
    sheet: str,
    cell_or_range: str,
    metric_name: str,
    value: Any = "",
    formula: str = "",
    source_ids: Sequence[str] | None = None,
    assumption_flag: bool = False,
    tie_out_status: str = "model_generated",
    **extra: Any,
) -> dict[str, Any]:
    sources = [str(item) for item in (source_ids or ["model-output"]) if str(item)] or [
        "model-output"
    ]
    cid = str(
        citation_id or f"model-output:{_slug(sheet)}:{_slug(metric_name)}:{_slug(cell_or_range)}"
    )
    cell_value = str(cell_or_range or "A1")
    item = {
        "citation_id": cid,
        "id": cid,
        "source_id": cid,
        "parent_source_id": sources[0],
        "title": str(metric_name or cid),
        "short_label": f"Model: {sheet}!{cell_value}",
        "type": "model_cell",
        "quality": "model_output",
        "workbook_path": str(workbook_path),
        "sheet": str(sheet),
        "cell_or_range": cell_value,
        "cell": cell_value.split(":", 1)[0],
        "range": cell_value,
        "metric_name": str(metric_name or cid),
        "value": _stringify_value(value),
        "formula": str(formula or ""),
        "source_ids": sources,
        "assumption_flag": bool(assumption_flag),
        "tie_out_status": tie_out_status
        if tie_out_status in VALID_TIE_OUT_STATUSES
        else "needs_review",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "aliases": [str(metric_name or cid)],
        "notes": "Generated workbook-level citation for dashboard/source-gate use.",
    }
    item.update(extra)
    return item


def _table_to_records(table: Any) -> tuple[list[str], list[Mapping[str, Any]]]:
    if not table:
        return [], []
    if isinstance(table, list) and table and isinstance(table[0], Mapping):
        headers: list[str] = []
        for row in table:
            for key in row.keys():
                if str(key) not in headers:
                    headers.append(str(key))
        return headers, [row for row in table if isinstance(row, Mapping)]
    if isinstance(table, list) and table and isinstance(table[0], (list, tuple)):
        headers = [str(item) for item in table[0]]
        records = []
        for row in table[1:]:
            if not isinstance(row, (list, tuple)):
                continue
            records.append(
                {
                    headers[idx] if idx < len(headers) else f"col_{idx + 1}": row[idx]
                    for idx in range(len(row))
                }
            )
        return headers, records
    return [], []


def _value_header(headers: Sequence[str]) -> str | None:
    preferred = ["value", "Value", "metric_value", "amount", "output", "result"]
    for key in preferred:
        if key in headers:
            return key
    return headers[-1] if headers else None


def _metric_name(row: Mapping[str, Any], fallback: str) -> str:
    for key in ("metric_name", "metric", "line_item", "item", "field", "name", "label", "section"):
        if row.get(key) not in (None, ""):
            return str(row.get(key))
    return fallback


def build_model_citations_from_sheets(
    workbook_path: str | Path,
    sheets: Mapping[str, Any],
    default_source_ids: Sequence[str] | None = None,
    max_per_sheet: int = 80,
) -> list[dict[str, Any]]:
    citations: list[dict[str, Any]] = []
    workbook = str(workbook_path)
    seen: set[str] = set()
    for sheet_name, table in sheets.items():
        headers, records = _table_to_records(table)
        if not records:
            continue
        value_header = _value_header(headers)
        value_col_idx = (
            (list(headers).index(value_header) + 1)
            if value_header in headers
            else max(1, len(headers))
        )
        emitted = 0
        for idx, row in enumerate(records, start=2):
            metric = _metric_name(row, f"{sheet_name} row {idx - 1}")
            if not metric.strip():
                continue
            value = row.get(value_header, "") if value_header else ""
            if value in (None, "") and emitted >= 5:
                continue
            cell_ref = _cell(idx, value_col_idx)
            cid = f"model-output:{_slug(sheet_name)}:{_slug(metric)}:{_slug(row.get('scenario', ''))}:{_slug(row.get('period_label', row.get('period', '')))}:{cell_ref.lower()}"
            if cid in seen:
                continue
            seen.add(cid)
            assumption_flag = "assumption" in sheet_name.lower() or "assumption" in metric.lower()
            citations.append(
                citation_item(
                    cid,
                    workbook,
                    str(sheet_name),
                    cell_ref,
                    metric,
                    value,
                    str(row.get("formula", "")),
                    _source_ids(row, default_source_ids),
                    assumption_flag,
                    str(row.get("tie_out_status", "model_generated")),
                    scenario=row.get("scenario", ""),
                    statement=row.get("statement", ""),
                    section=row.get("section", ""),
                    line_item=row.get("line_item", metric),
                    period_label=row.get("period_label", row.get("period", "")),
                    units=row.get("units", ""),
                )
            )
            emitted += 1
            if emitted >= max_per_sheet:
                break
    return citations


def workbook_sheet_names(workbook_path: str | Path) -> list[str]:
    with zipfile.ZipFile(workbook_path) as archive:
        workbook_xml = archive.read("xl/workbook.xml")
    root = ET.fromstring(workbook_xml)
    ns = {"main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    sheets = root.find("main:sheets", ns)
    if sheets is None:
        return []
    return [sheet.attrib.get("name", "Sheet") for sheet in sheets.findall("main:sheet", ns)]


def build_model_citations_for_workbook_outline(
    workbook_path: str | Path, max_sheets: int = 12
) -> list[dict[str, Any]]:
    citations = []
    for sheet in workbook_sheet_names(workbook_path)[:max_sheets]:
        metric = f"{sheet} workbook section"
        citations.append(
            citation_item(
                f"model-output:{_slug(sheet)}:a1",
                workbook_path,
                sheet,
                "A1",
                metric,
                "See workbook section",
                "",
                ["model-output"],
                "assumption" in sheet.lower(),
                "needs_review",
            )
        )
    return citations


def write_model_citations(path: str | Path, citations: Sequence[Mapping[str, Any]]) -> Path:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    validate_model_citations(citations)
    target.write_text(json.dumps(list(citations), indent=2) + "\n", encoding="utf-8")
    return target


def write_model_citations_from_sheets(
    path: str | Path,
    workbook_path: str | Path,
    sheets: Mapping[str, Any],
    default_source_ids: Sequence[str] | None = None,
) -> list[dict[str, Any]]:
    citations = build_model_citations_from_sheets(
        workbook_path, sheets, default_source_ids=default_source_ids
    )
    if not citations:
        citations = build_model_citations_for_workbook_outline(workbook_path)
    write_model_citations(path, citations)
    return citations


def write_model_citations_for_workbook(
    path: str | Path, workbook_path: str | Path
) -> list[dict[str, Any]]:
    citations = build_model_citations_for_workbook_outline(workbook_path)
    write_model_citations(path, citations)
    return citations


def load_model_citations(path: str | Path) -> list[dict[str, Any]]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(payload, dict):
        payload = payload.get("model_citations") or payload.get("workbook_citations") or []
    return [item for item in payload if isinstance(item, dict)] if isinstance(payload, list) else []


def validate_model_citations(
    payload: Sequence[Mapping[str, Any]] | Mapping[str, Any], strict: bool = False
) -> list[str]:
    citations: Sequence[Mapping[str, Any]]
    if isinstance(payload, Mapping):
        citations = payload.get("model_citations") or payload.get("workbook_citations") or []  # type: ignore[assignment]
    else:
        citations = payload
    errors: list[str] = []
    if not isinstance(citations, Sequence) or isinstance(citations, (str, bytes)) or not citations:
        return ["model citations must be a non-empty array"]
    for idx, citation in enumerate(citations):
        prefix = f"citations[{idx}]"
        if not isinstance(citation, Mapping):
            errors.append(f"{prefix} must be an object")
            continue
        missing = sorted(field for field in REQUIRED_CITATION_FIELDS if field not in citation)
        if missing:
            errors.append(f"{prefix} missing required fields: {', '.join(missing)}")
        if citation.get("tie_out_status") not in VALID_TIE_OUT_STATUSES:
            errors.append(f"{prefix}.tie_out_status invalid: {citation.get('tie_out_status')}")
        source_ids = citation.get("source_ids")
        if not isinstance(source_ids, list) or not source_ids:
            errors.append(f"{prefix}.source_ids must be a non-empty array")
        if strict:
            for field in ("citation_id", "workbook_path", "sheet", "cell_or_range", "metric_name"):
                if str(citation.get(field, "")).strip().lower() in {
                    "",
                    "unknown",
                    "not_provided",
                    "n/a",
                }:
                    errors.append(f"{prefix}.{field} cannot be placeholder in strict mode")
    return errors
