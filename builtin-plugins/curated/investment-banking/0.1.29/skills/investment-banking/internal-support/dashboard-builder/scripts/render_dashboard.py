#!/usr/bin/env python3
"""Render an Investment Banking dashboard contract into a self-contained HTML package."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from collections.abc import Mapping, Sequence
from datetime import datetime, timezone
from html import escape
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import quote

SUPPORTED_MODULES = {
    "metric_strip",
    "verdict",
    "md_question",
    "evidence_posture",
    "table",
    "wide_table",
    "flags",
    "action_register",
    "timeline",
    "funnel",
    "heatmap",
    "line_chart",
    "bar_chart",
    "waterfall",
    "sensitivity_matrix",
    "covenant_grid",
    "valuation_bridge",
    "source_readiness",
}

WIDE_MODULES = {
    "wide_table",
    "action_register",
    "heatmap",
    "line_chart",
    "waterfall",
    "sensitivity_matrix",
    "covenant_grid",
    "valuation_bridge",
}

TONE_ALIASES = {
    "good": "positive",
    "ok": "neutral",
    "medium": "watch",
    "medium-low": "watch",
    "high": "negative",
    "low": "positive",
    "red": "negative",
    "amber": "watch",
    "green": "positive",
    "screen_grade": "watch",
    "screen-grade": "watch",
    "preliminary": "watch",
}

INTERNAL_PHRASES = (
    "hero deliverable",
    "hero model",
    "copy-friendly",
    "markdown report",
    "reader-facing deliverable",
    "primary answer",
    "machine-readable",
    "audit/import",
    "supporting audit",
    "deterministic support",
    "readable transaction analysis companion",
)

_CITATION_MARKER_RE = re.compile(r"\[([A-Za-z][A-Za-z0-9_.:-]{0,80})\]")
_NUMERIC_CITATION_RE = re.compile(
    r"(?<![A-Za-z])(?:[+-]?[$€£]?\d[\d,]*(?:\.\d+)?(?:\s?(?:B|M|K|bn|mm|billion|million|x|bps))?%?|\d{4})(?![A-Za-z])",
    re.IGNORECASE,
)
_MONTH_RE = re.compile(
    r"\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b",
    re.IGNORECASE,
)
_MATERIAL_CITATION_KEYS = {
    "answer",
    "ask",
    "body",
    "callout",
    "cash",
    "count",
    "deadline",
    "debt",
    "dek",
    "detail",
    "ebitda",
    "event",
    "formula",
    "gap",
    "headline",
    "impact",
    "irr",
    "moic",
    "next_action",
    "next_decision",
    "next_step",
    "note",
    "paragraph",
    "read",
    "revenue",
    "score",
    "summary",
    "text",
    "value",
    "why_it_matters",
}
_SKIP_CITATION_KEYS = {
    "_contract_dir",
    "_row_id",
    "accent_color",
    "artifact_type",
    "brand_color",
    "brand_dark_color",
    "citation",
    "citation_ids",
    "citations",
    "display_name",
    "href",
    "html",
    "id",
    "identity_color",
    "link",
    "model_citation_ledger",
    "model_citations_path",
    "path",
    "primary_artifact",
    "source_id",
    "source_ids",
    "source_ref",
    "source_title",
    "source_url",
    "ticker",
    "url",
    "workbook_citations_path",
}
_SOURCE_LEDGER_KEYS = {
    "sources",
    "citations",
    "model_citations",
    "workbook_citations",
    "assumptions",
}
HARD_FAIL_POSTURE_TERMS = {
    "senior",
    "senior-review-ready",
    "client-ready",
    "client",
    "committee-ready",
    "committee",
    "board-ready",
    "board",
    "external",
    "lender-ready",
    "lender",
    "final-circulation-candidate",
    "final-circulation",
}
DRAFT_TOLERANT_POSTURE_TERMS = {
    "draft",
    "screen-grade",
    "screen",
    "preliminary",
    "working-draft",
    "working_draft",
    "source-caveat",
    "source-caveats",
}
SUPPORTED_CITATION_POLICIES = {"warn", "strict", "block_for_senior", "block-for-senior"}
SUPPORT_ARTIFACT_EXTENSIONS = {".csv", ".json", ".md", ".markdown", ".log", ".txt"}
SUPPORT_ARTIFACT_FOLDERS = {"support", "logs", "handoffs", "debug", "legacy"}


def text(value: Any, default: str = "") -> str:
    if value is None:
        return default
    return str(value)


def h(value: Any) -> str:
    return escape(text(value), quote=True)


def slug(value: Any) -> str:
    raw = text(value).strip().lower()
    out = []
    for ch in raw:
        if ch.isalnum():
            out.append(ch)
        elif ch in {" ", "-", "_", "/", ":"}:
            out.append("-")
    cleaned = "".join(out).strip("-")
    while "--" in cleaned:
        cleaned = cleaned.replace("--", "-")
    return cleaned or "section"


def tone(value: Any) -> str:
    raw = text(value, "neutral").strip().lower().replace(" ", "_").replace("-", "_")
    return TONE_ALIASES.get(
        raw, raw if raw in {"positive", "neutral", "watch", "negative", "info"} else "neutral"
    )


def chip(label: Any, tone_value: Any = "neutral", extra_class: str = "") -> str:
    classes = f"tone-chip tone-{tone(tone_value)}"
    if extra_class:
        classes += f" {extra_class}"
    return f'<span class="{classes}">{h(label)}</span>'


def as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def normalize_rows(rows: Any, columns: list[str]) -> list[Any]:
    normalized: list[Any] = []
    for row in as_list(rows):
        if isinstance(row, dict):
            normalized.append(row)
        elif isinstance(row, (list, tuple)):
            normalized.append(list(row))
        else:
            normalized.append([row])
    return normalized


def numeric(value: Any) -> float | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    raw = text(value).replace(",", "").replace("$", "").replace("x", "").replace("%", "").strip()
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def load_shared(shared_dir: Path | None, script_path: Path) -> tuple[str, str]:
    candidates: list[Path] = []
    if shared_dir:
        candidates.append(shared_dir)
    candidates.append(script_path.parents[5] / "shared" / "dashboard")
    for candidate in candidates:
        css_path = candidate / "dashboard.css"
        js_path = candidate / "dashboard.js"
        if css_path.exists() and js_path.exists():
            return css_path.read_text(), js_path.read_text()
    return "", ""


def get_deliverable(contract: dict[str, Any]) -> dict[str, Any]:
    value = contract.get("deliverable")
    return value if isinstance(value, dict) else {}


def get_render_mode(contract: dict[str, Any]) -> str:
    deliverable = get_deliverable(contract)
    mode = deliverable.get("render_mode") or contract.get("render_mode")
    if mode:
        return text(mode).strip().lower()
    if contract.get("report_body") or deliverable.get("report_body"):
        return "report_only" if not contract.get("sections") else "hybrid"
    return "dashboard"


def get_title(contract: dict[str, Any]) -> str:
    deliverable = get_deliverable(contract)
    hero = get_hero(contract)
    return text(
        hero.get("headline")
        or deliverable.get("title")
        or contract.get("dashboard_title")
        or contract.get("report_title")
        or "Investment Banking Dashboard"
    )


def get_hero(contract: dict[str, Any]) -> dict[str, Any]:
    deliverable = get_deliverable(contract)
    hero = (
        contract.get("hero")
        or contract.get("hero_callout")
        or deliverable.get("hero_callout")
        or {}
    )
    if not isinstance(hero, dict):
        hero = {"headline": hero}
    hero = dict(hero)
    if deliverable.get("primary_artifact") and not hero.get("primary_artifact"):
        hero["primary_artifact"] = deliverable.get("primary_artifact")
    if deliverable.get("primary_artifact_type") and not hero.get("artifact_type"):
        hero["artifact_type"] = deliverable.get("primary_artifact_type")
    return hero


def public_text(value: Any, fallback: str = "") -> str:
    raw = text(value).strip()
    if not raw:
        return fallback
    lowered = raw.lower()
    if any(phrase in lowered for phrase in INTERNAL_PHRASES):
        return fallback
    return raw


def plain_readiness(value: Any) -> tuple[str, str, str]:
    raw = text(value).strip()
    clean = raw.lower().replace("_", "-")
    if not raw:
        return "Review Ready", "Ready for review with the source posture shown below.", "neutral"
    if "draft-with-citation-gaps" in clean:
        return (
            "Draft With Citation Gaps",
            "Not for external circulation. Material citation gaps were explicitly accepted as draft-only.",
            "negative",
        )
    if "screen" in clean or "source-caveat" in clean or "draft" in clean or "preliminary" in clean:
        return (
            "Preliminary",
            "Based on available sources and model assumptions; refresh source data before decision use.",
            "watch",
        )
    if "committee" in clean or "decision" in clean or "senior" in clean:
        return (
            "Senior Review Ready",
            "Substantially complete, with the stated caveats and open diligence items.",
            "positive",
        )
    if "blocked" in clean:
        return "Needs Inputs", "Output is limited by missing evidence or source files.", "negative"
    return (
        raw.replace("-", " ").title(),
        "Use with the source and assumption notes shown in the dashboard.",
        "neutral",
    )


def friendly_status(value: Any, fallback_tone: str = "neutral") -> tuple[str, str]:
    raw = text(value).strip()
    clean = raw.lower().replace("_", "-")
    if not raw:
        return "", fallback_tone
    if (
        "screen" in clean
        or "source-caveat" in clean
        or "draft" in clean
        or "preliminary" in clean
        or clean == slug(raw)
    ):
        label, _, status_tone = plain_readiness(raw)
        return label, status_tone
    return raw, fallback_tone


def short_value(value: Any, fallback: str = "Review") -> str:
    raw = public_text(value).strip()
    if not raw:
        return fallback
    for sep in [".", ";", ":", " without ", " because ", " but "]:
        first = raw.split(sep, 1)[0].strip()
        if 10 <= len(first) <= 72:
            return first
    if len(raw) <= 72:
        return raw
    return raw[:69].rsplit(" ", 1)[0].strip() + "..."


def file_href(path: Any) -> str:
    raw = text(path)
    if not raw:
        return "#"
    if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", raw):
        return raw
    if raw.startswith("/"):
        return "file://" + raw
    return raw


def file_label(path: Any, artifact_type: Any = "") -> str:
    lower = f"{path} {artifact_type}".lower()
    if ".xlsx" in lower or "workbook" in lower or "excel" in lower:
        return "Open workbook"
    if ".ppt" in lower or "deck" in lower:
        return "Open deck"
    if ".doc" in lower or "memo" in lower:
        return "Open document"
    if ".csv" in lower or "table" in lower:
        return "Open table"
    if ".json" in lower or "audit" in lower or "log" in lower:
        return "Open support file"
    if ".html" in lower or "dashboard" in lower or "report" in lower:
        return "Open report"
    return "Open file"


def path_extension(path: Any) -> str:
    raw = text(path).split("#", 1)[0].split("?", 1)[0].rstrip("/")
    if not raw:
        return ""
    return Path(raw).suffix.lower()


def is_support_artifact(path: Any, artifact_type: Any = "") -> bool:
    raw = text(path).strip().lower()
    if not raw:
        return False
    artifact = text(artifact_type).strip().lower()
    if path_extension(raw) in SUPPORT_ARTIFACT_EXTENSIONS:
        return True
    if any(term in artifact for term in ["json", "csv", "markdown", "log", "handoff", "support"]):
        return True
    parts = [part for part in re.split(r"[\\/]+", raw) if part]
    return any(part in SUPPORT_ARTIFACT_FOLDERS for part in parts)


def is_current_html_artifact(path: Any, output_file: str) -> bool:
    raw = text(path).split("#", 1)[0].split("?", 1)[0].rstrip("/")
    if not raw or path_extension(raw) != ".html":
        return False
    return Path(raw).name == output_file


def is_human_artifact(path: Any, artifact_type: Any = "", output_file: str = "") -> bool:
    raw = text(path).strip()
    if not raw or raw == "#":
        return False
    if output_file and is_current_html_artifact(raw, output_file):
        return False
    if is_support_artifact(raw, artifact_type):
        return False
    ext = path_extension(raw)
    artifact = text(artifact_type).lower()
    if ext in {".xlsx", ".xlsm", ".xls", ".pptx", ".ppt", ".docx", ".doc", ".pdf", ".html"}:
        return True
    if any(
        term in artifact
        for term in ["workbook", "model", "deck", "document", "memo", "report", "dashboard", "pdf"]
    ):
        return True
    return False


def hero_action_label(path: Any, artifact_type: Any = "", label: Any = "") -> str:
    explicit = public_text(label).strip()
    if explicit:
        return explicit
    return file_label(path, artifact_type)


def normalize_hero_actions(contract: dict[str, Any], output_file: str) -> list[dict[str, str]]:
    deliverable = get_deliverable(contract)
    hero = get_hero(contract)
    actions: list[dict[str, str]] = []
    raw_actions = as_list(deliverable.get("hero_actions") or hero.get("actions"))
    for item in raw_actions:
        if not isinstance(item, Mapping):
            item = {"path": item}
        path = (
            item.get("path")
            or item.get("href")
            or item.get("artifact")
            or item.get("primary_artifact")
        )
        artifact_type = (
            item.get("artifact_type") or item.get("type") or item.get("primary_artifact_type")
        )
        if not is_human_artifact(path, artifact_type, output_file):
            continue
        actions.append(
            {
                "label": hero_action_label(path, artifact_type, item.get("label")),
                "href": file_href(path),
                "path": text(path),
                "artifact_type": text(artifact_type),
            }
        )
    primary = hero.get("primary_artifact") or deliverable.get("primary_artifact")
    primary_type = hero.get("artifact_type") or deliverable.get("primary_artifact_type")
    if is_human_artifact(primary, primary_type, output_file):
        href = file_href(primary)
        if not any(action["href"] == href for action in actions):
            actions.insert(
                0,
                {
                    "label": hero_action_label(primary, primary_type),
                    "href": href,
                    "path": text(primary),
                    "artifact_type": text(primary_type),
                },
            )
    return actions


def workbook_ref(src: dict[str, Any]) -> str:
    sheet = text(src.get("sheet") or src.get("worksheet") or src.get("tab")).strip()
    cell_range = text(src.get("range") or src.get("cell") or src.get("cells")).strip()
    if sheet and cell_range:
        return f"{sheet}!{cell_range}"
    return sheet or cell_range


def is_workbook_source(src: dict[str, Any]) -> bool:
    source_type = text(src.get("type") or src.get("category")).lower()
    return bool(
        src.get("workbook_path")
        or src.get("workbook")
        or src.get("sheet")
        or src.get("range")
        or src.get("cell")
        or source_type in {"model_cell", "workbook_cell", "workbook_range"}
    )


def workbook_href(src: dict[str, Any]) -> str:
    path = (
        src.get("workbook_path")
        or src.get("workbook")
        or src.get("path")
        or src.get("href")
        or src.get("url")
    )
    if not path:
        return ""
    href = file_href(path)
    ref = workbook_ref(src)
    if ref:
        sep = "&" if "#" in href else "#"
        href = f"{href}{sep}sheet={quote(text(src.get('sheet') or src.get('worksheet') or src.get('tab')), safe='')}&range={quote(text(src.get('range') or src.get('cell') or src.get('cells')), safe='')}"
    return href


def workbook_location_label(src: dict[str, Any]) -> str:
    ref = workbook_ref(src)
    if ref:
        return ref
    if src.get("workbook_path") or src.get("workbook") or src.get("path"):
        return file_label(
            src.get("workbook_path") or src.get("workbook") or src.get("path"), "workbook"
        )
    return ""


def identity_text(contract: dict[str, Any]) -> str:
    issuer = contract.get("issuer") if isinstance(contract.get("issuer"), dict) else {}
    raw = text(
        issuer.get("ticker")
        or contract.get("ticker")
        or contract.get("entity")
        or get_title(contract)
    )
    clean = re.sub(r"[^A-Za-z0-9]", "", raw.upper())
    if len(clean) <= 4 and clean:
        return clean
    words = re.findall(r"[A-Za-z0-9]+", raw.upper())
    initials = "".join(word[0] for word in words[:4])
    return initials or "IB"


def safe_color(color: Any, default: str = "#245f5a") -> str:
    raw = text(color).strip()
    return raw if re.match(r"^#[0-9A-Fa-f]{6}$", raw) else default


def resolve_contract_path(contract: dict[str, Any], path_value: Any) -> Path | None:
    raw = text(path_value).strip()
    if not raw:
        return None
    if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", raw):
        return None
    path = Path(raw)
    if not path.is_absolute() and contract.get("_contract_dir"):
        path = Path(text(contract.get("_contract_dir"))) / path
    return path


def load_source_records_from_path(
    contract: dict[str, Any], path_value: Any
) -> list[dict[str, Any]]:
    path = resolve_contract_path(contract, path_value)
    if not path or not path.exists():
        return []
    try:
        payload = json.loads(path.read_text())
    except Exception:
        return []
    if isinstance(payload, dict):
        if isinstance(payload.get("model_citations"), list):
            return [item for item in payload["model_citations"] if isinstance(item, dict)]
        if isinstance(payload.get("workbook_citations"), list):
            return [item for item in payload["workbook_citations"] if isinstance(item, dict)]
        return [dict(value, id=key) for key, value in payload.items() if isinstance(value, dict)]
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    return []


def source_records(contract: dict[str, Any]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    deliverable = get_deliverable(contract)
    for source in [
        contract.get("citations"),
        contract.get("sources"),
        deliverable.get("sources"),
        contract.get("model_citations"),
        contract.get("workbook_citations"),
        deliverable.get("model_citations"),
        deliverable.get("workbook_citations"),
    ]:
        if isinstance(source, dict):
            iterable = []
            for key, value in source.items():
                if isinstance(value, dict):
                    record = dict(value)
                    record.setdefault("id", key)
                    iterable.append(record)
        else:
            iterable = as_list(source)
        for item in iterable:
            if isinstance(item, dict):
                records.append(item)
    for path_value in [
        contract.get("model_citations_path"),
        contract.get("workbook_citations_path"),
        contract.get("model_citation_ledger"),
        deliverable.get("model_citations_path"),
        deliverable.get("workbook_citations_path"),
        deliverable.get("model_citation_ledger"),
    ]:
        records.extend(load_source_records_from_path(contract, path_value))
    primary_artifact = get_hero(contract).get("primary_artifact") or deliverable.get(
        "primary_artifact"
    )
    artifact_type = text(
        get_hero(contract).get("artifact_type") or deliverable.get("primary_artifact_type")
    )
    artifact_label = f"{primary_artifact} {artifact_type}".lower()
    if primary_artifact and any(term in artifact_label for term in [".xlsx", "workbook", "model"]):
        records.append(
            {
                "id": "model-output",
                "title": "Model output workbook",
                "href": file_href(primary_artifact),
                "date": text(contract.get("generated_at") or contract.get("as_of") or ""),
                "type": "model",
                "quality": "model_output",
                "notes": "Workbook/model output generated with this dashboard.",
            }
        )
    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for record in records:
        sid = text(
            record.get("id") or record.get("source_id") or record.get("name") or record.get("title")
        )
        if not sid or sid in seen:
            continue
        seen.add(sid)
        unique.append(record)
    return unique


def source_lookup(contract: dict[str, Any]) -> dict[str, dict[str, Any]]:
    lookup: dict[str, dict[str, Any]] = {}
    for src in source_records(contract):
        for key in [
            src.get("id"),
            src.get("source_id"),
            src.get("name"),
            src.get("title"),
            src.get("label"),
            workbook_ref(src),
        ] + as_list(src.get("aliases")):
            if key:
                lookup[text(key)] = src
    return lookup


def source_title(src: dict[str, Any], fallback: str = "Source") -> str:
    return text(
        src.get("title") or src.get("name") or src.get("source_name") or src.get("url") or fallback
    )


def source_id(src: dict[str, Any], fallback: str = "") -> str:
    return text(src.get("id") or src.get("source_id") or src.get("source_key") or fallback)


def source_date(src: dict[str, Any]) -> str:
    return text(
        src.get("date") or src.get("as_of") or src.get("source_as_of") or src.get("timestamp") or ""
    )


def source_url(src: dict[str, Any]) -> str:
    if is_workbook_source(src):
        href = workbook_href(src)
        if href:
            return href
    direct = text(src.get("url") or src.get("href") or src.get("link")).strip()
    if direct:
        return direct
    for field in [src.get("notes"), src.get("note"), src.get("citation")]:
        match = re.search(r"https?://[^\s)]+", text(field))
        if match:
            return match.group(0).rstrip(".,;")
    return ""


def safe_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False).replace("</", "<\\/")


def source_tooltip_payload(contract: dict[str, Any]) -> dict[str, dict[str, str]]:
    payload: dict[str, dict[str, str]] = {}
    for src in source_records(contract):
        sid = source_id(src, source_title(src))
        if not sid:
            continue
        payload[sid] = {
            "id": sid,
            "title": source_title(src),
            "type": text(src.get("type") or src.get("category")),
            "quality": text(src.get("quality") or src.get("status")),
            "status": text(src.get("status") or src.get("quality")),
            "date": source_date(src),
            "detail": text(
                src.get("pinpoint") or src.get("page") or src.get("section") or src.get("detail")
            ),
            "notes": text(src.get("notes") or src.get("note") or src.get("excerpt")),
            "url": source_url(src),
            "workbook": file_label(
                src.get("workbook_path") or src.get("workbook") or src.get("path"), "workbook"
            )
            if is_workbook_source(src)
            else "",
            "sheet": text(src.get("sheet") or src.get("worksheet") or src.get("tab")),
            "range": text(src.get("range") or src.get("cell") or src.get("cells")),
            "workbook_ref": workbook_ref(src),
            "value": text(src.get("value") or src.get("display_value")),
            "formula": text(src.get("formula")),
        }
    return payload


def citation_tooltip(src: dict[str, Any]) -> str:
    parts = [source_title(src)]
    if is_workbook_source(src) and workbook_ref(src):
        parts.append(workbook_ref(src))
    if src.get("value") or src.get("display_value"):
        parts.append(f"value {text(src.get('value') or src.get('display_value'))}")
    if src.get("formula"):
        parts.append(f"formula {text(src.get('formula'))}")
    if source_date(src):
        parts.append(source_date(src))
    if src.get("type"):
        parts.append(text(src.get("type")))
    if src.get("quality"):
        parts.append(text(src.get("quality")))
    if src.get("notes") or src.get("note"):
        parts.append(text(src.get("notes") or src.get("note")))
    return " | ".join(part for part in parts if part)


def citation_label(cid: str, src: dict[str, Any] | None = None) -> str:
    if src and is_workbook_source(src):
        ref = workbook_ref(src)
        label = text((src or {}).get("short_label") or (f"Model: {ref}" if ref else "Model"))
    else:
        label = text((src or {}).get("short_label") or (src or {}).get("label") or cid)
    if len(label) > 22:
        label = label[:19].rstrip("-_ ") + "..."
    return f"[{label}]"


def claim_needs_citation(value: Any) -> bool:
    raw = re.sub(r"\s+", " ", text(value)).strip()
    if not raw or len(raw) < 8:
        return False
    lowered = raw.lower()
    if lowered in {
        "positive",
        "negative",
        "neutral",
        "watch",
        "open",
        "closed",
        "partial",
        "fallback",
        "high",
        "medium",
        "low",
    }:
        return False
    if re.search(r"(\$?\d[\d,]*(?:\.\d+)?\s?(?:%|x|mm|bn|m|b|bps)?|\b20\d{2}\b)", raw, flags=re.I):
        return True
    if len(raw) >= 42 and re.search(
        r"\b(is|are|was|were|has|have|had|will|would|should|could|implies|yields|covers|requires|supports|rejected|cited|depends|creates|exceeds|reaches)\b",
        lowered,
    ):
        return True
    return False


def citation_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    if isinstance(value, str):
        if "," in value or ";" in value:
            return [item.strip() for item in re.split(r"[,;]", value) if item.strip()]
        return [value]
    return [value]


def citation_key(citation: Any) -> str:
    if isinstance(citation, Mapping):
        return text(
            citation.get("id")
            or citation.get("source_id")
            or citation.get("url")
            or citation.get("source_url")
            or citation.get("href")
        ).strip()
    return text(citation).strip()


def dedupe_citations(citations: Iterable[Any]) -> list[Any]:
    seen: set[str] = set()
    result: list[Any] = []
    for citation in citations:
        key = citation_key(citation)
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(citation)
    return result


def citation_fields(value: Any) -> list[Any]:
    if not isinstance(value, Mapping):
        return []
    citations: list[Any] = []
    for key in ("citations", "citation_ids", "source_ids"):
        citations.extend(citation_list(value.get(key)))
    for key in ("citation", "source_id"):
        item = value.get(key)
        if item:
            citations.append(item)
    if value.get("source_ref") or value.get("source_url") or value.get("url"):
        source_ref = (
            value.get("source_ref") if isinstance(value.get("source_ref"), Mapping) else value
        )
        citations.append(source_ref)
    return dedupe_citations(citations)


def citation_values(value: Any, inherited: Any = None) -> list[Any]:
    explicit = citation_fields(value)
    if explicit:
        return explicit
    return dedupe_citations(citation_list(inherited))


def missing_citation_badge(required_text: Any = "") -> str:
    summary = short_value(required_text, "This claim or number")
    tooltip = f"Needs source-specific citation: {summary}. Add citation_ids on this claim, metric, bullet, row, or cell."
    return (
        '<span class="citation-cluster" aria-label="Citation needed">'
        f'<a class="citation-chip citation-badge citation-needed" href="#sources" data-citation-needed="true" '
        f'data-tooltip="{h(tooltip)}" title="{h(tooltip)}">Needs source</a>'
        "</span>"
    )


def citation_linkable(citation: Any, lookup: dict[str, dict[str, Any]]) -> Any | None:
    if isinstance(citation, Mapping):
        source_id_value = text(citation.get("id") or citation.get("source_id")).strip()
        if source_id_value and source_id_value in lookup:
            return source_id_value
        if citation.get("url") or citation.get("source_url") or citation.get("href"):
            return citation
        return None
    source_id_value = text(citation).strip()
    if source_id_value and source_id_value in lookup:
        return source_id_value
    if re.match(r"^https?://", source_id_value):
        return {"source_url": source_id_value, "source_title": source_id_value}
    return None


def first_linkable_citation(citations: Any, lookup: dict[str, dict[str, Any]]) -> Any | None:
    for citation in dedupe_citations(citation_list(citations)):
        linkable = citation_linkable(citation, lookup)
        if linkable is not None:
            return linkable
    return None


def external_citation_payload(citation: Mapping[str, Any]) -> tuple[str, str, str, str]:
    url = text(
        citation.get("url")
        or citation.get("source_url")
        or citation.get("href")
        or citation.get("link")
    ).strip()
    title = text(
        citation.get("title")
        or citation.get("source_title")
        or citation.get("name")
        or citation.get("label")
        or url
        or "Source"
    )
    detail = text(
        citation.get("excerpt")
        or citation.get("pinpoint")
        or citation.get("note")
        or citation.get("notes")
        or citation.get("detail")
    )
    date = text(
        citation.get("as_of")
        or citation.get("date")
        or citation.get("published")
        or citation.get("accessed")
    )
    return url, title, detail, date


def citation_link_for_source_id(content: Any, cid: str, lookup: dict[str, dict[str, Any]]) -> str:
    src = lookup.get(cid)
    canonical_id = source_id(src, cid) if src else cid
    href = source_url(src) if src and is_workbook_source(src) else f"#source-{slug(canonical_id)}"
    attrs = f'class="citation-link" href="{h(href)}" data-citation-id="{h(canonical_id)}" aria-label="Source {h(canonical_id)} for {h(content)}"'
    if src and is_workbook_source(src):
        attrs += (
            f' data-workbook-ref="{h(workbook_ref(src))}"'
            f' data-workbook-sheet="{h(src.get("sheet") or src.get("worksheet") or src.get("tab"))}"'
            f' data-workbook-range="{h(src.get("range") or src.get("cell") or src.get("cells"))}"'
        )
    return f"<a {attrs}>{h(content)}</a>"


def citation_link(content: Any, citation: Any, lookup: dict[str, dict[str, Any]]) -> str:
    if isinstance(citation, Mapping):
        source_id_value = text(citation.get("id") or citation.get("source_id")).strip()
        if source_id_value and source_id_value in lookup:
            return citation_link_for_source_id(content, source_id_value, lookup)
        url, title, detail, date = external_citation_payload(citation)
        if url:
            return (
                f'<a class="citation-link" href="{h(url)}" target="_blank" rel="noreferrer" '
                f'data-citation-title="{h(title)}" data-citation-detail="{h(detail)}" '
                f'data-citation-date="{h(date)}" aria-label="Source for {h(content)}">{h(content)}</a>'
            )
    source_id_value = text(citation).strip()
    if source_id_value and source_id_value in lookup:
        return citation_link_for_source_id(content, source_id_value, lookup)
    if re.match(r"^https?://", source_id_value):
        return (
            f'<a class="citation-link" href="{h(source_id_value)}" target="_blank" rel="noreferrer" '
            f'data-citation-title="{h(source_id_value)}" aria-label="Source for {h(content)}">{h(content)}</a>'
        )
    return h(content)


def should_link_entire_value(value: Any) -> bool:
    compact = re.sub(r"\s+", " ", text(value).strip())
    if not compact or not _NUMERIC_CITATION_RE.search(compact):
        return False
    if len(compact) <= 28:
        words = re.findall(r"[A-Za-z]+", compact)
        return len(words) <= 4
    if len(compact) <= 64 and _MONTH_RE.search(compact):
        return True
    return False


def link_numeric_text(value: Any, citations: Any, lookup: dict[str, dict[str, Any]]) -> str:
    raw = text(value)
    citation = first_linkable_citation(citations, lookup)
    if citation is None:
        return ""
    if should_link_entire_value(raw):
        return citation_link(raw, citation, lookup)
    parts: list[str] = []
    last = 0
    matched = False
    for match in _NUMERIC_CITATION_RE.finditer(raw):
        matched = True
        parts.append(h(raw[last : match.start()]))
        parts.append(citation_link(match.group(0), citation, lookup))
        last = match.end()
    if not matched:
        return ""
    parts.append(h(raw[last:]))
    return "".join(parts)


def citation_ref(citation: Any, lookup: dict[str, dict[str, Any]]) -> str:
    if isinstance(citation, Mapping):
        source_id_value = text(citation.get("id") or citation.get("source_id")).strip()
        if source_id_value and source_id_value in lookup:
            return citation_ref(source_id_value, lookup)
        url, title, detail, date = external_citation_payload(citation)
        if url:
            return (
                f'<a class="citation-chip citation-badge citation-external" href="{h(url)}" target="_blank" rel="noreferrer" '
                f'data-citation-external="true" data-citation-title="{h(title)}" data-citation-detail="{h(detail)}" '
                f'data-citation-date="{h(date)}" aria-label="Citation source">[source]</a>'
            )
        if source_id_value:
            return citation_ref(source_id_value, lookup)
        return ""
    cid = text(citation).strip()
    if not cid:
        return ""
    if re.match(r"^https?://", cid):
        return citation_ref({"source_url": cid, "source_title": cid}, lookup)
    src = lookup.get(cid)
    label = citation_label(cid, src)
    if not src:
        tooltip = f"Missing source record for {cid}. Add it to sources/citations or correct the citation id."
        return f'<a class="citation-chip citation-badge citation-missing" href="#sources" data-citation-missing="true" data-tooltip="{h(tooltip)}" title="{h(tooltip)}">{h(label)}</a>'
    canonical_id = source_id(src, cid)
    tooltip = citation_tooltip(src)
    attrs = f'class="citation-chip citation-badge" data-citation-id="{h(canonical_id)}" data-tooltip="{h(tooltip)}" title="{h(tooltip)}"'
    href = source_url(src) if is_workbook_source(src) else f"#source-{slug(canonical_id)}"
    if is_workbook_source(src):
        attrs += (
            f' data-workbook-ref="{h(workbook_ref(src))}"'
            f' data-workbook-sheet="{h(src.get("sheet") or src.get("worksheet") or src.get("tab"))}"'
            f' data-workbook-range="{h(src.get("range") or src.get("cell") or src.get("cells"))}"'
        )
    return f'<a {attrs} href="{h(href)}">{h(label)}</a>'


def citation_badges(ids: Any, lookup: dict[str, dict[str, Any]], required_text: Any = None) -> str:
    items = dedupe_citations(citation_list(ids))
    if not items and required_text is not None:
        items = infer_citation_ids(required_text, lookup)
    if not items and required_text is not None and claim_needs_citation(required_text):
        return missing_citation_badge(required_text)
    if not items:
        return ""
    badges = [citation_ref(item, lookup) for item in items]
    badges = [badge for badge in badges if badge]
    return '<span class="citation-cluster" aria-label="Sources">' + "".join(badges) + "</span>"


def render_inline_text(
    value: Any,
    lookup: dict[str, dict[str, Any]],
    citations: Any = None,
    required_text: Any = None,
    *,
    append_non_numeric_citations: bool = True,
    link_numeric_citations: bool = True,
    require_citations: bool = True,
) -> str:
    raw = text(value)
    if not raw:
        return ""
    marker_ids = _CITATION_MARKER_RE.findall(raw)
    clean = _CITATION_MARKER_RE.sub("", raw).strip()
    all_citations = dedupe_citations(citation_list(citations) + marker_ids)
    if not all_citations and required_text is not None and require_citations:
        all_citations = infer_citation_ids(required_text, lookup)
    if link_numeric_citations and all_citations:
        linked = link_numeric_text(clean, all_citations, lookup)
        if linked:
            return linked
    rendered = h(clean)
    if append_non_numeric_citations:
        badge_required = (
            (required_text if required_text is not None else clean) if require_citations else None
        )
        rendered += citation_badges(all_citations, lookup, badge_required)
    elif (
        require_citations
        and not all_citations
        and claim_needs_citation(required_text if required_text is not None else clean)
    ):
        rendered += missing_citation_badge(required_text if required_text is not None else clean)
    return rendered


def section_citation_note(
    citations: Any, lookup: dict[str, dict[str, Any]], label: str = "Section sources"
) -> str:
    refs = citation_badges(citations, lookup)
    if not refs:
        return ""
    return f'<p class="section-citation-note"><span>{h(label)}:</span>{refs}</p>'


def comparable_number_tokens(value: Any) -> set[str]:
    raw = text(value).lower().replace(",", "")
    tokens = set()
    for match in re.findall(r"\$?\d+(?:\.\d+)?\s?(?:%|x|mm|bn|m|b|bps)?", raw):
        token = match.replace("$", "").replace(" ", "")
        if token:
            tokens.add(token)
    return tokens


def infer_model_citation_ids(
    value: Any, lookup: dict[str, dict[str, Any]], limit: int = 3
) -> list[str]:
    raw = text(value).strip()
    if not raw:
        return []
    lowered = raw.lower()
    raw_words = {
        word
        for word in re.findall(r"[a-z0-9]{3,}", lowered)
        if word
        not in {
            "the",
            "and",
            "for",
            "with",
            "case",
            "base",
            "model",
            "output",
            "value",
            "from",
            "into",
            "that",
        }
    }
    raw_numbers = comparable_number_tokens(raw)
    scored: list[tuple[int, str]] = []
    seen: set[str] = set()
    for src in lookup.values():
        sid = source_id(src, source_title(src))
        if not sid or sid in seen or not is_workbook_source(src):
            continue
        seen.add(sid)
        haystack = " ".join(
            [
                sid,
                source_title(src),
                text(src.get("label")),
                text(src.get("line_item")),
                text(src.get("metric")),
                text(src.get("scenario")),
                text(src.get("section")),
                workbook_ref(src),
                " ".join(text(alias) for alias in as_list(src.get("aliases"))),
            ]
        ).lower()
        source_words = set(re.findall(r"[a-z0-9]{3,}", haystack.replace("_", " ")))
        source_numbers = comparable_number_tokens(src.get("value") or src.get("display_value"))
        score = len(raw_words & source_words) * 2 + len(raw_numbers & source_numbers) * 4
        if text(src.get("scenario")).lower() == "base" and "base" in lowered:
            score += 2
        if text(src.get("line_item")).lower() in lowered:
            score += 3
        if score >= 4:
            scored.append((score, sid))
    return [sid for _, sid in sorted(scored, reverse=True)[:limit]]


def infer_citation_ids(value: Any, lookup: dict[str, dict[str, Any]], limit: int = 3) -> list[str]:
    raw = text(value).strip()
    if not raw:
        return []
    if raw in lookup:
        src = lookup[raw]
        return [text(src.get("id") or src.get("source_id") or raw)]
    lowered = raw.lower()
    model_terms = {
        "model",
        "irr",
        "moic",
        "ebitda",
        "leverage",
        "debt",
        "cash",
        "shares",
        "ownership",
        "scenario",
        "sensitivity",
        "case",
        "returns",
        "synergy",
        "synergies",
    }
    model_matches = infer_model_citation_ids(raw, lookup, limit=limit)
    if model_matches:
        return model_matches
    if "model-output" in lookup and any(term in lowered for term in model_terms):
        return ["model-output"]
    tokens = [
        token.strip().lower()
        for token in re.split(r"[/,;&]|\band\b", raw)
        if token.strip()
        and token.strip().lower()
        not in {"public reports", "public report", "model proxy", "source", "sources"}
    ]
    ids: list[str] = []
    seen: set[str] = set()
    for src in lookup.values():
        sid = text(src.get("id") or src.get("source_id") or source_title(src))
        if not sid or sid in seen:
            continue
        haystack = " ".join(
            [sid, source_title(src), text(src.get("type")), text(src.get("quality"))]
        ).lower()
        if any(token and token in haystack for token in tokens):
            seen.add(sid)
            ids.append(sid)
        if len(ids) >= limit:
            break
    if ids:
        return ids
    raw_words = {
        word
        for word in re.findall(r"[a-z0-9]{4,}", lowered.replace("rejection", "rejected"))
        if word
        not in {
            "this",
            "that",
            "with",
            "from",
            "into",
            "only",
            "case",
            "read",
            "latest",
            "source",
            "model",
        }
    }
    scored: list[tuple[int, str]] = []
    for src in lookup.values():
        sid = text(src.get("id") or src.get("source_id") or source_title(src))
        if not sid:
            continue
        haystack = " ".join(
            [
                sid,
                source_title(src),
                text(src.get("type")),
                text(src.get("quality")),
                text(src.get("notes") or src.get("note")),
            ]
        ).lower()
        source_words = set(re.findall(r"[a-z0-9]{4,}", haystack.replace("rejects", "rejected")))
        score = len(raw_words & source_words)
        if score >= 2:
            scored.append((score, sid))
    for _, sid in sorted(scored, reverse=True):
        if sid not in seen:
            ids.append(sid)
            seen.add(sid)
        if len(ids) >= limit:
            break
    return ids


def citation_policy(contract: dict[str, Any]) -> str:
    metadata = contract.get("metadata") if isinstance(contract.get("metadata"), Mapping) else {}
    deliverable = get_deliverable(contract)
    raw = (
        text(
            metadata.get("citation_policy")
            or contract.get("citation_policy")
            or deliverable.get("citation_policy")
            or "block_for_senior"
        )
        .strip()
        .lower()
    )
    if raw == "block-for-senior":
        return "block_for_senior"
    return raw if raw in SUPPORTED_CITATION_POLICIES else "block_for_senior"


def readiness_posture(contract: dict[str, Any]) -> str:
    metadata = contract.get("metadata") if isinstance(contract.get("metadata"), Mapping) else {}
    deliverable = get_deliverable(contract)
    hero = get_hero(contract)
    return text(
        metadata.get("effective_readiness_posture")
        or metadata.get("readiness_posture")
        or metadata.get("posture")
        or contract.get("readiness_posture")
        or contract.get("posture")
        or deliverable.get("readiness_posture")
        or deliverable.get("posture")
        or hero.get("readiness_posture")
        or hero.get("posture")
        or ""
    ).strip()


def posture_has_any(posture: str, terms: set[str]) -> bool:
    clean = posture.lower().replace("_", "-")
    return any(term.replace("_", "-") in clean for term in terms)


def is_hard_fail_posture(posture: str) -> bool:
    return posture_has_any(posture, HARD_FAIL_POSTURE_TERMS)


def is_draft_tolerant_posture(posture: str) -> bool:
    return posture_has_any(posture, DRAFT_TOLERANT_POSTURE_TERMS)


def citation_gap_acceptance(
    contract: dict[str, Any], cli_accept: bool = False, cli_reason: str = ""
) -> tuple[bool, str]:
    metadata = contract.get("metadata") if isinstance(contract.get("metadata"), Mapping) else {}
    deliverable = get_deliverable(contract)
    accepted = bool(
        cli_accept
        or metadata.get("accept_draft_citation_gaps")
        or contract.get("accept_draft_citation_gaps")
        or deliverable.get("accept_draft_citation_gaps")
    )
    reason = text(
        cli_reason
        or metadata.get("citation_gap_acceptance_reason")
        or contract.get("citation_gap_acceptance_reason")
        or deliverable.get("citation_gap_acceptance_reason")
    ).strip()
    return accepted, reason


def apply_draft_citation_gap_downgrade(
    contract: dict[str, Any], reason: str, citation_errors: list[str]
) -> None:
    metadata = dict(
        contract.get("metadata") if isinstance(contract.get("metadata"), Mapping) else {}
    )
    metadata.update(
        {
            "citation_gap_accepted": True,
            "accept_draft_citation_gaps": True,
            "citation_gap_acceptance_reason": reason,
            "original_readiness_posture": readiness_posture(contract),
            "effective_readiness_posture": "draft-with-citation-gaps",
            "citation_gap_error_count": len(citation_errors),
        }
    )
    contract["metadata"] = metadata


def has_inline_citation(value: Any) -> bool:
    return bool(_CITATION_MARKER_RE.search(text(value)))


def has_citation_support(value: Mapping[str, Any]) -> bool:
    if citation_values(value):
        return True
    return any(isinstance(child, str) and has_inline_citation(child) for child in value.values())


def citation_gap_snippet(value: Any) -> str:
    snippet = re.sub(r"\s+", " ", text(value).strip())
    return snippet[:117] + "..." if len(snippet) > 120 else snippet


def unresolved_citation_ref(citation: Any, source_keys: set[str]) -> str | None:
    if isinstance(citation, Mapping):
        cid = text(citation.get("id") or citation.get("source_id")).strip()
        if cid and cid in source_keys:
            return None
        if citation.get("url") or citation.get("source_url") or citation.get("href"):
            return None
        return cid or None
    cid = text(citation).strip()
    if not cid or cid in source_keys or re.match(r"^https?://", cid):
        return None
    return cid


def find_unresolved_citations(value: Any, source_keys: set[str], path: str = "$") -> list[str]:
    hits: list[str] = []
    if isinstance(value, str):
        for source_id_value in _CITATION_MARKER_RE.findall(value):
            if source_id_value not in source_keys:
                hits.append(f"{path} cites unknown source id {source_id_value!r}.")
    elif isinstance(value, Mapping):
        for key in ("citation", "source_id"):
            missing = (
                unresolved_citation_ref(value.get(key), source_keys) if value.get(key) else None
            )
            if missing:
                hits.append(f"{path}.{key} references unknown source id {missing!r}.")
        for key in ("citations", "citation_ids", "source_ids"):
            for citation in citation_list(value.get(key)):
                missing = unresolved_citation_ref(citation, source_keys)
                if missing:
                    hits.append(f"{path}.{key} references unknown source id {missing!r}.")
        for key, child in value.items():
            if path == "$" and key in _SOURCE_LEDGER_KEYS:
                continue
            hits.extend(find_unresolved_citations(child, source_keys, f"{path}.{key}"))
    elif isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        for index, child in enumerate(value):
            hits.extend(find_unresolved_citations(child, source_keys, f"{path}[{index}]"))
    return hits


def find_numeric_citation_gaps(
    value: Any,
    lookup: dict[str, dict[str, Any]],
    path: str = "$",
    inherited_support: bool = False,
    key: str = "",
) -> list[str]:
    hits: list[str] = []
    if isinstance(value, Mapping):
        support = inherited_support or has_citation_support(value)
        for child_key, child in value.items():
            if path == "$" and child_key in _SOURCE_LEDGER_KEYS:
                continue
            if child_key in _SKIP_CITATION_KEYS:
                continue
            hits.extend(
                find_numeric_citation_gaps(child, lookup, f"{path}.{child_key}", support, child_key)
            )
    elif isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        for index, child in enumerate(value):
            hits.extend(
                find_numeric_citation_gaps(
                    child, lookup, f"{path}[{index}]", inherited_support, key
                )
            )
    elif isinstance(value, str):
        if (
            key in _MATERIAL_CITATION_KEYS
            and _NUMERIC_CITATION_RE.search(value)
            and not (inherited_support or has_inline_citation(value))
            and not infer_citation_ids(value, lookup)
        ):
            hits.append(
                f"{path} has material numeric text without inline citation support: {citation_gap_snippet(value)!r}"
            )
    return hits


def validate_contract(
    contract: dict[str, Any],
    accept_draft_citation_gaps: bool = False,
    citation_gap_acceptance_reason: str = "",
) -> dict[str, Any]:
    warnings: list[str] = []
    citation_warnings: list[str] = []
    citation_errors: list[str] = []
    blocking_errors: list[str] = []
    deliverable = get_deliverable(contract)
    render_mode = get_render_mode(contract)
    for field in ["dashboard_title", "entity", "skill"]:
        if not contract.get(field):
            warnings.append(f"Missing recommended field: {field}")
    if render_mode not in {"dashboard", "report_only", "hybrid"}:
        warnings.append(f"Unsupported render_mode: {render_mode}")
    sections = contract.get("sections")
    report_body = contract.get("report_body") or deliverable.get("report_body")
    if render_mode == "report_only" and not report_body:
        warnings.append("report_only mode should include report_body sections.")
    if render_mode in {"dashboard", "hybrid"} and (not isinstance(sections, list) or not sections):
        warnings.append("dashboard and hybrid modes should include at least one dashboard section.")
    if isinstance(sections, list):
        seen_ids = set()
        for idx, section in enumerate(sections):
            sid = text(section.get("id") or slug(section.get("label") or f"section-{idx + 1}"))
            if sid in seen_ids:
                warnings.append(f"Duplicate section id: {sid}")
            seen_ids.add(sid)
            modules = section.get("modules", [])
            if not isinstance(modules, list):
                warnings.append(f"Section {sid} modules should be an array.")
                continue
            for module in modules:
                mtype = module.get("type") if isinstance(module, dict) else None
                if mtype not in SUPPORTED_MODULES:
                    warnings.append(f"Unsupported module type in section {sid}: {mtype}")
    sources = source_records(contract)
    if not sources:
        warnings.append(
            "No sources provided. Add a source register or mark data as illustrative/missing."
        )
    lookup = source_lookup(contract)
    source_keys = set(lookup.keys())
    policy = citation_policy(contract)
    posture = readiness_posture(contract)
    hard_fail_posture = is_hard_fail_posture(posture)
    hard_fail_citations = policy == "strict" or (policy == "block_for_senior" and hard_fail_posture)
    unresolved = find_unresolved_citations(contract, source_keys)
    if unresolved:
        target = citation_errors if hard_fail_citations else citation_warnings
        label = "citation policy violation" if hard_fail_citations else "citation warning"
        target.extend(f"{label}: {item}" for item in unresolved[:30])
        if len(unresolved) > 30:
            target.append(f"{len(unresolved) - 30} additional unresolved citation hits.")
    numeric_gaps = find_numeric_citation_gaps(contract, lookup)
    if numeric_gaps:
        target = citation_errors if hard_fail_citations else citation_warnings
        label = "citation policy violation" if hard_fail_citations else "citation warning"
        target.extend(f"{label}: {item}" for item in numeric_gaps[:40])
        if len(numeric_gaps) > 40:
            target.append(f"{len(numeric_gaps) - 40} additional numeric citation gaps.")
    if not sources and hard_fail_citations:
        citation_errors.append(
            "citation policy violation: no source register supplied for senior/client/committee/board/external readiness posture."
        )

    accepted, reason = citation_gap_acceptance(
        contract, accept_draft_citation_gaps, citation_gap_acceptance_reason
    )
    draft_override_available = bool(
        citation_errors and policy == "block_for_senior" and hard_fail_posture
    )
    accepted_draft_gaps = False
    if citation_errors:
        if draft_override_available and accepted and reason:
            accepted_draft_gaps = True
            apply_draft_citation_gap_downgrade(contract, reason, citation_errors)
            citation_warnings.extend(
                [
                    "citation draft acceptance: senior-ready citation gaps were explicitly accepted as draft-only.",
                    *citation_errors,
                ]
            )
            citation_errors = []
        elif draft_override_available and accepted and not reason:
            blocking_errors.append(
                "citation_gap_acceptance_reason is required when accepting senior-ready citation gaps as draft-only."
            )
            blocking_errors.extend(citation_errors)
        else:
            blocking_errors.extend(citation_errors)

    combined_warnings = [*warnings, *citation_warnings]
    audit = {
        "warnings": combined_warnings,
        "layout_warnings": warnings,
        "citation_warnings": citation_warnings,
        "citation_errors": citation_errors,
        "blocking_errors": blocking_errors,
        "readiness_posture": posture,
        "effective_readiness_posture": readiness_posture(contract),
        "citation_policy": policy,
        "hard_fail_posture": hard_fail_posture,
        "draft_tolerant_posture": is_draft_tolerant_posture(posture),
        "accepted_draft_citation_gaps": accepted_draft_gaps,
        "citation_gap_acceptance_reason": reason if accepted_draft_gaps else "",
        "draft_override_available": draft_override_available,
        "how_to_fix": "Resolve unknown citation IDs, add inline citation_ids/source_ids or workbook-cell model citations for material numeric claims, or downgrade the contract posture to draft/screen-grade with an explicit citation-gap acceptance reason.",
    }
    return audit


def render_cell(
    value: Any,
    lookup: dict[str, dict[str, Any]],
    inherited_citations: Any = None,
    require_citations: bool = True,
) -> str:
    if isinstance(value, dict):
        display = value.get("text", value.get("value", ""))
        citations = citation_values(value, inherited_citations)
        status = value.get("status")
        out = (
            text(value.get("html"))
            + citation_badges(citations, lookup, display if require_citations else None)
            if value.get("html") is not None
            else render_inline_text(
                display, lookup, citations, display, require_citations=require_citations
            )
        )
        if status:
            out += " " + chip(status, status, "cell-status")
        return out
    if isinstance(value, list):
        return (
            "<ul>"
            + "".join(
                f"<li>{render_cell(item, lookup, inherited_citations, require_citations)}</li>"
                for item in value
            )
            + "</ul>"
        )
    return render_inline_text(
        value, lookup, inherited_citations, value, require_citations=require_citations
    )


def table_column_class(column: Any, key: str, label: str) -> str:
    if isinstance(column, dict):
        explicit = text(column.get("align") or column.get("type")).strip().lower()
        if explicit in {"number", "numeric", "currency", "percent", "percentage", "right"}:
            return "is-numeric"
        if explicit in {"left", "text", "string"}:
            return ""
    numeric_hint = re.compile(
        r"(?:%|\b(?:amount|arr|bps|capex|cash|debt|ebitda|eps|growth|income|irr|"
        r"leverage|margin|moic|multiple|opex|price|profit|rate|return|revenue|"
        r"sales|shares?|value|valuation|variance)\b)",
        re.IGNORECASE,
    )
    return "is-numeric" if numeric_hint.search(f"{key} {label}") else ""


def render_table_payload(
    columns: Iterable[Any],
    rows: Iterable[Any],
    lookup: dict[str, dict[str, Any]],
    sticky_first: bool = False,
    mobile_stack: bool = False,
    require_citations: bool = True,
    table_id: Any = "",
    table_label: Any = "",
    download_filename: Any = "",
    exportable: bool = True,
) -> str:
    column_list = list(columns)
    cols = [text(c.get("label") if isinstance(c, dict) else c) for c in column_list]
    keys = [
        text(c.get("key") or c.get("field") or c.get("label") if isinstance(c, dict) else c)
        for c in column_list
    ]
    row_list = list(rows)
    if not cols and row_list:
        max_cols = (
            max(len(r) for r in row_list if isinstance(r, list))
            if any(isinstance(r, list) for r in row_list)
            else 0
        )
        cols = [f"Column {idx + 1}" for idx in range(max_cols)]
        keys = cols
        column_list = cols
    if not row_list:
        return no_data("No table rows supplied.")
    classes = []
    if sticky_first:
        classes.append("sticky-first")
    if mobile_stack:
        classes.append("mobile-stack")
    table_name = public_text(table_label, "Table")
    identity_seed = json.dumps(
        {"columns": cols, "rows": row_list, "label": table_name}, default=text, sort_keys=True
    )
    stable_suffix = hashlib.sha1(identity_seed.encode("utf-8")).hexdigest()[:8]
    stable_id = f"{slug(table_id or table_name)}-{stable_suffix}"
    filename = text(download_filename).strip() or f"{stable_id}.csv"
    if not filename.lower().endswith(".csv"):
        filename += ".csv"
    controls = ""
    if exportable:
        controls = (
            '<div class="table-action-bar" aria-label="Table export controls">'
            f'<span class="table-action-label">{h(table_name)}</span>'
            '<div class="table-actions">'
            f'<button class="table-action" type="button" data-copy-table-tsv data-table-target="{h(stable_id)}" aria-label="Copy {h(table_name)} as TSV">Copy TSV</button>'
            f'<button class="table-action" type="button" data-download-table-csv data-table-target="{h(stable_id)}" aria-label="Download {h(table_name)} as CSV">Download CSV</button>'
            "</div></div>"
        )
    column_classes = [
        table_column_class(column_list[idx], keys[idx], col) for idx, col in enumerate(cols)
    ]
    thead = (
        "<thead><tr>"
        + "".join(
            f'<th class="{column_classes[idx]}">{h(col)}</th>'
            if column_classes[idx]
            else f"<th>{h(col)}</th>"
            for idx, col in enumerate(cols)
        )
        + "</tr></thead>"
    )
    body_rows = []
    for row in row_list:
        row_citations = citation_values(row) if isinstance(row, dict) else None
        row_id = text(row.get("_row_id")) if isinstance(row, dict) and row.get("_row_id") else ""
        cells = []
        for idx, col in enumerate(cols):
            if isinstance(row, dict):
                key = keys[idx] if idx < len(keys) else col
                value = row.get(key, row.get(slug(key), row.get(col, row.get(slug(col), ""))))
            else:
                value = row[idx] if idx < len(row) else ""
            class_attr = f' class="{column_classes[idx]}"' if column_classes[idx] else ""
            cells.append(
                f'<td{class_attr} data-label="{h(col)}">{render_cell(value, lookup, row_citations, require_citations)}</td>'
            )
        id_attr = f' id="{h(row_id)}"' if row_id else ""
        body_rows.append(f"<tr{id_attr}>" + "".join(cells) + "</tr>")
    table_attrs = (
        f'id="{h(stable_id)}" data-table-id="{h(stable_id)}" data-download-filename="{h(filename)}"'
    )
    if exportable:
        table_attrs += ' data-table-export="true"'
    return (
        f'<div class="table-export-shell" data-table-export-wrapper data-table-id="{h(stable_id)}">'
        + controls
        + f'<div class="table-wrap"><table {table_attrs} class="{" ".join(classes)}">{thead}<tbody>{"".join(body_rows)}</tbody></table></div>'
        + "</div>"
    )


def render_table(
    module: dict[str, Any], lookup: dict[str, dict[str, Any]], wide: bool = False
) -> str:
    columns = as_list(module.get("columns"))
    labels = [text(c.get("label") if isinstance(c, dict) else c) for c in columns]
    rows = normalize_rows(module.get("rows"), labels)
    return render_table_payload(
        columns,
        rows,
        lookup,
        sticky_first=bool(module.get("sticky_first_column") or wide),
        mobile_stack=bool(module.get("mobile_labels", True)),
        table_id=module.get("table_id") or module.get("id"),
        table_label=module.get("download_label") or module.get("title"),
        download_filename=module.get("download_filename"),
        exportable=module.get("exportable", True) is not False,
    )


def render_metric_strip(module: dict[str, Any], lookup: dict[str, dict[str, Any]]) -> str:
    metrics = as_list(module.get("metrics"))
    if not metrics:
        return no_data("No metrics supplied for this KPI strip.")
    cards = []
    for metric in metrics:
        if not isinstance(metric, dict):
            metric = {"label": "Metric", "value": metric}
        cards.append(
            '<article class="metric-tile metric-card">'
            f'<span class="tile-label">{h(metric.get("label", "Metric"))}</span>'
            f"<strong>{render_cell(metric.get('value', '-'), lookup, citation_values(metric))}</strong>"
            f"<small>{render_inline_text(metric.get('note', ''), lookup, metric.get('note_citation_ids') or citation_values(metric), metric.get('note'))}</small>"
            + (
                chip(metric.get("tone", "neutral"), metric.get("tone", "neutral"))
                if metric.get("tone")
                else ""
            )
            + "</article>"
        )
    return '<div class="metric-grid">' + "".join(cards) + "</div>"


def render_verdict(module: dict[str, Any], lookup: dict[str, dict[str, Any]]) -> str:
    parts = []
    if module.get("posture") or module.get("score"):
        chips = []
        if module.get("posture"):
            label, posture_tone = friendly_status(module.get("posture"), module.get("tone", "info"))
            chips.append(chip(label, module.get("tone", posture_tone)))
        if module.get("score"):
            chips.append(
                chip(module.get("score"), module.get("score_tone", module.get("tone", "neutral")))
            )
        parts.append('<div class="chip-row">' + "".join(chips) + "</div>")
    if module.get("body"):
        parts.append(
            f'<div class="verdict-body">{render_inline_text(module.get("body"), lookup, module.get("citation_ids"), module.get("body"))}</div>'
        )
    bullets = as_list(module.get("bullets"))
    if bullets:
        items = []
        for bullet in bullets:
            if isinstance(bullet, dict):
                items.append(
                    f"<li>{chip(bullet.get('tone', 'neutral'), bullet.get('tone', 'neutral'))} {render_inline_text(bullet.get('text', ''), lookup, bullet.get('citation_ids'), bullet.get('text'))}</li>"
                )
            else:
                items.append(f"<li>{render_inline_text(bullet, lookup, None, bullet)}</li>")
        parts.append('<ul class="check-list">' + "".join(items) + "</ul>")
    return "".join(parts) or no_data("No verdict supplied.")


def render_md_question(module: dict[str, Any], lookup: dict[str, dict[str, Any]]) -> str:
    rows = []
    for label, key in [
        ("Question", "question"),
        ("Answer", "answer"),
        ("Why it matters", "why_it_matters"),
        ("Next decision", "next_decision"),
    ]:
        if module.get(key):
            rows.append(
                f'<div class="bullet-item"><div class="metric-label">{label}</div><div>{render_inline_text(module.get(key), lookup, module.get(f"{key}_citation_ids"), module.get(key))}</div></div>'
            )
    return (
        '<div class="bullet-list">' + "".join(rows) + "</div>"
        if rows
        else no_data("No MD question supplied.")
    )


def render_flags(module: dict[str, Any], lookup: dict[str, dict[str, Any]]) -> str:
    flags = as_list(module.get("flags"))
    if not flags:
        return no_data("No flags supplied.")
    items = []
    for flag in flags:
        if not isinstance(flag, dict):
            flag = {"title": flag}
        sev = flag.get("severity", flag.get("tone", "watch"))
        meta = []
        if flag.get("owner"):
            meta.append(f"Owner: {h(flag.get('owner'))}")
        if flag.get("ask"):
            meta.append(f"Ask: {h(flag.get('ask'))}")
        items.append(
            '<li class="flag-item">'
            f'<div>{chip(sev, sev)} <span class="flag-title">{render_inline_text(flag.get("title", "Flag"), lookup, flag.get("citation_ids"), flag.get("detail") or flag.get("title"))}</span></div>'
            f'<div class="flag-detail">{render_inline_text(flag.get("detail", ""), lookup, flag.get("detail_citation_ids") or flag.get("citation_ids"), flag.get("detail"))}</div>'
            + (f'<div class="flag-detail">{" | ".join(meta)}</div>' if meta else "")
            + "</li>"
        )
    return '<ul class="flag-list">' + "".join(items) + "</ul>"


def render_actions(module: dict[str, Any], lookup: dict[str, dict[str, Any]]) -> str:
    actions = as_list(module.get("actions"))
    if not actions:
        return no_data("No actions supplied.")
    columns = module.get("columns") or ["Action", "Owner", "Deadline", "Status", "Priority"]
    rows = []
    for action in actions:
        if isinstance(action, dict):
            row = {
                "Action": action.get("action", action.get("title", "")),
                "Owner": action.get("owner", ""),
                "Deadline": action.get("deadline", ""),
                "Status": action.get("status", ""),
                "Priority": action.get("priority", ""),
            }
            row_citations = citation_values(action)
            if row_citations:
                row["citation_ids"] = row_citations
            rows.append(row)
        else:
            rows.append([action, "", "", "", ""])
    return render_table_payload(
        columns,
        rows,
        lookup,
        sticky_first=True,
        mobile_stack=True,
        table_id=module.get("table_id") or module.get("id") or "action-register",
        table_label=module.get("download_label") or module.get("title") or "Action Register",
        download_filename=module.get("download_filename"),
        exportable=module.get("exportable", True) is not False,
    )


def render_evidence(module: dict[str, Any], lookup: dict[str, dict[str, Any]]) -> str:
    items = as_list(module.get("items"))
    if not items:
        return no_data("No evidence posture items supplied.")
    out = []
    for item in items:
        if not isinstance(item, dict):
            item = {"label": item}
        status = item.get("status", item.get("quality", "neutral"))
        out.append(
            '<li class="source-item">'
            f'<div>{chip(status, status)} <span class="source-title">{render_inline_text(item.get("label", item.get("name", "Evidence")), lookup, item.get("citation_ids", item.get("source_ids")), item.get("detail", item.get("notes", item.get("label"))))}</span></div>'
            f'<div class="source-detail">{render_inline_text(item.get("detail", item.get("notes", "")), lookup, item.get("detail_citation_ids") or item.get("citation_ids", item.get("source_ids")), item.get("detail", item.get("notes", "")))}</div>'
            "</li>"
        )
    return '<ul class="source-list-card">' + "".join(out) + "</ul>"


def render_source_readiness(module: dict[str, Any], lookup: dict[str, dict[str, Any]]) -> str:
    items = as_list(module.get("items"))
    columns = module.get("columns") or ["Item", "Status", "Source", "Gap", "Next step"]
    rows = []
    for item in items:
        if isinstance(item, dict):
            source_value = item.get("source", "")
            rows.append(
                [
                    item.get("item", item.get("label", "")),
                    item.get("status", ""),
                    {
                        "text": source_value,
                        "citation_ids": item.get(
                            "citation_ids",
                            item.get("source_ids", infer_citation_ids(source_value, lookup)),
                        ),
                    },
                    item.get("gap", ""),
                    item.get("next_step", ""),
                ]
            )
        else:
            rows.append([item, "", "", "", ""])
    return render_table_payload(
        columns,
        rows,
        lookup,
        sticky_first=True,
        mobile_stack=True,
        table_id=module.get("table_id") or module.get("id") or "source-readiness",
        table_label=module.get("download_label") or module.get("title") or "Source Readiness",
        download_filename=module.get("download_filename"),
        exportable=module.get("exportable", True) is not False,
    )


def render_timeline(module: dict[str, Any], lookup: dict[str, dict[str, Any]]) -> str:
    events = as_list(module.get("events"))
    if not events:
        return no_data("No timeline events supplied.")
    items = []
    for event in events:
        if not isinstance(event, dict):
            event = {"event": event}
        items.append(
            '<li class="timeline-item">'
            f"<div>{chip(event.get('status', 'info'), event.get('status', 'info'))} <strong>{render_inline_text(event.get('date', event.get('timing', '')), lookup, event.get('citation_ids'), event.get('detail') or event.get('event') or event.get('date'))}</strong></div>"
            f'<div class="flag-title">{render_inline_text(event.get("event", event.get("title", "Milestone")), lookup, event.get("event_citation_ids") or event.get("citation_ids"), event.get("event", event.get("title", "")))}</div>'
            f'<div class="flag-detail">{render_inline_text(event.get("detail", ""), lookup, event.get("detail_citation_ids") or event.get("citation_ids"), event.get("detail", ""))}</div>'
            "</li>"
        )
    return '<ul class="timeline-list">' + "".join(items) + "</ul>"


def render_bar_like(
    items: list[Any],
    label_key: str,
    value_key: str,
    class_name: str,
    lookup: dict[str, dict[str, Any]],
) -> str:
    prepared = []
    for item in items:
        if not isinstance(item, dict):
            item = {"label": item, "value": 0}
        val = numeric(item.get(value_key, item.get("value")))
        prepared.append((item, val if val is not None else 0.0))
    max_value = max([abs(v) for _, v in prepared] or [1.0]) or 1.0
    rows = []
    for item, val in prepared:
        width = min(100, max(2, abs(val) / max_value * 100))
        tone_name = tone(item.get("tone", "info"))
        rows.append(
            f'<div class="{class_name}-row">'
            f"<div>{render_inline_text(item.get(label_key, item.get('label', '')), lookup, item.get('citation_ids'), item.get(label_key, item.get('label', '')))}</div>"
            f'<div class="{class_name}-track"><div class="{class_name}-fill tone-{tone_name}" style="width:{width:.1f}%;"></div></div>'
            f"<div><strong>{render_inline_text(item.get(value_key, item.get('value', '')), lookup, item.get('value_citation_ids') or item.get('citation_ids'), item.get(value_key, item.get('value', '')))}</strong></div>"
            "</div>"
        )
    return '<div class="chart-box" data-responsive-chart>' + "".join(rows) + "</div>"


def render_bar_chart(module: dict[str, Any], lookup: dict[str, dict[str, Any]]) -> str:
    data = as_list(module.get("data"))
    if not data:
        return no_data("No bar chart data supplied.")
    return render_bar_like(data, "label", "value", "bar", lookup)


def render_funnel(module: dict[str, Any], lookup: dict[str, dict[str, Any]]) -> str:
    stages = as_list(module.get("stages"))
    if not stages:
        return no_data("No funnel stages supplied.")
    return render_bar_like(stages, "stage", "count", "funnel", lookup)


def render_waterfall(module: dict[str, Any], lookup: dict[str, dict[str, Any]]) -> str:
    steps = as_list(module.get("steps"))
    if not steps:
        return no_data("No waterfall steps supplied.")
    return render_bar_like(steps, "label", "value", "waterfall", lookup)


def render_line_chart(module: dict[str, Any], lookup: dict[str, dict[str, Any]]) -> str:
    series = as_list(module.get("series"))
    if not series:
        return no_data("No line chart series supplied.")
    width, height = 780, 260
    all_values: list[float] = []
    normalized = []
    for s in series:
        if not isinstance(s, dict):
            continue
        points = []
        for idx, p in enumerate(as_list(s.get("points"))):
            if not isinstance(p, dict):
                p = {"label": str(idx + 1), "value": p}
            val = numeric(p.get("value"))
            if val is None:
                continue
            all_values.append(val)
            points.append((text(p.get("label", idx + 1)), val))
        normalized.append((text(s.get("name", "Series")), points))
    if not all_values:
        return no_data("Line chart values are empty or non-numeric.")
    min_v, max_v = min(all_values), max(all_values)
    if math.isclose(min_v, max_v):
        min_v -= 1
        max_v += 1
    left, right, top, bottom = 54, 18, 18, 46
    plot_w, plot_h = width - left - right, height - top - bottom
    colors = ["#245f5a", "#2563eb", "#b7791f", "#b42318", "#6d28d9"]
    paths = []
    legend = []
    max_points = max((len(points) for _, points in normalized), default=1)
    for sidx, (name, points) in enumerate(normalized):
        if not points:
            continue
        coords = []
        denom = max(1, max_points - 1)
        for idx, (_, val) in enumerate(points):
            x = left + (idx / denom) * plot_w
            y = top + (1 - ((val - min_v) / (max_v - min_v))) * plot_h
            coords.append(f"{x:.1f},{y:.1f}")
        color = colors[sidx % len(colors)]
        paths.append(
            f'<polyline points="{" ".join(coords)}" fill="none" stroke="{color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'
        )
        legend.append(f'<span><i style="--legend-color:{color}"></i>{h(name)}</span>')
    svg = (
        f'<svg class="svg-chart" viewBox="0 0 {width} {height}" role="img" aria-label="{h(module.get("title", "Line chart"))}">'
        f'<line x1="{left}" y1="{height - bottom}" x2="{width - right}" y2="{height - bottom}" stroke="#cbd5d1"/>'
        f'<line x1="{left}" y1="{top}" x2="{left}" y2="{height - bottom}" stroke="#cbd5d1"/>'
        + "".join(paths)
        + "</svg>"
    )
    return (
        '<div class="chart-box" data-responsive-chart>'
        + svg
        + '<div class="chart-legend">'
        + "".join(legend)
        + "</div></div>"
    )


def render_matrix(
    module: dict[str, Any], class_name: str, lookup: dict[str, dict[str, Any]]
) -> str:
    rows = [text(x) for x in as_list(module.get("rows"))]
    columns = [text(x) for x in as_list(module.get("columns"))]
    values = module.get("values", [])
    if not rows or not columns:
        return no_data("Matrix rows or columns are missing.")
    grid_cols = len(columns) + 1
    cells = [f'<div class="{class_name}-cell matrix-header"></div>']
    for col in columns:
        cells.append(f'<div class="{class_name}-cell matrix-header">{h(col)}</div>')
    for r_idx, row in enumerate(rows):
        cells.append(f'<div class="{class_name}-cell matrix-header">{h(row)}</div>')
        for c_idx in range(len(columns)):
            value = ""
            if isinstance(values, list) and r_idx < len(values):
                row_values = values[r_idx]
                if isinstance(row_values, list) and c_idx < len(row_values):
                    value = row_values[c_idx]
                elif isinstance(row_values, dict):
                    value = row_values.get(columns[c_idx], "")
            cells.append(f'<div class="{class_name}-cell">{render_cell(value, lookup)}</div>')
    return f'<div class="{class_name}-grid" style="grid-template-columns: repeat({grid_cols}, minmax(92px, 1fr));">{"".join(cells)}</div>'


def render_heatmap(module: dict[str, Any], lookup: dict[str, dict[str, Any]]) -> str:
    mapped = dict(module)
    mapped["rows"] = module.get("y", module.get("rows"))
    mapped["columns"] = module.get("x", module.get("columns"))
    return render_matrix(mapped, "heatmap", lookup)


def no_data(message: str) -> str:
    return f'<div class="no-data">{h(message)}</div>'


def copy_button(label: str) -> str:
    return f'<button class="copy-button" type="button" data-copy-button aria-label="Copy {h(label)}"><span aria-hidden="true"></span>Copy</button>'


def render_module(module: dict[str, Any], lookup: dict[str, dict[str, Any]]) -> str:
    mtype = text(module.get("type"))
    title = module.get("title") or mtype.replace("_", " ").title()
    subtitle = module.get("subtitle")
    layout = module.get("layout") or ("wide" if mtype in WIDE_MODULES else "standard")
    classes = "module-card"
    if layout in {"wide", "full"}:
        classes += f" {layout}"

    renderer = {
        "metric_strip": render_metric_strip,
        "verdict": render_verdict,
        "md_question": render_md_question,
        "evidence_posture": render_evidence,
        "table": render_table,
        "wide_table": lambda m, l: render_table(m, l, wide=True),
        "flags": render_flags,
        "action_register": render_actions,
        "timeline": render_timeline,
        "funnel": render_funnel,
        "heatmap": render_heatmap,
        "line_chart": render_line_chart,
        "bar_chart": render_bar_chart,
        "waterfall": render_waterfall,
        "sensitivity_matrix": lambda m, l: render_matrix(m, "sensitivity", l),
        "covenant_grid": lambda m, l: render_table(m, l, wide=True),
        "valuation_bridge": render_waterfall,
        "source_readiness": render_source_readiness,
    }.get(mtype)

    body = renderer(module, lookup) if renderer else no_data(f"Unsupported module type: {mtype}")
    source_note = ""
    citation_ids = (
        citation_list(module.get("citation_ids"))
        + citation_list(module.get("source_ids"))
        + citation_list(module.get("citations"))
    )
    if citation_ids:
        source_note = section_citation_note(citation_ids, lookup)
    if module.get("note"):
        source_note += f'<div class="module-note">{render_inline_text(module.get("note"), lookup, module.get("note_citation_ids") or citation_ids, module.get("note"))}</div>'
    module_id = h(module.get("id", slug(title)))
    return (
        f'<article class="{classes}" id="{module_id}" data-copy-block>'
        '<div class="module-inner">'
        '<div class="module-header">'
        f"<div><h3>{render_inline_text(title, lookup, module.get('title_citation_ids'), title)}</h3>"
        + (
            f'<div class="module-subtitle">{render_inline_text(subtitle, lookup, module.get("subtitle_citation_ids"), subtitle)}</div>'
            if subtitle
            else ""
        )
        + "</div>"
        + '<div class="module-actions">'
        + (chip(module.get("status"), module.get("status")) if module.get("status") else "")
        + copy_button(text(title))
        + "</div></div>"
        + body
        + source_note
        + "</div></article>"
    )


def parse_markdown_table(
    block: str, lookup: dict[str, dict[str, Any]], inherited_citations: Any = None
) -> str | None:
    lines = [line.strip() for line in block.strip().splitlines() if line.strip()]
    if len(lines) < 2 or not all(line.startswith("|") and line.endswith("|") for line in lines[:2]):
        return None
    if not set(lines[1].replace("|", "").replace(":", "").strip()) <= {"-"}:
        return None
    rows = []
    for line in lines:
        cells = [cell.strip() for cell in line.strip("|").split("|")]
        rows.append(cells)
    columns = rows[0]
    data_rows = rows[2:]
    if inherited_citations:
        data_rows = [
            {
                **{columns[idx]: cell for idx, cell in enumerate(row) if idx < len(columns)},
                "citation_ids": inherited_citations,
            }
            for row in data_rows
        ]
    return render_table_payload(
        columns,
        data_rows,
        lookup,
        sticky_first=False,
        mobile_stack=True,
        table_label="Report Table",
    )


def render_text_blocks(
    value: Any, lookup: dict[str, dict[str, Any]], inherited_citations: Any = None
) -> str:
    if isinstance(value, list):
        blocks = value
    else:
        blocks = re.split(r"\n\s*\n", text(value))
    rendered = []
    for raw_block in blocks:
        citations = None
        if isinstance(raw_block, dict):
            citations = raw_block.get(
                "citation_ids", raw_block.get("source_ids", inherited_citations)
            )
            block = text(
                raw_block.get("text", raw_block.get("body", raw_block.get("value", "")))
            ).strip()
        else:
            citations = inherited_citations
            block = text(raw_block).strip()
        if not block:
            continue
        table = parse_markdown_table(block, lookup, citations)
        if table:
            rendered.append(table)
            continue
        lines = block.splitlines()
        if all(line.strip().startswith(("- ", "* ")) for line in lines if line.strip()):
            rendered.append(
                '<ul class="report-bullets">'
                + "".join(
                    f"<li>{render_inline_text(line.strip()[2:], lookup, citations, line.strip()[2:])}</li>"
                    for line in lines
                    if line.strip()
                )
                + "</ul>"
            )
        elif block.startswith("### "):
            rendered.append(
                f"<h4>{render_inline_text(block[4:].strip(), lookup, citations, block[4:].strip())}</h4>"
            )
        elif block.startswith("## "):
            rendered.append(
                f"<h3>{render_inline_text(block[3:].strip(), lookup, citations, block[3:].strip())}</h3>"
            )
        else:
            rendered.append(
                f"<p>{'<br>'.join(render_inline_text(line, lookup, citations, line) for line in lines)}</p>"
            )
    return "".join(rendered)


def render_report_table(table: dict[str, Any], lookup: dict[str, dict[str, Any]]) -> str:
    columns = as_list(table.get("columns"))
    labels = [text(c.get("label") if isinstance(c, dict) else c) for c in columns]
    rows = normalize_rows(table.get("rows"), labels)
    table_citations = table.get("citation_ids", table.get("source_ids", table.get("citations")))
    if table_citations:
        cited_rows = []
        for row in rows:
            if isinstance(row, dict):
                row = dict(row)
                if not citation_values(row):
                    row["citation_ids"] = table_citations
            cited_rows.append(row)
        rows = cited_rows
    return render_table_payload(
        columns,
        rows,
        lookup,
        sticky_first=bool(table.get("sticky_first_column")),
        mobile_stack=True,
        table_id=table.get("table_id") or table.get("id"),
        table_label=table.get("download_label") or table.get("title") or "Report Table",
        download_filename=table.get("download_filename"),
        exportable=table.get("exportable", True) is not False,
    )


def render_report_body(
    contract: dict[str, Any], lookup: dict[str, dict[str, Any]], number_label: str = "Report"
) -> str:
    deliverable = get_deliverable(contract)
    sections = as_list(contract.get("report_body") or deliverable.get("report_body"))
    if not sections:
        return ""
    out = ['<section class="dashboard-section report-section" id="report">']
    out.append(
        f'<div class="section-anchor-heading"><span>{h(number_label)}</span><h2>Analysis</h2></div>'
    )
    out.append('<article class="module-flow report-flow wide" data-copy-block>')
    out.append(
        '<div class="module-header module-header-actions-only">'
        + copy_button("full analysis")
        + "</div>"
    )
    out.append('<div class="analysis-stack">')
    for idx, section in enumerate(sections):
        if not isinstance(section, dict):
            section = {"title": f"Section {idx + 1}", "body": section}
        sid = text(section.get("id") or slug(section.get("title", f"report-{idx + 1}")))
        title = text(section.get("title") or f"Section {idx + 1}")
        section_citations = section.get("citation_ids", section.get("source_ids"))
        summary_attr = (
            " data-executive-summary-copy-source"
            if is_executive_summary_section(section, idx)
            else ""
        )
        out.append(f'<section class="report-subsection" id="{h(sid)}"{summary_attr}>')
        out.append(f"<h4>{render_inline_text(title, lookup, section_citations, title)}</h4>")
        if section.get("subtitle"):
            out.append(
                f'<div class="module-subtitle">{render_inline_text(section.get("subtitle"), lookup, section.get("subtitle_citation_ids") or section_citations, section.get("subtitle"))}</div>'
            )
        body = section.get("body") or section.get("markdown") or section.get("paragraphs")
        if body:
            out.append(
                f'<div class="copyable-report">{render_text_blocks(body, lookup, section_citations)}</div>'
            )
        bullets = as_list(section.get("bullets"))
        if bullets:
            out.append('<ul class="report-bullets check-list">')
            for item in bullets:
                if isinstance(item, dict):
                    bullet_text = item.get("text", item.get("value", ""))
                    out.append(
                        f"<li>{render_inline_text(bullet_text, lookup, item.get('citation_ids', item.get('source_ids', section_citations)), bullet_text)}</li>"
                    )
                else:
                    out.append(
                        f"<li>{render_inline_text(item, lookup, section_citations, item)}</li>"
                    )
            out.append("</ul>")
        for callout in as_list(section.get("callouts")):
            if isinstance(callout, dict):
                out.append(
                    f'<div class="report-callout">{chip(callout.get("label", "note"), callout.get("tone", "info"))}<div>{render_inline_text(callout.get("text", ""), lookup, callout.get("citation_ids", callout.get("source_ids", section_citations)), callout.get("text"))}</div></div>'
                )
            else:
                out.append(
                    f'<div class="report-callout">{render_inline_text(callout, lookup, section_citations, callout)}</div>'
                )
        for table in as_list(section.get("tables")):
            if isinstance(table, dict):
                if table.get("title"):
                    out.append(
                        f"<h4>{render_inline_text(table.get('title'), lookup, table.get('citation_ids', table.get('source_ids', section_citations)), table.get('title'))}</h4>"
                    )
                out.append(render_report_table(table, lookup))
        if section_citations:
            out.append(section_citation_note(section_citations, lookup))
        out.append("</section>")
    out.append("</div></article></section>")
    return "".join(out)


def diligence_context(contract: dict[str, Any]) -> dict[str, Any]:
    deliverable = get_deliverable(contract)
    ctx = contract.get("blocked_output_context") or deliverable.get("blocked_output_context")
    return ctx if isinstance(ctx, dict) else {}


def render_diligence_context(contract: dict[str, Any], lookup: dict[str, dict[str, Any]]) -> str:
    ctx = diligence_context(contract)
    if not ctx:
        return ""
    fields = [
        ("Blocking reasons", "blocking_reasons"),
        ("Missing inputs", "missing_inputs"),
        ("How to finish diligence", "how_to_unblock"),
        ("Source requests", "source_requests"),
    ]
    rows = []
    for label, key in fields:
        value = ctx.get(key)
        if value in (None, "", []):
            continue
        rows.append([label, render_text_blocks(value, lookup)])
    if not rows:
        return ""
    table_rows = [[label, {"text": re.sub(r"<[^>]+>", " ", html).strip()}] for label, html in rows]
    return (
        '<section class="dashboard-section" id="diligence-gaps">'
        '<div class="section-anchor-heading"><span>Diligence</span><h2>Open Diligence Items</h2></div>'
        '<article class="module-card wide" data-copy-block><div class="module-inner">'
        '<div class="module-header"><div><h3>Items to resolve before decision use</h3></div>'
        + copy_button("open diligence items")
        + "</div>"
        + render_table_payload(
            ["Area", "Need"],
            table_rows,
            lookup,
            sticky_first=True,
            mobile_stack=True,
            table_id="open-diligence-items",
            table_label="Open Diligence Items",
        )
        + "</div></article></section>"
    )


def normalize_supporting_outputs(contract: dict[str, Any]) -> list[dict[str, Any]]:
    deliverable = get_deliverable(contract)
    outputs: list[dict[str, Any]] = []
    for source in [
        deliverable.get("supporting_outputs"),
        contract.get("supporting_outputs"),
        contract.get("artifact_links"),
    ]:
        for item in as_list(source):
            if isinstance(item, dict):
                outputs.append(item)
            elif item:
                outputs.append({"name": item, "path": item, "role": "related file"})
    return outputs


def render_supporting_outputs(contract: dict[str, Any], lookup: dict[str, dict[str, Any]]) -> str:
    outputs = normalize_supporting_outputs(contract)
    if not outputs:
        return ""
    rows = []
    for item in outputs:
        raw_path = item.get("path") or item.get("href") or item.get("name") or item.get("label")
        label = item.get("label") or item.get("display_name")
        if not label or "/" in text(label) or "." in text(label):
            label = file_label(raw_path, item.get("type", ""))
        link = f'<a href="{h(file_href(raw_path))}">{h(label)}</a>' if raw_path else h(label)
        role = public_text(
            item.get("role"),
            file_label(raw_path, item.get("type", "")).replace("Open ", "").title()
            or "Related file",
        )
        notes = public_text(
            item.get("explanation", item.get("description", "")), "Available for follow-up review."
        )
        rows.append(
            [
                {"text": label, "value": label},
                role,
                notes,
                {"html": link, "text": label},
            ]
        )
    return (
        '<section class="dashboard-section related-files-section" id="related-files">'
        '<div class="section-anchor-heading"><span>Files</span><h2>Related Files</h2></div>'
        '<article class="module-flow wide" data-copy-block>'
        '<div class="module-header"><div><h3>Files referenced by this work</h3></div>'
        + copy_button("related files")
        + "</div>"
        + render_table_payload(
            ["File", "Role", "Notes", "Open"],
            rows,
            lookup,
            sticky_first=True,
            mobile_stack=True,
            require_citations=False,
            table_id="related-files",
            table_label="Related Files",
        )
        + "</article></section>"
    )


def plain_summary_text(value: Any) -> str:
    if value in (None, "", []):
        return ""
    if isinstance(value, Mapping):
        parts: list[str] = []
        for key in ["headline", "title", "summary", "answer", "body", "text", "next_action"]:
            if value.get(key):
                parts.append(plain_summary_text(value.get(key)))
        bullets = as_list(value.get("bullets") or value.get("key_points"))
        for bullet in bullets:
            bullet_text = plain_summary_text(bullet)
            if bullet_text:
                parts.append(f"- {bullet_text}")
        return "\n".join(part for part in parts if part).strip()
    if isinstance(value, list):
        return "\n".join(
            part for part in (plain_summary_text(item) for item in value) if part
        ).strip()
    raw = re.sub(r"\s+", " ", text(value)).strip()
    return _CITATION_MARKER_RE.sub("", raw).strip()


def is_executive_summary_section(section: Any, idx: int = 0) -> bool:
    if not isinstance(section, Mapping):
        return False
    label = text(section.get("title") or section.get("label") or section.get("id")).lower()
    if any(
        term in label
        for term in ["executive summary", "summary", "overview", "verdict", "decision read"]
    ):
        return True
    return idx == 0 and bool(section.get("body") or section.get("bullets"))


def report_section_summary_text(section: Mapping[str, Any]) -> str:
    parts = []
    if section.get("body") or section.get("markdown") or section.get("paragraphs"):
        parts.append(
            plain_summary_text(
                section.get("body") or section.get("markdown") or section.get("paragraphs")
            )
        )
    if section.get("bullets"):
        parts.append(plain_summary_text(section.get("bullets")))
    if section.get("callouts"):
        parts.append(plain_summary_text(section.get("callouts")))
    return "\n".join(part for part in parts if part).strip()


def executive_summary_text(contract: dict[str, Any]) -> str:
    deliverable = get_deliverable(contract)
    for value in [
        deliverable.get("executive_summary"),
        contract.get("executive_summary"),
        deliverable.get("summary_copy_text"),
        contract.get("summary_copy_text"),
    ]:
        summary = plain_summary_text(value)
        if summary:
            return summary
    for idx, section in enumerate(
        as_list(contract.get("report_body") or deliverable.get("report_body"))
    ):
        if is_executive_summary_section(section, idx):
            summary = report_section_summary_text(section)
            if summary:
                return summary
    hero = get_hero(contract)
    hero_callout = (
        deliverable.get("hero_callout")
        if isinstance(deliverable.get("hero_callout"), Mapping)
        else {}
    )
    for value in [
        hero_callout.get("summary"),
        hero.get("summary"),
        hero_callout.get("answer"),
        hero.get("answer"),
        hero.get("callout"),
        hero.get("dek"),
    ]:
        summary = plain_summary_text(value)
        if summary:
            return summary
    return ""


def render_executive_summary_copy_source(contract: dict[str, Any]) -> str:
    summary = executive_summary_text(contract)
    if not summary:
        return ""
    blocks = [block.strip() for block in re.split(r"\n{2,}", summary) if block.strip()]
    if not blocks:
        blocks = [summary]
    rendered = "".join(f"<p>{h(block)}</p>" for block in blocks)
    return f'<div class="executive-summary-copy-source" data-executive-summary-copy-source aria-hidden="true"><h2>Executive Summary</h2>{rendered}</div>'


def utility_controls_enabled(contract: dict[str, Any], key: str, default: bool = True) -> bool:
    deliverable = get_deliverable(contract)
    controls = deliverable.get("utility_controls") or contract.get("utility_controls")
    if not isinstance(controls, Mapping):
        return default
    value = controls.get(key)
    return default if value is None else bool(value)


def render_operational_controls(contract: dict[str, Any], output_file: str) -> str:
    actions = []
    hero_actions = normalize_hero_actions(contract, output_file)
    if hero_actions and utility_controls_enabled(contract, "open_primary_artifact", True):
        action = hero_actions[0]
        actions.append(
            f'<a class="utility-action primary" data-open-primary-artifact href="{h(action["href"])}" aria-label="{h(action["label"])}">{h(action["label"])}</a>'
        )
    copy_full_report_default = utility_controls_enabled(contract, "copy_executive_summary", True)
    if utility_controls_enabled(contract, "copy_full_report", copy_full_report_default):
        actions.append(
            '<button class="utility-action" type="button" data-copy-full-report>Copy Full Report</button>'
        )
    if utility_controls_enabled(contract, "print_pdf", True):
        actions.append(
            '<button class="utility-action" type="button" data-print-dashboard>Print / Save PDF</button>'
        )
    if not actions:
        return ""
    return (
        '<section class="dashboard-utility-bar" aria-label="Dashboard actions">'
        '<div><span class="utility-kicker">Reader actions</span></div>'
        '<div class="utility-actions">' + "".join(actions) + "</div></section>"
    )


def render_sources(contract: dict[str, Any], lookup: dict[str, dict[str, Any]]) -> str:
    sources = sorted(
        source_records(contract),
        key=lambda s: (
            text(s.get("quality")),
            text(s.get("type")),
            source_date(s),
            source_title(s),
        ),
    )
    assumptions = as_list(contract.get("assumptions"))
    modules = []
    if sources:
        rows = []
        for src in sources:
            sid = source_id(src, source_title(src))
            title = source_title(src)
            url = source_url(src)
            title_html = (
                f'<a href="{h(url)}" target="_blank" rel="noreferrer">{h(title)}</a>'
                if url
                else h(title)
            )
            rows.append(
                {
                    "_row_id": f"source-{slug(sid)}",
                    "ID": {"text": sid, "html": f'<span class="source-id">{h(sid)}</span>'},
                    "Source": {"text": title, "html": title_html},
                    "Type": text(src.get("type")),
                    "Date": source_date(src),
                    "Quality": text(src.get("quality")),
                    "Location": workbook_location_label(src),
                    "Notes": text(src.get("notes") or src.get("note")),
                }
            )
        modules.append(
            '<article class="module-flow wide source-ledger" data-copy-block><div class="module-header"><div><h3>Source Register</h3>'
            "</div>"
            + copy_button("source register")
            + "</div>"
            + render_table_payload(
                ["ID", "Source", "Type", "Date", "Quality", "Location", "Notes"],
                rows,
                lookup,
                sticky_first=True,
                mobile_stack=True,
                require_citations=False,
                table_id="source-register",
                table_label="Source Register",
            )
            + "</article>"
        )
    if assumptions:
        rows = []
        for a in assumptions:
            if not isinstance(a, dict):
                continue
            assumption_source_id = a.get("source_id", "")
            citation_ids = (
                [assumption_source_id]
                if text(assumption_source_id) in lookup
                else infer_citation_ids(assumption_source_id, lookup, limit=2)
            )
            rows.append(
                [
                    a.get("id", ""),
                    a.get("label", ""),
                    a.get("value", ""),
                    {"text": assumption_source_id, "citation_ids": citation_ids},
                ]
            )
        modules.append(
            '<article class="module-flow wide" data-copy-block><div class="module-header"><h3>Assumption Register</h3>'
            + copy_button("assumption register")
            + "</div>"
            + render_table_payload(
                ["ID", "Assumption", "Value", "Source"],
                rows,
                lookup,
                sticky_first=True,
                mobile_stack=True,
                table_id="assumption-register",
                table_label="Assumption Register",
            )
            + "</article>"
        )
    if not modules:
        modules.append(
            '<article class="module-flow wide">'
            + no_data("No sources or assumptions supplied.")
            + "</article>"
        )
    return (
        '<section class="dashboard-section" id="sources">'
        '<div class="section-anchor-heading"><span>Sources</span><h2>Sources & Assumptions</h2></div>'
        '<div class="module-grid">' + "".join(modules) + "</div></section>"
    )


def is_front_summary_section(section: Any, idx: int) -> bool:
    if not isinstance(section, dict):
        return False
    label = text(section.get("label") or section.get("title") or section.get("id")).lower()
    if idx == 0 and any(term in label for term in ["summary", "overview", "verdict"]):
        return True
    return slug(label) in {"summary", "overview", "executive-summary", "verdict"}


def split_dashboard_sections(contract: dict[str, Any]) -> tuple[list[Any], list[Any]]:
    front: list[Any] = []
    rest: list[Any] = []
    for idx, section in enumerate(as_list(contract.get("sections"))):
        if is_front_summary_section(section, idx):
            front.append(section)
        else:
            rest.append(section)
    return front, rest


def render_dashboard_sections(
    contract: dict[str, Any],
    lookup: dict[str, dict[str, Any]],
    sections: list[Any] | None = None,
    start_number: int = 1,
) -> str:
    sections = as_list(contract.get("sections")) if sections is None else sections
    section_html = []
    for idx, section in enumerate(sections):
        if not isinstance(section, dict):
            continue
        sid = text(section.get("id") or slug(section.get("label") or f"section-{idx + 1}"))
        label = section.get("label") or section.get("title") or sid.title()
        modules = [
            render_module(module, lookup)
            for module in as_list(section.get("modules"))
            if isinstance(module, dict)
        ]
        title = section.get("title") or label
        intro = section.get("intro")
        display_number = start_number + idx
        section_html.append(
            f'<section class="dashboard-section" id="{h(sid)}">'
            f'<div class="section-anchor-heading"><span>{display_number:02d}</span><h2>{h(title)}</h2></div>'
            + (f'<p class="section-intro">{h(intro)}</p>' if intro else "")
            + '<div class="module-grid">'
            + "".join(modules)
            + "</div>"
            + "</section>"
        )
    return "".join(section_html)


def build_nav_items(contract: dict[str, Any]) -> list[tuple[str, str]]:
    mode = get_render_mode(contract)
    nav: list[tuple[str, str]] = []
    report_body = as_list(
        contract.get("report_body") or get_deliverable(contract).get("report_body")
    )
    if report_body:
        if mode in {"dashboard", "hybrid"}:
            front, rest = split_dashboard_sections(contract)
            for idx, section in enumerate(front):
                sid = text(section.get("id") or slug(section.get("label") or f"section-{idx + 1}"))
                nav.append((sid, text(section.get("label") or section.get("title") or sid.title())))
            nav.append(("report", "Analysis"))
            for idx, section in enumerate(rest, start=len(front)):
                if isinstance(section, dict):
                    sid = text(
                        section.get("id") or slug(section.get("label") or f"section-{idx + 1}")
                    )
                    nav.append(
                        (sid, text(section.get("label") or section.get("title") or sid.title()))
                    )
        else:
            nav.append(("report", "Analysis"))
    elif mode in {"dashboard", "hybrid"}:
        for idx, section in enumerate(as_list(contract.get("sections"))):
            if isinstance(section, dict):
                sid = text(section.get("id") or slug(section.get("label") or f"section-{idx + 1}"))
                nav.append((sid, text(section.get("label") or section.get("title") or sid.title())))
    ctx = diligence_context(contract)
    if ctx.get("blocked") or ctx.get("missing_inputs") or ctx.get("blocking_reasons"):
        nav.append(("diligence-gaps", "Diligence Gaps"))
    nav.append(("sources", "Sources"))
    return nav


def render_toc(contract: dict[str, Any]) -> str:
    links = []
    for idx, (sid, label) in enumerate(build_nav_items(contract), start=1):
        active = " is-active" if idx == 1 else ""
        links.append(
            f'<a class="toc-link{active}" href="#{h(sid)}"><span>{idx:02d}</span>{h(label)}</a>'
        )
    return f'<nav class="toc-list" aria-label="Dashboard contents" data-dashboard-nav>{"".join(links)}</nav>'


def derive_snapshot_items(contract: dict[str, Any]) -> list[dict[str, Any]]:
    explicit = as_list(contract.get("snapshot"))
    if explicit:
        return [item for item in explicit if isinstance(item, dict)]
    deliverable = get_deliverable(contract)
    hero = get_hero(contract)
    status_label, status_detail, status_tone = plain_readiness(readiness_posture(contract))
    primary = hero.get("primary_artifact") or deliverable.get("primary_artifact")
    items = []
    answer = public_text(hero.get("answer"))
    if answer:
        items.append(
            {
                "label": "Decision Read",
                "value": short_value(answer),
                "detail": answer,
                "status": "watch",
            }
        )
    items.append(
        {
            "label": "Readiness",
            "value": status_label,
            "detail": status_detail,
            "status": status_tone,
        }
    )
    if hero.get("confidence") or deliverable.get("confidence"):
        conf = text(hero.get("confidence") or deliverable.get("confidence"))
        items.append(
            {
                "label": "Confidence",
                "value": short_value(conf, conf),
                "detail": conf,
                "status": tone(conf),
            }
        )
    if hero.get("next_action") or deliverable.get("next_action"):
        next_action = text(hero.get("next_action") or deliverable.get("next_action"))
        items.append(
            {
                "label": "Next Action",
                "value": short_value(next_action, "Next step"),
                "detail": next_action,
                "status": "watch",
            }
        )
    if primary:
        items.append(
            {
                "label": "Model File",
                "value": file_label(primary, hero.get("artifact_type")),
                "href": file_href(primary),
                "detail": "Open the supporting model file.",
                "status": "positive",
            }
        )
    return items[:4] if len(items) > 4 else items


def render_snapshot(contract: dict[str, Any], lookup: dict[str, dict[str, Any]]) -> str:
    items = derive_snapshot_items(contract)
    if not items:
        return ""
    tiles = []
    for item in items:
        status = slug(item.get("status") or "")
        value = render_inline_text(
            item.get("value", ""),
            lookup,
            item.get("citation_ids", item.get("source_ids")),
            item.get("value") or item.get("detail"),
        )
        if item.get("href") and "citation-link" not in value:
            value = f'<a href="{h(item.get("href"))}">{value}</a>'
        tiles.append(
            f'<article class="metric-tile {status}">'
            f'<span class="tile-label">{h(item.get("label", ""))}</span>'
            f"<strong>{value}</strong>"
            f"<small>{render_inline_text(item.get('detail', ''), lookup, item.get('detail_citation_ids') or item.get('citation_ids', item.get('source_ids')), item.get('detail'))}</small>"
            "</article>"
        )
    return '<section class="snapshot-grid">' + "".join(tiles) + "</section>"


def render_header(contract: dict[str, Any], lookup: dict[str, dict[str, Any]]) -> str:
    hero = get_hero(contract)
    issuer = contract.get("issuer") if isinstance(contract.get("issuer"), dict) else {}
    accent = safe_color(issuer.get("accent_color") or contract.get("accent_color"), "#245f5a")
    identity_color = safe_color(
        issuer.get("identity_color")
        or issuer.get("brand_dark_color")
        or issuer.get("ticker_badge_color")
        or accent,
        "#245f5a",
    )
    entity = text(issuer.get("name") or contract.get("entity") or "")
    generated = text(
        contract.get("generated_at") or contract.get("as_of") or contract.get("period") or ""
    )
    eyebrow = public_text(hero.get("eyebrow"), "Investment Banking Dashboard")
    headline = get_title(contract)
    dek = public_text(
        hero.get("dek") or hero.get("summary") or contract.get("subtitle"),
        text(contract.get("decision_question") or "Decision-oriented transaction dashboard."),
    )
    callout_label = public_text(hero.get("callout_label"), "Core Question")
    callout = public_text(hero.get("callout"), public_text(hero.get("answer")))
    callout_html = ""
    hero_class = "hero"
    if callout:
        callout_html = f"""
        <div class="hero-callout">
          <span class="label">{h(callout_label)}</span>
          <strong>{render_inline_text(callout, lookup, hero.get("citation_ids", hero.get("source_ids")), callout)}</strong>
        </div>"""
    else:
        hero_class += " no-callout"
    utility_right = generated if generated else text(contract.get("period") or "")
    return f"""
    <header class="top-band" style="--issuer-accent: {h(accent)}; --ticker-badge-bg: {h(identity_color)}">
      <nav class="utility">
        <span>{h(eyebrow)}</span>
        <span>{h(entity)}</span>
        <span>{h(utility_right)}</span>
      </nav>
      <section class="{hero_class}">
        <div class="identity-lockup" aria-label="Entity identity tile"><span>{h(identity_text(contract))}</span></div>
        <div class="hero-copy">
          <p class="eyebrow">{h(eyebrow)}</p>
          <h1>{h(headline)}</h1>
          <p>{render_inline_text(dek, lookup, hero.get("dek_citation_ids"), dek)}</p>
        </div>
        {callout_html}
      </section>
    </header>
    """


def get_output_filename(contract: dict[str, Any], override: str | None = None) -> str:
    if override:
        return override
    deliverable = get_deliverable(contract)
    if deliverable.get("output_filename"):
        return text(deliverable.get("output_filename"))
    if contract.get("output_filename"):
        return text(contract.get("output_filename"))
    mode = get_render_mode(contract)
    return "report.html" if mode == "report_only" else "dashboard.html"


def render_html(contract: dict[str, Any], css: str, js: str, warnings: list[str]) -> str:
    mode = get_render_mode(contract)
    lookup = source_lookup(contract)
    output_file = get_output_filename(contract)
    front_sections, remaining_sections = (
        split_dashboard_sections(contract) if mode in {"dashboard", "hybrid"} else ([], [])
    )
    report_sections = as_list(
        contract.get("report_body") or get_deliverable(contract).get("report_body")
    )
    report_number = len(front_sections) + 1 if report_sections else 0
    remaining_start = len(front_sections) + (1 if report_sections else 0) + 1
    sections = [
        render_snapshot(contract, lookup),
        render_toc(contract),
    ]
    if mode in {"dashboard", "hybrid"}:
        sections.append(render_dashboard_sections(contract, lookup, front_sections, start_number=1))
    sections.append(
        render_report_body(
            contract, lookup, number_label=f"{report_number:02d}" if report_number else "Report"
        )
    )
    if mode in {"dashboard", "hybrid"}:
        sections.append(
            render_dashboard_sections(
                contract, lookup, remaining_sections, start_number=remaining_start
            )
        )
    sections.append(render_diligence_context(contract, lookup))
    sections.append(render_supporting_outputs(contract, lookup))
    sections.append(render_sources(contract, lookup))
    generated = contract.get("generated_at") or datetime.now(timezone.utc).isoformat()
    metadata = contract.get("metadata") if isinstance(contract.get("metadata"), Mapping) else {}
    footer_note = (
        " Draft citation gaps accepted; not for external circulation."
        if metadata.get("citation_gap_accepted")
        else ""
    )
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{h(get_title(contract))}</title>
  <style>{css}</style>
</head>
<body>
  <div class="dashboard-shell render-mode-{h(mode)}">
    {render_header(contract, lookup)}
    {render_operational_controls(contract, output_file)}
    <main data-report-copy-root>
      {"".join(section for section in sections if section)}
      <footer class="audit-footer">Generated {h(generated)}. Refresh source data before external use.{h(footer_note)}</footer>
    </main>
  </div>
  <script>window.DASHBOARD_SOURCE_DATA = {safe_json(source_tooltip_payload(contract))};</script>
  <script>{js}</script>
</body>
</html>
"""


def audit_payload(
    contract: dict[str, Any],
    warnings: list[str],
    generated_files: list[str],
    output_file: str,
    validation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    module_counts: dict[str, int] = {}
    for section in as_list(contract.get("sections")):
        if not isinstance(section, dict):
            continue
        for module in as_list(section.get("modules")):
            if isinstance(module, dict):
                mtype = text(module.get("type", "unknown"))
                module_counts[mtype] = module_counts.get(mtype, 0) + 1
    deliverable = get_deliverable(contract)
    blocked_ctx = diligence_context(contract)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "title": get_title(contract),
        "entity": contract.get("entity"),
        "skill": contract.get("skill"),
        "render_mode": get_render_mode(contract),
        "hero_artifact": get_hero(contract).get("primary_artifact")
        or deliverable.get("primary_artifact")
        or output_file,
        "output_file": output_file,
        "section_count": len(as_list(contract.get("sections"))),
        "report_section_count": len(
            as_list(contract.get("report_body") or deliverable.get("report_body"))
        ),
        "module_counts": module_counts,
        "source_count": len(source_records(contract)),
        "assumption_count": len(as_list(contract.get("assumptions"))),
        "supporting_output_count": len(normalize_supporting_outputs(contract)),
        "blocked": bool(blocked_ctx.get("blocked")) if isinstance(blocked_ctx, dict) else False,
        "warnings": warnings,
        "generated_files": generated_files,
    }
    if validation:
        audit.update(
            {
                "citation_policy": validation.get("citation_policy"),
                "readiness_posture": validation.get("readiness_posture"),
                "effective_readiness_posture": validation.get("effective_readiness_posture"),
                "citation_warnings": validation.get("citation_warnings", []),
                "citation_errors": validation.get("citation_errors", []),
                "blocking_errors": validation.get("blocking_errors", []),
                "accepted_draft_citation_gaps": validation.get(
                    "accepted_draft_citation_gaps", False
                ),
            }
        )
    return audit


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--contract",
        required=True,
        type=Path,
        help="Path to the internal dashboard/report render contract",
    )
    parser.add_argument(
        "--outdir", required=True, type=Path, help="Output directory for the HTML package"
    )
    parser.add_argument("--shared-dir", type=Path, help="Optional path to shared/dashboard assets")
    parser.add_argument("--output-name", help="Override the HTML output filename")
    parser.add_argument(
        "--write-support-json",
        action="store_true",
        help="Write machine-readable support JSON files for automated tests or audit workflows. Off by default.",
    )
    parser.add_argument(
        "--json-run-log",
        "--json",
        dest="json_run_log",
        action="store_true",
        help="Print the machine-readable run log to stdout. Default stdout is human-readable.",
    )
    parser.add_argument(
        "--quiet-human-output",
        action="store_true",
        help="Suppress human-readable stdout when --json-run-log is not used.",
    )
    parser.add_argument(
        "--accept-draft-citation-gaps",
        action="store_true",
        help="Explicitly accept citation gaps as draft-only. Requires --citation-gap-acceptance-reason for senior/client/committee/board/external postures.",
    )
    parser.add_argument(
        "--citation-gap-acceptance-reason",
        default="",
        help="Reason for accepting citation gaps as draft-only when downgrading a senior-ready posture.",
    )
    args = parser.parse_args()

    contract = json.loads(args.contract.read_text())
    if not isinstance(contract, dict):
        raise SystemExit("Contract root must be a JSON object.")
    contract["_contract_dir"] = str(args.contract.resolve().parent)

    validation = validate_contract(
        contract,
        accept_draft_citation_gaps=args.accept_draft_citation_gaps,
        citation_gap_acceptance_reason=args.citation_gap_acceptance_reason,
    )

    args.outdir.mkdir(parents=True, exist_ok=True)
    output_file = get_output_filename(contract, args.output_name)
    if validation["blocking_errors"]:
        generated_files: list[str] = []
        blocked_log = {
            "status": "blocked_citation_validation",
            "contract": str(args.contract),
            "outdir": str(args.outdir),
            "output_file": output_file,
            "render_mode": get_render_mode(contract),
            "warnings": validation["warnings"],
            "citation_warnings": validation["citation_warnings"],
            "citation_errors": validation["citation_errors"],
            "blocking_errors": validation["blocking_errors"],
            "readiness_posture": validation["readiness_posture"],
            "effective_readiness_posture": validation["effective_readiness_posture"],
            "citation_policy": validation["citation_policy"],
            "how_to_fix": validation["how_to_fix"],
            "draft_override_available": validation["draft_override_available"],
            "accepted_draft_citation_gaps": validation["accepted_draft_citation_gaps"],
            "generated_files": generated_files,
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "support_json_written": bool(args.write_support_json),
        }
        if args.write_support_json:
            (args.outdir / "render_contract.audit.json").write_text(
                json.dumps(contract, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
            )
            (args.outdir / "citation_validation.audit.json").write_text(
                json.dumps(blocked_log, indent=2) + "\n", encoding="utf-8"
            )
            generated_files.extend(["render_contract.audit.json", "citation_validation.audit.json"])
            blocked_log["generated_files"] = generated_files
            (args.outdir / "run_log.json").write_text(
                json.dumps(blocked_log, indent=2) + "\n", encoding="utf-8"
            )
            generated_files.append("run_log.json")
            blocked_log["generated_files"] = generated_files
        if args.json_run_log:
            print(json.dumps(blocked_log, indent=2))
        elif not args.quiet_human_output:
            print("Dashboard render blocked by citation validation.")
            print(f"Status: {blocked_log['status']}")
            print(f"Readiness posture: {blocked_log['readiness_posture']}")
            print(f"Output not written: {output_file}")
            for error in blocked_log["blocking_errors"][:8]:
                print(f"- {error}")
            print(
                "Next action: repair citations/source register or rerun as an accepted draft with a reason."
            )
        return 1

    css, js = load_shared(args.shared_dir, Path(__file__).resolve())
    if not css:
        validation["warnings"].append(
            "Shared CSS not found; HTML will render without the standard style layer."
        )
        validation["layout_warnings"].append(
            "Shared CSS not found; HTML will render without the standard style layer."
        )
    if not js:
        validation["warnings"].append(
            "Shared JS not found; HTML will render without progressive navigation behavior."
        )
        validation["layout_warnings"].append(
            "Shared JS not found; HTML will render without progressive navigation behavior."
        )
    warnings = validation["warnings"]
    html = render_html(contract, css, js, warnings)
    (args.outdir / output_file).write_text(html, encoding="utf-8")

    generated_files = [output_file]
    audit = audit_payload(contract, warnings, generated_files, output_file, validation)
    if args.write_support_json:
        (args.outdir / "render_contract.audit.json").write_text(
            json.dumps(contract, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        (args.outdir / "artifact_audit.json").write_text(
            json.dumps(audit, indent=2) + "\n", encoding="utf-8"
        )
        generated_files.extend(["render_contract.audit.json", "artifact_audit.json"])
        audit["generated_files"] = generated_files
        (args.outdir / "run_log.json").write_text(
            json.dumps({"status": "ok", "audit": audit}, indent=2) + "\n", encoding="utf-8"
        )
        generated_files.append("run_log.json")

    run_log = {
        "status": "draft_with_citation_gaps"
        if validation["accepted_draft_citation_gaps"]
        else ("ok" if not warnings else "ok_with_warnings"),
        "contract": str(args.contract),
        "outdir": str(args.outdir),
        "output_file": output_file,
        "render_mode": get_render_mode(contract),
        "warnings": warnings,
        "citation_warnings": validation["citation_warnings"],
        "citation_errors": validation["citation_errors"],
        "blocking_errors": validation["blocking_errors"],
        "readiness_posture": validation["readiness_posture"],
        "effective_readiness_posture": validation["effective_readiness_posture"],
        "citation_policy": validation["citation_policy"],
        "accepted_draft_citation_gaps": validation["accepted_draft_citation_gaps"],
        "citation_gap_acceptance_reason": validation["citation_gap_acceptance_reason"],
        "draft_override_available": validation["draft_override_available"],
        "generated_files": generated_files,
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "support_json_written": bool(args.write_support_json),
    }
    if args.json_run_log:
        print(json.dumps(run_log, indent=2))
    elif not args.quiet_human_output:
        print(f"Dashboard render complete: {run_log['status']}")
        print(f"Open first: {Path(args.outdir) / output_file}")
        print(f"Readiness posture: {run_log['effective_readiness_posture']}")
        if warnings:
            print(f"Warnings: {len(warnings)}. Use --json-run-log for machine-readable detail.")
        if args.write_support_json:
            print("Support JSON written for audit/debug use.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
