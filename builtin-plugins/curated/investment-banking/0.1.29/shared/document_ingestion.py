from __future__ import annotations

import re
import zipfile
from pathlib import Path
from typing import Any


def inspect_document(path: str | Path) -> dict[str, Any]:
    candidate = Path(path)
    suffix = candidate.suffix.lower()
    result = {
        "path": str(candidate),
        "exists": candidate.exists(),
        "document_type": suffix.lstrip(".") or "unknown",
        "text_extractable": False,
        "extraction_confidence": "none",
        "ocr_required": False,
        "page_count": None,
        "text_excerpt": "",
        "warnings": [],
    }
    if not candidate.exists():
        result["warnings"].append("file does not exist")
        return result
    if suffix in {".txt", ".csv", ".md"}:
        text = candidate.read_text(encoding="utf-8", errors="ignore")
        result.update(
            {
                "text_extractable": True,
                "extraction_confidence": "high",
                "page_count": 1,
                "text_excerpt": text[:1000],
            }
        )
        return result
    if suffix == ".docx":
        try:
            with zipfile.ZipFile(candidate) as archive:
                xml = archive.read("word/document.xml").decode("utf-8", errors="ignore")
            text = re.sub(r"<[^>]+>", " ", xml)
            result.update(
                {
                    "text_extractable": bool(text.strip()),
                    "extraction_confidence": "medium",
                    "page_count": None,
                    "text_excerpt": " ".join(text.split())[:1000],
                }
            )
        except Exception as exc:  # noqa: BLE001
            result["warnings"].append(f"docx extraction failed: {exc}")
        return result
    if suffix == ".pdf":
        data = candidate.read_bytes()
        result["page_count"] = max(1, data.count(b"/Type /Page"))
        rough_text_tokens = re.findall(rb"[A-Za-z0-9][A-Za-z0-9 ,.;:%$()/-]{12,}", data[:250000])
        if rough_text_tokens:
            text = b" ".join(rough_text_tokens[:30]).decode("latin-1", errors="ignore")
            result.update(
                {
                    "text_extractable": True,
                    "extraction_confidence": "low",
                    "text_excerpt": text[:1000],
                    "ocr_required": True,
                }
            )
            result["warnings"].append(
                "PDF text extraction is heuristic; use OCR/native source for senior-ready work"
            )
        else:
            result.update(
                {"text_extractable": False, "extraction_confidence": "none", "ocr_required": True}
            )
            result["warnings"].append(
                "PDF appears image-only or text is not extractable; OCR required"
            )
        return result
    result["warnings"].append("unsupported document type for bundled extraction")
    return result
