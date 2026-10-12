#!/usr/bin/env python3
"""Validate workbook-level model citations for Investment Banking model outputs."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from shared.model_citations import load_model_citations, validate_model_citations  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path)
    parser.add_argument("--strict", action="store_true")
    parser.add_argument(
        "--json", action="store_true", help="Emit machine-readable validation output."
    )
    args = parser.parse_args(argv)
    citations = load_model_citations(args.path)
    errors = validate_model_citations(citations, strict=args.strict)
    if args.json:
        print(
            json.dumps(
                {
                    "status": "failed" if errors else "passed",
                    "error_count": len(errors),
                    "errors": errors,
                },
                indent=2,
            )
        )
    elif errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
    else:
        print(f"OK: {len(citations)} model citations validated")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
