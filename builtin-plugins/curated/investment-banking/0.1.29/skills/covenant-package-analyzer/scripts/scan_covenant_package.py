#!/usr/bin/env python3
"""First-pass covenant package scanner.

Scans text-like credit documents for covenant, EBITDA definition, basket, leakage,
collateral, amendment, and default terms. This is a triage aid only; it does not
replace source review or legal analysis.

Supported input: .txt, .md, .html, .htm, .csv, .json, .docx
PDFs should be converted to text first with the PDF workflow.

Usage:
  python scripts/scan_covenant_package.py file1.docx file2.html --outdir output/covenant_scan
"""

from __future__ import annotations

import argparse
import csv
import html
import re
import sys
import zipfile
from dataclasses import dataclass
from html import escape
from pathlib import Path
from typing import Iterable
from xml.etree import ElementTree as ET

PLUGIN_ROOT = Path(__file__).resolve().parents[3]
if str(PLUGIN_ROOT) not in sys.path:
    sys.path.insert(0, str(PLUGIN_ROOT))

from shared.artifacts import (  # noqa: E402
    artifact_item,
    support_dir,
    write_artifact_manifest,
)


@dataclass
class PatternSpec:
    section_type: str
    term: str
    pattern: str
    severity: str
    why: str
    route: str = "covenant-package-analyzer"


PATTERNS: list[PatternSpec] = [
    PatternSpec(
        "definition",
        "Consolidated EBITDA",
        r"consolidated\s+ebitda|adjusted\s+ebitda|covenant\s+ebitda",
        "High",
        "EBITDA definition drives leverage, baskets, and covenant compliance",
        "financials-normalizer",
    ),
    PatternSpec(
        "definition",
        "Consolidated Net Income",
        r"consolidated\s+net\s+income",
        "Medium",
        "Starting point for EBITDA and builder baskets",
    ),
    PatternSpec(
        "definition",
        "Pro Forma Basis",
        r"pro\s+forma\s+basis|pro\s+forma\s+effect|pro\s+forma\s+compliance",
        "High",
        "Can expand debt capacity and covenant compliance",
    ),
    PatternSpec(
        "definition",
        "Run-rate savings / synergies",
        r"run[-\s]?rate|cost\s+savings|synerg(?:y|ies)|reasonably\s+identifiable|factually\s+supportable",
        "High",
        "May inflate covenant EBITDA beyond lender/source-supported EBITDA",
        "financials-normalizer",
    ),
    PatternSpec(
        "definition",
        "Cash netting",
        r"unrestricted\s+cash|cash\s+netting|net\s+debt|cash\s+cap",
        "Medium",
        "Cash netting changes leverage ratio headroom",
    ),
    PatternSpec(
        "financial_covenant",
        "Maximum leverage",
        r"maximum\s+(total|secured|first\s+lien|net)?\s*leverage|max(?:imum)?\s+leverage|total\s+leverage\s+ratio|net\s+leverage\s+ratio",
        "High",
        "Core maintenance or incurrence covenant",
        "private-credit-underwriting",
    ),
    PatternSpec(
        "financial_covenant",
        "Coverage covenant",
        r"interest\s+coverage|fixed\s+charge\s+coverage|debt\s+service\s+coverage|minimum\s+coverage",
        "High",
        "Coverage covenant may drive default risk",
        "private-credit-underwriting",
    ),
    PatternSpec(
        "financial_covenant",
        "Minimum liquidity",
        r"minimum\s+liquidity|min(?:imum)?\s+liquidity|liquidity\s+covenant",
        "High",
        "Liquidity covenant may breach before leverage",
        "private-credit-underwriting",
    ),
    PatternSpec(
        "financial_covenant",
        "Springing covenant",
        r"springing|tested\s+only\s+if|availability\s+is\s+less\s+than|excess\s+availability",
        "High",
        "Springing tests depend on availability or usage thresholds",
        "private-credit-underwriting",
    ),
    PatternSpec(
        "cure",
        "Equity cure",
        r"equity\s+cure|cure\s+amount|cure\s+right|cure\s+period",
        "Medium",
        "Cure mechanics can mask covenant pressure",
    ),
    PatternSpec(
        "debt",
        "Incremental debt",
        r"incremental\s+(facility|facilities|debt|loans)|accordion",
        "High",
        "May permit additional debt under ratio or free-and-clear capacity",
        "lbo-model-build",
    ),
    PatternSpec(
        "debt",
        "Ratio debt",
        r"ratio\s+debt|incur\s+indebtedness.*ratio|pro\s+forma.*leverage.*debt",
        "High",
        "Potential debt capacity tied to permissive EBITDA definition",
        "lbo-model-build",
    ),
    PatternSpec(
        "debt",
        "MFN",
        r"most\s+favou?r(?:ed)?\s+nation|\bMFN\b|yield\s+protection",
        "Medium",
        "Protects against cheaper incremental debt",
    ),
    PatternSpec(
        "liens",
        "Liens",
        r"permitted\s+liens|liens\s+covenant|security\s+interest|pledge",
        "Medium",
        "Controls collateral priming and lien leakage",
    ),
    PatternSpec(
        "restricted_payments",
        "Restricted payments",
        r"restricted\s+payments|dividends|distributions|equity\s+repurchases|junior\s+debt\s+payment",
        "High",
        "Controls cash leakage to equity or junior creditors",
    ),
    PatternSpec(
        "investments",
        "Investments",
        r"permitted\s+investments|investments\s+covenant|joint\s+venture|non[-\s]?loan\s+party",
        "High",
        "Can move value to non-guarantors, JVs, or unrestricted subsidiaries",
    ),
    PatternSpec(
        "asset_sales",
        "Asset sales",
        r"asset\s+sale|disposition|sale\s+of\s+assets|reinvestment\s+period|net\s+cash\s+proceeds",
        "Medium",
        "Controls collateral sale proceeds and reinvestment leakage",
    ),
    PatternSpec(
        "unrestricted_subs",
        "Unrestricted subsidiaries",
        r"unrestricted\s+subsidiar(?:y|ies)|designat(?:e|ion).*subsidiar|restricted\s+subsidiar(?:y|ies)",
        "High",
        "Unrestricted sub mechanics are a major leakage path",
    ),
    PatternSpec(
        "ip_leakage",
        "IP / material asset transfer",
        r"intellectual\s+property|\bIP\b|material\s+assets|exclusive\s+license|contribution\s+of\s+assets",
        "High",
        "Material assets or IP can be moved outside collateral package",
    ),
    PatternSpec(
        "basket",
        "Available amount / builder basket",
        r"available\s+amount|builder\s+basket|cumulative\s+credit|retained\s+excess\s+cash\s+flow",
        "High",
        "Can fund RPs, investments, and debt prepayments",
    ),
    PatternSpec(
        "basket",
        "Grower basket",
        r"greater\s+of|lesser\s+of|\%\s+of\s+(?:consolidated\s+)?ebitda|percentage\s+of\s+total\s+assets",
        "Medium",
        "Capacity may grow with EBITDA or assets",
    ),
    PatternSpec(
        "basket",
        "Reclassification",
        r"reclassif(?:y|ication)|deemed\s+to\s+have\s+been\s+incurred",
        "High",
        "Can obscure basket usage and refresh capacity",
    ),
    PatternSpec(
        "collateral",
        "Excluded assets",
        r"excluded\s+assets|excluded\s+property|excluded\s+collateral",
        "High",
        "Excluded collateral may reduce recovery or protection",
    ),
    PatternSpec(
        "collateral",
        "Excluded subsidiaries",
        r"excluded\s+subsidiar(?:y|ies)|non[-\s]?guarantor|foreign\s+subsidiar",
        "High",
        "Non-guarantor debt or assets can structurally subordinate lenders",
    ),
    PatternSpec(
        "reporting",
        "Reporting obligations",
        r"financial\s+statements|compliance\s+certificate|covenant\s+certificate|budget|monthly\s+report",
        "Medium",
        "Reporting drives monitoring and early warning",
    ),
    PatternSpec(
        "default",
        "Events of default",
        r"events?\s+of\s+default|cross[-\s]?default|cross[-\s]?acceleration|material\s+adverse\s+effect",
        "High",
        "Defines acceleration rights and early remedies",
    ),
    PatternSpec(
        "amendment",
        "Amendments and waivers",
        r"amendments?|waivers?|required\s+lenders|majority\s+lenders|sacred\s+rights|pro\s+rata",
        "Medium",
        "Voting mechanics influence lender control and uptier risk",
    ),
    PatternSpec(
        "change_control",
        "Change of control",
        r"change\s+of\s+control",
        "Medium",
        "May trigger mandatory prepayment or default",
    ),
]

STRIP_TAG_RE = re.compile(r"<[^>]+>")
WHITESPACE_RE = re.compile(r"\s+")


def clean_text(text: str) -> str:
    text = html.unescape(text)
    text = text.replace("\xa0", " ")
    text = WHITESPACE_RE.sub(" ", text)
    return text.strip()


def read_docx(path: Path) -> str:
    with zipfile.ZipFile(path) as z:
        xml = z.read("word/document.xml")
    root = ET.fromstring(xml)
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    paras: list[str] = []
    for p in root.findall(".//w:p", ns):
        parts: list[str] = []
        for t in p.findall(".//w:t", ns):
            if t.text:
                parts.append(t.text)
        if parts:
            paras.append("".join(parts))
    return "\n".join(paras)


def read_text(path: Path) -> tuple[str, str]:
    suffix = path.suffix.lower()
    try:
        if suffix == ".docx":
            return read_docx(path), "docx"
        if suffix in {".txt", ".md", ".csv", ".json"}:
            return path.read_text(encoding="utf-8", errors="ignore"), suffix.lstrip(".")
        if suffix in {".html", ".htm"}:
            raw = path.read_text(encoding="utf-8", errors="ignore")
            return STRIP_TAG_RE.sub(" ", raw), "html"
        if suffix == ".pdf":
            return "", "pdf_unreadable"
        return path.read_text(encoding="utf-8", errors="ignore"), suffix.lstrip(".") or "unknown"
    except Exception as exc:  # pragma: no cover - defensive CLI behavior
        return f"[READ_ERROR] {exc}", "read_error"


def iter_chunks(text: str, max_len: int = 600) -> Iterable[tuple[int, str]]:
    lines = [clean_text(x) for x in re.split(r"[\r\n]+", text) if clean_text(x)]
    if not lines:
        # fallback to sentence-ish chunks
        lines = [clean_text(x) for x in re.split(r"(?<=[.;:])\s+", text) if clean_text(x)]
    for idx, line in enumerate(lines, start=1):
        if len(line) <= max_len:
            yield idx, line
        else:
            for j in range(0, len(line), max_len):
                yield idx, line[j : j + max_len]


def scan_file(
    path: Path, source_id: str
) -> tuple[dict[str, str], list[dict[str, str]], list[dict[str, str]]]:
    text, file_type = read_text(path)
    source_row = {
        "source_id": source_id,
        "file": str(path),
        "file_type": file_type,
        "readable": "no" if file_type in {"pdf_unreadable", "read_error"} else "yes",
        "notes": "extract PDF text or OCR first" if file_type == "pdf_unreadable" else "",
    }
    terms: list[dict[str, str]] = []
    issues: list[dict[str, str]] = []
    if not text or file_type in {"pdf_unreadable", "read_error"}:
        if file_type == "pdf_unreadable":
            issues.append(
                {
                    "issue_id": f"{source_id}-PDF",
                    "severity": "Question",
                    "issue_type": "extraction",
                    "location": str(path),
                    "issue": "PDF was not parsed by this script",
                    "why_it_matters": "Covenant terms may be in the PDF and need text extraction before analysis",
                    "suggested_review": "Extract PDF text or OCR with available document tooling, then rerun this scanner on the extracted text",
                    "routed_skill": "document-extraction-required",
                }
            )
        return source_row, terms, issues

    for line_no, chunk in iter_chunks(text):
        low = chunk.lower()
        matched_specs: list[PatternSpec] = []
        for spec in PATTERNS:
            if re.search(spec.pattern, low, flags=re.IGNORECASE):
                matched_specs.append(spec)
        for spec in matched_specs:
            terms.append(
                {
                    "source_id": source_id,
                    "file": path.name,
                    "line_or_chunk": str(line_no),
                    "section_type": spec.section_type,
                    "term": spec.term,
                    "severity_hint": spec.severity,
                    "excerpt": chunk[:500],
                }
            )
        # Escalate high-risk issue candidates when certain terms co-occur.
        high_terms = [s for s in matched_specs if s.severity == "High"]
        if high_terms:
            unique_terms = "; ".join(sorted({s.term for s in high_terms}))
            routes = "; ".join(sorted({s.route for s in high_terms}))
            issues.append(
                {
                    "issue_id": f"{source_id}-{line_no}",
                    "severity": "High",
                    "issue_type": "candidate_clause",
                    "location": f"{path.name}:chunk {line_no}",
                    "issue": f"Potential high-risk covenant term(s): {unique_terms}",
                    "why_it_matters": "; ".join(sorted({s.why for s in high_terms}))[:500],
                    "suggested_review": "Read the full clause, extract exact definition/basket/condition, and confirm with operative amendments",
                    "routed_skill": routes,
                }
            )
    return source_row, terms, issues


def write_csv(path: Path, rows: list[dict[str, str]], headers: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writeheader()
        for row in rows:
            writer.writerow({h: row.get(h, "") for h in headers})


def _table(rows: list[dict[str, str]], columns: list[tuple[str, str]], empty_message: str) -> str:
    if not rows:
        return f'<p class="empty">{escape(empty_message)}</p>'
    headers = "".join(f"<th>{escape(label)}</th>" for _, label in columns)
    body = "".join(
        "<tr>" + "".join(f"<td>{escape(row.get(key, ''))}</td>" for key, _ in columns) + "</tr>"
        for row in rows
    )
    return f"<table><thead><tr>{headers}</tr></thead><tbody>{body}</tbody></table>"


def write_report(
    outdir: Path,
    source_rows: list[dict[str, str]],
    terms: list[dict[str, str]],
    issues: list[dict[str, str]],
) -> Path:
    by_type: dict[str, int] = {}
    for row in terms:
        by_type[row["section_type"]] = by_type.get(row["section_type"], 0) + 1
    high_count = sum(1 for i in issues if i.get("severity") == "High")
    source_display = [
        {
            **row,
            "file": Path(row["file"]).name,
        }
        for row in source_rows
    ]
    type_summary = "".join(
        f"<li><strong>{escape(key.replace('_', ' ').title())}</strong><span>{count}</span></li>"
        for key, count in sorted(by_type.items())
    )
    issue_table = _table(
        issues[:25],
        [
            ("severity", "Severity"),
            ("location", "Location"),
            ("issue", "Issue candidate"),
            ("suggested_review", "Required review"),
        ],
        "No issue candidates were detected in the readable source set.",
    )
    terms_table = _table(
        terms[:40],
        [
            ("source_id", "Source"),
            ("section_type", "Type"),
            ("term", "Term"),
            ("severity_hint", "Risk"),
            ("excerpt", "Excerpt"),
        ],
        "No covenant term hits were identified.",
    )
    source_table = _table(
        source_display,
        [
            ("source_id", "ID"),
            ("file", "Document"),
            ("file_type", "Type"),
            ("readable", "Readable"),
            ("notes", "Notes"),
        ],
        "No documents were scanned.",
    )
    path = outdir / "covenant_analysis_report.html"
    path.write_text(
        f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Covenant Package Scan Review</title>
  <style>
    :root {{ --paper:#faf8f3; --ink:#14221f; --forest:#18473c; --muted:#53635e; --rule:#dbd5ca; --warn:#a34734; --soft:#f3ece2; }}
    * {{ box-sizing:border-box; }}
    body {{ margin:0; background:var(--paper); color:var(--ink); font:15px/1.5 Arial, sans-serif; }}
    header, main, footer {{ max-width:1160px; margin:0 auto; padding-left:38px; padding-right:38px; }}
    header {{ padding-top:48px; padding-bottom:34px; border-bottom:1px solid var(--rule); }}
    .eyebrow {{ font-size:11px; font-weight:700; letter-spacing:.17em; text-transform:uppercase; color:var(--forest); }}
    h1 {{ margin:15px 0 13px; max-width:820px; font:normal 54px/1.08 Georgia, serif; }}
    .dek {{ margin:0; max-width:820px; color:var(--muted); font-size:19px; }}
    .posture {{ margin:28px 0 0; padding:15px 18px; border-left:4px solid var(--warn); background:#f2e5df; color:#71382e; font-weight:700; }}
    main {{ padding-top:34px; padding-bottom:54px; }}
    .metrics {{ display:grid; grid-template-columns:repeat(3, 1fr); gap:14px; margin-bottom:40px; }}
    .metric {{ border:1px solid var(--rule); background:#fffdf9; padding:18px; }}
    .metric span {{ display:block; text-transform:uppercase; letter-spacing:.12em; color:var(--muted); font-size:10px; font-weight:700; }}
    .metric strong {{ display:block; margin-top:7px; font:normal 32px Georgia, serif; color:var(--forest); }}
    section {{ margin:42px 0; }}
    .section-label {{ font-size:11px; font-weight:700; letter-spacing:.15em; text-transform:uppercase; color:var(--forest); }}
    h2 {{ margin:10px 0 12px; font:normal 32px Georgia, serif; }}
    .intro {{ margin:0 0 20px; max-width:880px; color:var(--muted); }}
    table {{ width:100%; border-collapse:collapse; font-size:13.5px; }}
    th {{ background:var(--forest); color:#fff; text-align:left; padding:11px 12px; text-transform:uppercase; letter-spacing:.07em; font-size:10.5px; }}
    td {{ padding:12px; border-bottom:1px solid var(--rule); vertical-align:top; }}
    tbody tr:nth-child(even) {{ background:#f4f0e8; }}
    .term-types {{ display:flex; flex-wrap:wrap; gap:10px; list-style:none; padding:0; margin:16px 0 0; }}
    .term-types li {{ min-width:160px; border:1px solid var(--rule); background:#fffdf9; padding:9px 12px; display:flex; justify-content:space-between; gap:18px; }}
    .empty {{ color:var(--muted); font-style:italic; }}
    ol {{ color:var(--muted); line-height:1.7; }}
    footer {{ border-top:1px solid var(--rule); padding-top:20px; padding-bottom:32px; color:var(--muted); font-size:12px; }}
    @media (max-width:760px) {{ header, main, footer {{ padding-left:20px; padding-right:20px; }} .metrics {{ grid-template-columns:1fr; }} h1 {{ font-size:40px; }} table {{ display:block; overflow-x:auto; }} }}
  </style>
</head>
<body>
  <header>
    <div class="eyebrow">Finance-Side Covenant Review | Initial Document Scan</div>
    <h1>Covenant Package Scan Review</h1>
    <p class="dek">A first-pass identification of covenant terms and issue candidates for operative-document review, headroom diligence, and finance-side follow-up.</p>
    <div class="posture">Screening-only: extracted term hits do not establish covenant compliance, headroom, basket capacity, or legal interpretation.</div>
  </header>
  <main>
    <div class="metrics">
      <div class="metric"><span>Documents scanned</span><strong>{len(source_rows)}</strong></div>
      <div class="metric"><span>Term hits</span><strong>{len(terms)}</strong></div>
      <div class="metric"><span>High-risk candidates</span><strong>{high_count}</strong></div>
    </div>
    <section>
      <div class="section-label">01 | What requires review</div>
      <h2>Issue candidates</h2>
      <p class="intro">Read each candidate against the full operative clause and all amendments or waivers before making a credit or compliance conclusion.</p>
      {issue_table}
    </section>
    <section>
      <div class="section-label">02 | Detected provisions</div>
      <h2>Term extraction</h2>
      <p class="intro">Detected term families help prioritize review; excerpts are triage evidence rather than conformed-document conclusions.</p>
      <ul class="term-types">{type_summary}</ul>
      {terms_table}
    </section>
    <section>
      <div class="section-label">03 | Source base</div>
      <h2>Documents scanned</h2>
      {source_table}
    </section>
    <section>
      <div class="section-label">04 | Reliance path</div>
      <h2>Required next steps</h2>
      <ol>
        <li>Review high-severity excerpts against full operative provisions.</li>
        <li>Layer amendments and waivers onto the original agreement.</li>
        <li>Extract exact definitions, baskets, thresholds, triggers and conditions into a covenant memo.</li>
        <li>Compute headroom only after required financial inputs and covenant certificates are supported.</li>
      </ol>
    </section>
  </main>
  <footer>Prepared by covenant-package-analyzer as a finance-side screening report. Not legal advice and not a compliance certificate.</footer>
</body>
</html>
""",
        encoding="utf-8",
    )
    return path


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Scan covenant package documents for terms and issue candidates."
    )
    parser.add_argument("inputs", nargs="+", help="Input files or directories")
    parser.add_argument("--outdir", default="output/covenant_scan", help="Output directory")
    args = parser.parse_args()

    paths: list[Path] = []
    for item in args.inputs:
        p = Path(item)
        if p.is_dir():
            paths.extend(x for x in p.rglob("*") if x.is_file())
        elif p.is_file():
            paths.append(p)
        else:
            print(f"[WARN] Not found: {p}", file=sys.stderr)

    if not paths:
        print("[ERROR] No readable input files found", file=sys.stderr)
        return 2

    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    source_rows: list[dict[str, str]] = []
    terms: list[dict[str, str]] = []
    issues: list[dict[str, str]] = []
    for idx, path in enumerate(paths, start=1):
        source_id = f"S{idx:03d}"
        srow, trows, irows = scan_file(path, source_id)
        source_rows.append(srow)
        terms.extend(trows)
        issues.extend(irows)

    csv_dir = support_dir(outdir)
    write_csv(
        csv_dir / "source_index.csv",
        source_rows,
        ["source_id", "file", "file_type", "readable", "notes"],
    )
    write_csv(
        csv_dir / "extracted_terms.csv",
        terms,
        ["source_id", "file", "line_or_chunk", "section_type", "term", "severity_hint", "excerpt"],
    )
    write_csv(
        csv_dir / "issue_candidates.csv",
        issues,
        [
            "issue_id",
            "severity",
            "issue_type",
            "location",
            "issue",
            "why_it_matters",
            "suggested_review",
            "routed_skill",
        ],
    )
    report_path = write_report(outdir, source_rows, terms, issues)
    write_artifact_manifest(
        outdir,
        "covenant-package-analyzer",
        "html_report",
        report_path,
        support_artifacts=[
            artifact_item(
                csv_dir / "source_index.csv",
                "support_artifact",
                "csv",
                "Source file inventory.",
                False,
                True,
                "CSV is scanner support.",
            ),
            artifact_item(
                csv_dir / "extracted_terms.csv",
                "support_artifact",
                "csv",
                "Extracted covenant terms.",
                False,
                True,
                "CSV backs the HTML report and calculation handoff.",
            ),
            artifact_item(
                csv_dir / "issue_candidates.csv",
                "support_artifact",
                "csv",
                "Raw issue candidates.",
                False,
                True,
                "CSV backs the HTML report and reviewer workflow.",
            ),
        ],
        blocked_or_partial_status={
            "status": "partial",
            "reason": "Scanner is first-pass and does not parse PDFs/OCR or replace legal/source review.",
            "missing_inputs": [
                "PDF/OCR extraction where applicable",
                "Operative clause review",
                "Amendment and waiver layering",
            ],
        },
    )
    print(f"[OK] Wrote standalone covenant scan report and support data to {outdir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
