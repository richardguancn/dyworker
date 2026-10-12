#!/usr/bin/env python3
"""
First-pass IB deck QC extractor for banker/client-circulation materials.

Supported inputs: .pptx, .docx, .xlsx, .xlsm, .csv, .txt, .md
Outputs: segments.csv, numbers.csv, issues.csv, scan.json, qc_report.html

This script is intentionally conservative. It identifies leads for review; it does
not replace visual review, model tie-out, or source-of-truth analysis.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from html import escape
from pathlib import Path
from typing import Iterable

PLUGIN_ROOT = Path(__file__).resolve().parents[3]
if str(PLUGIN_ROOT) not in sys.path:
    sys.path.insert(0, str(PLUGIN_ROOT))

from shared.artifacts import (  # noqa: E402
    artifact_item,
    logs_dir,
    support_dir,
    write_artifact_manifest,
)


def _write_html_report(
    path: Path,
    input_files: list[Path],
    segments: list[dict[str, str]],
    numbers: list[dict[str, str]],
    issues: list[dict[str, str]],
) -> None:
    severity_rank = {"critical": 0, "high": 1, "medium": 2, "needs_review": 3, "low": 4}
    top = sorted(issues, key=lambda i: severity_rank.get(i["severity"], 99))[:12]
    posture = posture_from_issues(issues)
    posture_label = posture.replace("-", " ").upper()
    source_names = ", ".join(escape(path.name) for path in input_files)
    blocker_count = sum(i["severity"] in {"critical", "high"} for i in issues)
    if top:
        rows = "\n".join(
            f"""<tr>
              <td><strong>{escape(issue["issue_id"])}</strong></td>
              <td><span class="severity {escape(issue["severity"])}">{escape(issue["severity"])}</span></td>
              <td>{escape(issue["location"])}</td>
              <td><strong>{escape(issue["finding"])}</strong><div class="sub">{escape(issue["why_it_matters"])}</div></td>
              <td>{escape(issue["suggested_fix"])}<div class="sub">{escape(issue["owner_route"])}</div></td>
            </tr>"""
            for issue in top
        )
    else:
        rows = """<tr><td colspan="5">No heuristic issues were identified. Visual review and source/model tie-out are still required before circulation.</td></tr>"""
    html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>IB Deck QC - First-Pass Circulation Review</title>
  <style>
    :root {{ --ink: #172234; --muted: #5b677a; --navy: #183149; --rule: #dbe2e9; --soft: #f5f7f9; --warn: #9a6700; --danger: #a83232; --green: #226b61; }}
    * {{ box-sizing: border-box; }}
    body {{ margin: 0; font-family: Arial, Helvetica, sans-serif; background: #fff; color: var(--ink); }}
    main {{ max-width: 1220px; margin: 0 auto; padding: 42px 46px 56px; }}
    .eyebrow {{ margin: 0 0 14px; color: var(--green); font-size: 12px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }}
    h1 {{ margin: 0 0 12px; max-width: 880px; font-size: clamp(30px, 4vw, 46px); line-height: 1.08; letter-spacing: -.035em; }}
    .intro {{ margin: 0 0 30px; max-width: 850px; color: var(--muted); font-size: 17px; line-height: 1.5; }}
    .verdict {{ display: grid; grid-template-columns: 1.25fr .75fr; border-top: 4px solid var(--navy); border-bottom: 1px solid var(--rule); margin: 0 0 34px; padding: 22px 0; gap: 32px; }}
    .verdict h2 {{ margin: 5px 0 8px; font-size: 27px; }}
    .verdict p {{ margin: 0; color: var(--muted); line-height: 1.5; }}
    .stats {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }}
    .stat {{ background: var(--soft); padding: 14px 15px; border-radius: 6px; }}
    .stat .value {{ display: block; font-size: 25px; font-weight: 700; }}
    .stat .label {{ color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .05em; }}
    h3 {{ margin: 34px 0 12px; font-size: 20px; }}
    .limits {{ border-left: 4px solid #d2a338; background: #fffaf0; padding: 15px 18px; color: #4d4c48; line-height: 1.55; margin-bottom: 26px; }}
    table {{ width: 100%; border-collapse: collapse; font-size: 14px; line-height: 1.42; }}
    th {{ background: var(--navy); color: #fff; text-align: left; padding: 12px 13px; font-size: 12px; letter-spacing: .05em; text-transform: uppercase; }}
    td {{ border-bottom: 1px solid var(--rule); padding: 14px 13px; vertical-align: top; }}
    td:nth-child(1) {{ width: 92px; }}
    td:nth-child(2) {{ width: 108px; }}
    td:nth-child(3) {{ width: 160px; font-weight: 700; }}
    td:nth-child(5) {{ width: 29%; }}
    .sub {{ margin-top: 7px; color: var(--muted); }}
    .severity {{ display: inline-block; border-radius: 20px; padding: 4px 9px; text-transform: uppercase; font-size: 11px; font-weight: 700; letter-spacing: .05em; }}
    .severity.critical {{ background: #fae8e8; color: var(--danger); }}
    .severity.high {{ background: #fff0df; color: #9c5200; }}
    .severity.medium, .severity.needs_review {{ background: #edf2f7; color: #445568; }}
    .severity.low {{ background: #eaf5f0; color: var(--green); }}
    .sources {{ margin-top: 30px; padding-top: 19px; border-top: 1px solid var(--rule); color: var(--muted); font-size: 13px; line-height: 1.55; }}
    @media (max-width: 800px) {{ main {{ padding: 26px 18px; }} .verdict {{ display: block; }} .stats {{ margin-top: 22px; }} table {{ display: block; overflow-x: auto; }} }}
    @media print {{ main {{ max-width: none; padding: 0; }} }}
  </style>
</head>
<body>
  <main>
    <p class="eyebrow">Investment Banking | Circulation QC</p>
    <h1>First-pass review of circulation materials</h1>
    <p class="intro">Heuristic extraction report for <strong>{source_names}</strong>. Use this first read to prioritize remediation, then complete rendered page review and source/model tie-out before external circulation.</p>
    <section class="verdict">
      <div>
        <p class="eyebrow">Preliminary Posture</p>
        <h2>{escape(posture_label)}</h2>
        <p>This posture is based on extracted text and detected issue candidates only. It is not a final circulation approval.</p>
      </div>
      <div class="stats">
        <div class="stat"><span class="value">{len(issues)}</span><span class="label">Issues</span></div>
        <div class="stat"><span class="value">{blocker_count}</span><span class="label">Critical / high</span></div>
        <div class="stat"><span class="value">{len(numbers)}</span><span class="label">Numbers</span></div>
      </div>
    </section>
    <div class="limits"><strong>Required before circulation:</strong> visually inspect the rendered pages/slides, tie decision-critical numbers to their model or source, confirm source and footnote coverage, and resolve every critical/high item. Text segments extracted: {len(segments)}.</div>
    <h3>Issues To Review First</h3>
    <table>
      <thead><tr><th>ID</th><th>Severity</th><th>Location</th><th>Finding / Why It Matters</th><th>Required Fix / Route</th></tr></thead>
      <tbody>{rows}</tbody>
    </table>
    <div class="sources"><strong>Backing audit files:</strong> <code>support/segments.csv</code>, <code>support/numbers.csv</code>, <code>support/issues.csv</code>, and <code>logs/scan.json</code>. These files support remediation tracking and are not the circulation deliverable.</div>
  </main>
</body>
</html>
"""
    path.write_text(html, encoding="utf-8")


TEXT_EXTS = {".txt", ".md", ".markdown"}
ZIP_EXTS = {".pptx", ".docx", ".xlsx", ".xlsm"}

SOURCE_TERMS = re.compile(
    r"\b(source|sources|note|notes|footnote|as of|as-of|company filing|filings|10-k|10-q|8-k|transcript|press release|factset|bloomberg|capital iq|s&p|lseg|refinitiv|pitchbook|morningstar|moody|fitch|management|seller|cim|model|internal estimate|consensus)\b",
    re.I,
)
DATE_TERMS = re.compile(
    r"\b(as of|as-of|through|dated|date|period ended|fye|fiscal year|quarter ended|q[1-4]|fy\d{2,4}|cy\d{2,4}|ltm|ntm|ytd|\d{1,2}/\d{1,2}/\d{2,4}|\d{4}-\d{2}-\d{2}|jan\.?|feb\.?|mar\.?|apr\.?|may|jun\.?|jul\.?|aug\.?|sep\.?|sept\.?|oct\.?|nov\.?|dec\.?)\b",
    re.I,
)
MARKET_TERMS = re.compile(
    r"\b(share price|stock price|market cap|enterprise value|ev|equity value|yield|spread|bps|rate|fx|commodity|index|multiple|consensus|estimate|short interest|volume|price target|valuation|trading|credit spread)\b",
    re.I,
)
CLAIM_WORDS = re.compile(
    r"\b(best[- ]in[- ]class|market leader|clear leader|dominant|unique|proprietary|significant|compelling|attractive|resilient|defensible|downside protected|conservative|undervalued|overvalued|mispriced|strong visibility|high quality|mission critical)\b",
    re.I,
)

COMMON_METRICS = [
    "revenue",
    "sales",
    "arr",
    "nrr",
    "gross margin",
    "ebitda margin",
    "ebitda",
    "adjusted ebitda",
    "lender ebitda",
    "ebit",
    "eps",
    "free cash flow",
    "fcf",
    "capex",
    "working capital",
    "nwc",
    "cash",
    "debt",
    "net debt",
    "enterprise value",
    "equity value",
    "market cap",
    "share price",
    "ev",
    "valuation",
    "multiple",
    "ev/ebitda",
    "p/e",
    "irr",
    "moic",
    "npv",
    "nav",
    "ltv",
    "dscr",
    "debt yield",
    "leverage",
    "net leverage",
    "gross leverage",
    "covenant headroom",
    "liquidity",
    "recovery",
    "yield",
    "spread",
    "duration",
    "rate",
    "inflation",
    "cagr",
    "growth",
    "margin",
    "bps",
    "price target",
    "wacc",
    "terminal growth",
    "terminal value",
    "multiple",
]
COMMON_METRICS.sort(key=len, reverse=True)

PERIOD_RE = re.compile(
    r"\b(fy\s?\d{2,4}e?|cy\s?\d{2,4}e?|20\d{2}e?|19\d{2}|q[1-4]\s?['`]?\d{2}|q[1-4]\s?20\d{2}|ltm|ntm|ytd|run[- ]rate|base case|downside|upside|management case|lender case|ic case)\b",
    re.I,
)
NUMBER_RE = re.compile(
    r"(?<![A-Za-z0-9])(?P<full>(?P<prefix>[$€£])?\s*\(?-?\d+(?:,\d{3})*(?:\.\d+)?\)?\s*(?P<suffix>%|bps?|x|turns?|mm|m|bn|b|k|thousand|million|billion)?)",
    re.I,
)


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def safe_text(parts: Iterable[str]) -> str:
    text = " ".join(p.strip() for p in parts if p and p.strip())
    text = re.sub(r"\s+", " ", text).strip()
    return text


def xml_text(xml_bytes: bytes) -> str:
    try:
        root = ET.fromstring(xml_bytes)
    except Exception:
        return ""
    vals = []
    for elem in root.iter():
        if local_name(elem.tag) in {"t", "v"} and elem.text:
            vals.append(elem.text)
    return safe_text(vals)


def paragraphs_from_xml(xml_bytes: bytes) -> list[str]:
    try:
        root = ET.fromstring(xml_bytes)
    except Exception:
        return []
    paras: list[str] = []
    for elem in root.iter():
        if local_name(elem.tag) == "p":
            vals = []
            for child in elem.iter():
                if local_name(child.tag) == "t" and child.text:
                    vals.append(child.text)
            txt = safe_text(vals)
            if txt:
                paras.append(txt)
    return paras


def numeric_sort_key(name: str) -> tuple[int, str]:
    nums = re.findall(r"\d+", name)
    return (int(nums[-1]) if nums else 0, name)


def extract_pptx(path: Path) -> list[dict[str, str]]:
    segments: list[dict[str, str]] = []
    with zipfile.ZipFile(path) as zf:
        slide_names = sorted(
            [n for n in zf.namelist() if re.match(r"ppt/slides/slide\d+\.xml$", n)],
            key=numeric_sort_key,
        )
        for idx, name in enumerate(slide_names, 1):
            text = xml_text(zf.read(name))
            title = text.split(". ", 1)[0][:120] if text else ""
            segments.append(
                {
                    "source_file": str(path),
                    "file_type": "pptx",
                    "location_type": "slide",
                    "location": f"Slide {idx}",
                    "title": title,
                    "text": text,
                }
            )
        note_names = sorted(
            [n for n in zf.namelist() if re.match(r"ppt/notesSlides/notesSlide\d+\.xml$", n)],
            key=numeric_sort_key,
        )
        for idx, name in enumerate(note_names, 1):
            text = xml_text(zf.read(name))
            if text:
                segments.append(
                    {
                        "source_file": str(path),
                        "file_type": "pptx",
                        "location_type": "notes",
                        "location": f"Notes {idx}",
                        "title": "speaker notes",
                        "text": text,
                    }
                )
        chart_names = sorted(
            [n for n in zf.namelist() if re.match(r"ppt/charts/chart\d+\.xml$", n)],
            key=numeric_sort_key,
        )
        for idx, name in enumerate(chart_names, 1):
            text = xml_text(zf.read(name))
            if text:
                segments.append(
                    {
                        "source_file": str(path),
                        "file_type": "pptx",
                        "location_type": "chart_xml",
                        "location": f"Chart {idx}",
                        "title": "embedded chart data",
                        "text": text,
                    }
                )
    return segments


def extract_docx(path: Path) -> list[dict[str, str]]:
    segments: list[dict[str, str]] = []
    with zipfile.ZipFile(path) as zf:
        for name, label in [
            ("word/document.xml", "paragraph"),
            ("word/footnotes.xml", "footnote"),
            ("word/endnotes.xml", "endnote"),
            ("word/comments.xml", "comment"),
        ]:
            if name not in zf.namelist():
                continue
            paras = paragraphs_from_xml(zf.read(name))
            for idx, para in enumerate(paras, 1):
                segments.append(
                    {
                        "source_file": str(path),
                        "file_type": "docx",
                        "location_type": label,
                        "location": f"{label.title()} {idx}",
                        "title": para[:100],
                        "text": para,
                    }
                )
    return segments


def read_shared_strings(zf: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    try:
        root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    except Exception:
        return []
    strings = []
    for si in root.iter():
        if local_name(si.tag) == "si":
            vals = []
            for child in si.iter():
                if local_name(child.tag) == "t" and child.text:
                    vals.append(child.text)
            strings.append("".join(vals))
    return strings


def extract_xlsx(path: Path) -> list[dict[str, str]]:
    segments: list[dict[str, str]] = []
    with zipfile.ZipFile(path) as zf:
        shared = read_shared_strings(zf)
        sheet_names = sorted(
            [n for n in zf.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml$", n)],
            key=numeric_sort_key,
        )
        for idx, name in enumerate(sheet_names, 1):
            try:
                root = ET.fromstring(zf.read(name))
            except Exception:
                continue
            rows = []
            for row in root.iter():
                if local_name(row.tag) != "row":
                    continue
                vals = []
                for c in row:
                    if local_name(c.tag) != "c":
                        continue
                    ref = c.attrib.get("r", "")
                    ctype = c.attrib.get("t")
                    val_text = ""
                    formula = ""
                    for child in c:
                        lname = local_name(child.tag)
                        if lname == "f" and child.text:
                            formula = "=" + child.text
                        elif lname == "v" and child.text:
                            raw = child.text
                            if ctype == "s":
                                try:
                                    val_text = shared[int(raw)]
                                except Exception:
                                    val_text = raw
                            else:
                                val_text = raw
                        elif lname == "is":
                            val_text = safe_text(
                                [
                                    t.text
                                    for t in child.iter()
                                    if local_name(t.tag) == "t" and t.text
                                ]
                            )
                    if formula:
                        vals.append(f"{ref}:{formula}")
                    elif val_text:
                        vals.append(f"{ref}:{val_text}")
                if vals:
                    rows.append(" | ".join(vals))
            if rows:
                text = "\n".join(rows)
                segments.append(
                    {
                        "source_file": str(path),
                        "file_type": "xlsx",
                        "location_type": "sheet",
                        "location": f"Sheet {idx}",
                        "title": f"Sheet {idx}",
                        "text": text[:200000],
                    }
                )
    return segments


def extract_csv(path: Path) -> list[dict[str, str]]:
    raw = path.read_text(errors="replace")
    lines = raw.splitlines()
    segments = []
    block_size = 50
    for start in range(0, len(lines), block_size):
        block = lines[start : start + block_size]
        if not block:
            continue
        segments.append(
            {
                "source_file": str(path),
                "file_type": "csv",
                "location_type": "row_block",
                "location": f"Rows {start + 1}-{start + len(block)}",
                "title": block[0][:100] if block else "",
                "text": "\n".join(block),
            }
        )
    return segments


def extract_text_file(path: Path) -> list[dict[str, str]]:
    raw = path.read_text(errors="replace")
    lines = raw.splitlines()
    segments = []
    block_size = 40
    for start in range(0, len(lines), block_size):
        block = lines[start : start + block_size]
        if not block:
            continue
        segments.append(
            {
                "source_file": str(path),
                "file_type": path.suffix.lower().lstrip("."),
                "location_type": "line_block",
                "location": f"Lines {start + 1}-{start + len(block)}",
                "title": block[0][:100] if block else "",
                "text": "\n".join(block),
            }
        )
    return segments


def extract_file(path: Path) -> list[dict[str, str]]:
    ext = path.suffix.lower()
    if ext == ".pptx":
        return extract_pptx(path)
    if ext == ".docx":
        return extract_docx(path)
    if ext in {".xlsx", ".xlsm"}:
        return extract_xlsx(path)
    if ext == ".csv":
        return extract_csv(path)
    if ext in TEXT_EXTS:
        return extract_text_file(path)
    return [
        {
            "source_file": str(path),
            "file_type": ext.lstrip("."),
            "location_type": "unsupported",
            "location": "File",
            "title": "unsupported file type",
            "text": "",
        }
    ]


def normalize_number(raw: str) -> tuple[float | None, str]:
    s = raw.strip().replace(" ", "")
    prefix = "currency" if any(sym in s for sym in "$€£") else ""
    suffix_match = re.search(r"(%|bps?|x|turns?|mm|m|bn|b|k|thousand|million|billion)$", s, re.I)
    suffix = suffix_match.group(1).lower() if suffix_match else ""
    neg = s.startswith("-") or ("(" in s and ")" in s)
    num_s = re.sub(r"[^0-9.\-]", "", s)
    try:
        val = float(num_s)
    except Exception:
        return None, "unknown"
    if neg and val > 0:
        val *= -1
    unit_class = "number"
    multiplier = 1.0
    if suffix == "%":
        unit_class = "percent"
    elif suffix in {"bp", "bps"}:
        unit_class = "bps"
    elif suffix in {"x", "turn", "turns"}:
        unit_class = "multiple"
    elif suffix in {"k", "thousand"}:
        unit_class = "currency_or_count"
        multiplier = 1_000.0
    elif suffix in {"m", "mm", "million"}:
        unit_class = "currency_or_count"
        multiplier = 1_000_000.0
    elif suffix in {"b", "bn", "billion"}:
        unit_class = "currency_or_count"
        multiplier = 1_000_000_000.0
    elif prefix:
        unit_class = "currency"
    return val * multiplier, unit_class


def metric_key(context: str) -> str:
    c = context.lower()
    marker = c.find("__num__")
    if marker < 0:
        marker = len(c) // 2

    metric = ""
    best_dist = 10**9
    for m in COMMON_METRICS:
        for hit in re.finditer(r"\b" + re.escape(m) + r"\b", c):
            dist = min(abs(hit.start() - marker), abs(hit.end() - marker))
            if dist < best_dist:
                best_dist = dist
                metric = m

    period = ""
    best_period_dist = 10**9
    for hit in PERIOD_RE.finditer(context):
        dist = min(abs(hit.start() - marker), abs(hit.end() - marker))
        if dist < best_period_dist:
            best_period_dist = dist
            period = hit.group(0).lower().replace(" ", "")

    if metric:
        return "|".join([p for p in [metric, period] if p])
    # Fallback to words immediately before the number.
    before = re.sub(r"[^A-Za-z0-9%/ -]", " ", context[: max(context.find("__NUM__"), 0)])
    words = [w.lower() for w in before.split()[-5:] if len(w) > 2]
    return " ".join(words[-4:]) if words else "unknown"


def extract_numbers(segments: list[dict[str, str]]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for seg in segments:
        text = seg.get("text", "") or ""
        for match in NUMBER_RE.finditer(text):
            raw = match.group("full").strip()
            start, end = match.span()
            # Skip numbers that are clearly components of common date strings such as 1/15/2026 or 2026-01-15.
            if (start > 0 and text[start - 1] in "/-") or (
                end < len(text) and text[end : end + 1] in "/-"
            ):
                continue
            # Skip obvious year-only cases unless context suggests a metric.
            val, unit_class = normalize_number(raw)
            if val is None:
                continue
            context = text[max(0, start - 100) : min(len(text), end + 100)].replace("\n", " ")
            marked_context = (
                context[: start - max(0, start - 100)]
                + "__NUM__"
                + context[start - max(0, start - 100) :]
            )
            key = metric_key(marked_context)
            if (
                unit_class == "number"
                and 1900 <= abs(val) <= 2100
                and not re.search(
                    r"\b(fy|cy|q[1-4]|year|revenue|ebitda|margin|growth|debt|valuation|source|as of)\b",
                    context,
                    re.I,
                )
            ):
                continue
            rows.append(
                {
                    "source_file": seg["source_file"],
                    "file_type": seg["file_type"],
                    "location": seg["location"],
                    "location_type": seg["location_type"],
                    "metric_key": key,
                    "raw_value": raw,
                    "normalized_value": f"{val:.8g}",
                    "unit_class": unit_class,
                    "context": re.sub(r"\s+", " ", context).strip(),
                }
            )
    return rows


def add_issue(
    issues: list[dict[str, str]],
    severity: str,
    issue_type: str,
    confidence: str,
    source_file: str,
    location: str,
    metric_or_claim: str,
    finding: str,
    evidence: str,
    why: str,
    fix: str,
    route: str = "ib-deck-qc",
) -> None:
    issues.append(
        {
            "issue_id": f"QC-{len(issues) + 1:03d}",
            "severity": severity,
            "issue_type": issue_type,
            "confidence": confidence,
            "source_file": source_file,
            "location": location,
            "metric_or_claim": metric_or_claim,
            "finding": finding,
            "evidence": evidence,
            "why_it_matters": why,
            "suggested_fix": fix,
            "owner_route": route,
            "status": "open",
        }
    )


def analyze_segments(
    segments: list[dict[str, str]], numbers: list[dict[str, str]]
) -> list[dict[str, str]]:
    issues: list[dict[str, str]] = []

    # Per-segment source and unit checks.
    for seg in segments:
        text = seg.get("text", "") or ""
        if not text.strip():
            continue
        seg_nums = [
            n
            for n in numbers
            if n["source_file"] == seg["source_file"] and n["location"] == seg["location"]
        ]
        number_count = len(seg_nums)
        source_present = bool(SOURCE_TERMS.search(text))
        date_present = bool(DATE_TERMS.search(text))
        market_present = bool(MARKET_TERMS.search(text))
        if number_count >= 5 and not source_present:
            add_issue(
                issues,
                "medium",
                "source_gap",
                "possible",
                seg["source_file"],
                seg["location"],
                "data-heavy page/section",
                "material numerical content appears without an obvious source footnote",
                f"{number_count} numerical mentions detected; no source terms detected",
                "unsupported numbers reduce senior-review confidence and make tie-out difficult",
                "add source, period/as-of date, and relevant caveats",
                "financial-source-of-truth",
            )
        elif number_count >= 5 and source_present and market_present and not date_present:
            add_issue(
                issues,
                "medium",
                "source_gap",
                "possible",
                seg["source_file"],
                seg["location"],
                "market-sensitive data",
                "market-sensitive numerical content has a source but no obvious as-of date",
                "source terms and market terms detected, but no date/as-of term detected",
                "market data can become stale quickly",
                "add as-of date or period for market/consensus data",
                "financial-source-of-truth",
            )
        suffixes = set()
        for n in seg_nums:
            rv = n["raw_value"].lower()
            if re.search(r"\b(mm|m|million)\b|\d(mm|m)$", rv):
                suffixes.add("millions")
            if re.search(r"\b(bn|b|billion)\b|\d(bn|b)$", rv):
                suffixes.add("billions")
            if "%" in rv:
                suffixes.add("percent")
            if "bp" in rv:
                suffixes.add("bps")
        if {"millions", "billions"}.issubset(suffixes):
            add_issue(
                issues,
                "needs_review",
                "unit_or_period_ambiguity",
                "possible",
                seg["source_file"],
                seg["location"],
                "mixed scale",
                "both million and billion scale markers appear in the same page/section",
                ", ".join(sorted(suffixes)),
                "mixed scale may be correct, but should be explicit in table headers and labels",
                "confirm units are intentional and label scale clearly",
            )
        if {"percent", "bps"}.issubset(suffixes):
            add_issue(
                issues,
                "needs_review",
                "unit_or_period_ambiguity",
                "possible",
                seg["source_file"],
                seg["location"],
                "percent vs bps",
                "both percent and bps markers appear in the same page/section",
                ", ".join(sorted(suffixes)),
                "percentage levels and percentage-point changes are often confused",
                "confirm bps/percentage-point convention in labels and bullets",
            )
        if CLAIM_WORDS.search(text) and number_count < 2 and not source_present:
            claim = CLAIM_WORDS.search(text).group(0)
            add_issue(
                issues,
                "needs_review",
                "narrative_contradiction",
                "possible",
                seg["source_file"],
                seg["location"],
                claim,
                "strong qualitative claim appears with limited visible support",
                claim,
                "senior reviewers will expect evidence for strong claims",
                "add support, soften language, or route to evidence ledger",
                "financial-source-of-truth",
            )

    # Repeated metric checks.
    groups: dict[str, list[dict[str, str]]] = defaultdict(list)
    for n in numbers:
        if n["metric_key"] and n["metric_key"] != "unknown":
            groups[n["metric_key"]].append(n)
    for key, rows in groups.items():
        if len(rows) < 2:
            continue
        # Avoid noise for charts/sheets with too many cells for the same metric.
        locs = sorted({r["location"] for r in rows})
        values_by_unit: dict[str, list[float]] = defaultdict(list)
        for r in rows:
            try:
                values_by_unit[r["unit_class"]].append(float(r["normalized_value"]))
            except Exception:
                pass
        for unit_class, vals in values_by_unit.items():
            uniq = sorted({round(v, 4) for v in vals if math.isfinite(v)})
            if len(uniq) < 2:
                continue
            lo, hi = min(uniq), max(uniq)
            denom = max(abs(hi), abs(lo), 1.0)
            diff_pct = abs(hi - lo) / denom
            # Use a low threshold for percentages/multiples, more tolerance for large currency values.
            threshold = 0.005 if unit_class in {"percent", "bps", "multiple"} else 0.01
            if diff_pct >= threshold:
                examples = []
                for r in rows[:8]:
                    examples.append(f"{r['location']}: {r['raw_value']} ({r['context'][:120]})")
                add_issue(
                    issues,
                    "needs_review",
                    "number_mismatch",
                    "possible",
                    rows[0]["source_file"],
                    "; ".join(locs[:6]),
                    key,
                    "same detected metric key appears with different values across locations",
                    " | ".join(examples),
                    "repeated metrics should tie unless period, unit, scenario, or definition differs",
                    "verify period/unit/scenario; update summary and detail pages to controlling value",
                    "model-audit-tieout",
                )

    return issues


def write_csv(path: Path, rows: list[dict[str, str]], fieldnames: list[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def posture_from_issues(issues: list[dict[str, str]]) -> str:
    severities = [i["severity"] for i in issues]
    if "critical" in severities:
        return "not-circulable"
    if "high" in severities:
        return "needs-targeted-fixes"
    if "medium" in severities or "needs_review" in severities:
        return "senior-review-ready"
    if issues:
        return "senior-review-ready"
    return "no heuristic issues detected; visual/model/source review still required"


def make_report(
    input_files: list[Path],
    segments: list[dict[str, str]],
    numbers: list[dict[str, str]],
    issues: list[dict[str, str]],
) -> str:
    severity_rank = {"critical": 0, "high": 1, "medium": 2, "needs_review": 3, "low": 4}
    top = sorted(issues, key=lambda i: severity_rank.get(i["severity"], 99))[:20]
    lines = []
    lines.append("# First-pass IB Deck QC Scan")
    lines.append("")
    lines.append(f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')} UTC")
    lines.append(f"Input files: {', '.join(str(p) for p in input_files)}")
    lines.append("")
    lines.append("## Summary")
    lines.append(f"- Segments extracted: {len(segments)}")
    lines.append(f"- Numerical mentions detected: {len(numbers)}")
    lines.append(f"- Potential issues flagged: {len(issues)}")
    lines.append(f"- First-pass posture: {posture_from_issues(issues)}")
    lines.append("")
    lines.append(
        "This scan is a first pass. Confirm chart, formatting, and source issues through visual review and source/model tie-out."
    )
    lines.append("")
    lines.append("## Top flagged issues")
    if not top:
        lines.append(
            "No heuristic issues flagged. Still perform visual review and source/model tie-out before circulation."
        )
    else:
        lines.append("| ID | Severity | Type | Location | Finding | Suggested fix |")
        lines.append("|---|---|---|---|---|---|")
        for i in top:
            lines.append(
                f"| {i['issue_id']} | {i['severity']} | {i['issue_type']} | {i['location']} | {i['finding']} | {i['suggested_fix']} |"
            )
    lines.append("")
    lines.append("## Files generated")
    lines.append("- segments.csv")
    lines.append("- numbers.csv")
    lines.append("- issues.csv")
    lines.append("- scan.json")
    return "\n".join(lines)


def write_report(
    path: Path,
    input_files: list[Path],
    segments: list[dict[str, str]],
    numbers: list[dict[str, str]],
    issues: list[dict[str, str]],
) -> None:
    report = make_report(input_files, segments, numbers, issues)
    if path.suffix.lower() == ".html":
        _write_html_report(path, input_files, segments, numbers, issues)
    else:
        path.write_text(report, encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="First-pass QC extractor for investment banking decks and circulation materials"
    )
    parser.add_argument(
        "files", nargs="+", help="input files: pptx, docx, xlsx, xlsm, csv, txt, md"
    )
    parser.add_argument("--outdir", default="qc_out", help="output directory")
    args = parser.parse_args(argv)

    input_files = [Path(f).resolve() for f in args.files]
    outdir = Path(args.outdir).resolve()
    outdir.mkdir(parents=True, exist_ok=True)

    segments: list[dict[str, str]] = []
    for path in input_files:
        if not path.exists():
            print(f"error: missing file: {path}", file=sys.stderr)
            return 2
        if path.suffix.lower() in ZIP_EXTS and not zipfile.is_zipfile(path):
            print(
                f"warning: {path} does not look like a valid zip-based Office file", file=sys.stderr
            )
        try:
            segments.extend(extract_file(path))
        except Exception as exc:
            segments.append(
                {
                    "source_file": str(path),
                    "file_type": path.suffix.lower().lstrip("."),
                    "location_type": "error",
                    "location": "File",
                    "title": "extraction error",
                    "text": f"extraction failed: {exc}",
                }
            )

    numbers = extract_numbers(segments)
    issues = analyze_segments(segments, numbers)

    csv_dir = support_dir(outdir)
    log_dir = logs_dir(outdir)
    write_csv(
        csv_dir / "segments.csv",
        segments,
        ["source_file", "file_type", "location_type", "location", "title", "text"],
    )
    write_csv(
        csv_dir / "numbers.csv",
        numbers,
        [
            "source_file",
            "file_type",
            "location",
            "location_type",
            "metric_key",
            "raw_value",
            "normalized_value",
            "unit_class",
            "context",
        ],
    )
    write_csv(
        csv_dir / "issues.csv",
        issues,
        [
            "issue_id",
            "severity",
            "issue_type",
            "confidence",
            "source_file",
            "location",
            "metric_or_claim",
            "finding",
            "evidence",
            "why_it_matters",
            "suggested_fix",
            "owner_route",
            "status",
        ],
    )
    (log_dir / "scan.json").write_text(
        json.dumps({"segments": segments, "numbers": numbers, "issues": issues}, indent=2),
        encoding="utf-8",
    )
    report_path = outdir / "ib_deck_qc_report.html"
    write_report(report_path, input_files, segments, numbers, issues)
    write_artifact_manifest(
        outdir,
        "ib-deck-qc",
        "html_report",
        report_path,
        support_artifacts=[
            artifact_item(
                csv_dir / "segments.csv",
                "support_artifact",
                "csv",
                "Extracted text segment inventory.",
                False,
                True,
                "CSV is extraction support for reviewers.",
            ),
            artifact_item(
                csv_dir / "numbers.csv",
                "support_artifact",
                "csv",
                "Extracted number inventory.",
                False,
                True,
                "CSV is extraction support for model/source tie-out.",
            ),
            artifact_item(
                csv_dir / "issues.csv",
                "support_artifact",
                "csv",
                "Raw issue candidates.",
                False,
                True,
                "CSV backs the HTML QC report and optional issue import.",
            ),
            artifact_item(
                log_dir / "scan.json",
                "support_artifact",
                "json",
                "Machine-readable extraction scan.",
                False,
                True,
                "JSON is internal extraction support.",
            ),
        ],
        blocked_or_partial_status={
            "status": "partial",
            "reason": "Text extraction is first-pass and does not replace visual review, model tie-out, or source-of-truth review.",
            "missing_inputs": [
                "Visual page-by-page review",
                "Model tie-out",
                "Source-of-truth confirmation",
            ],
        },
    )

    print(f"wrote QC scan to {outdir}")
    print(
        f"segments={len(segments)} numbers={len(numbers)} issues={len(issues)} posture={posture_from_issues(issues)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
