#!/usr/bin/env python3
"""Create a slide index markdown table from a pitch-deck blueprint JSON."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def make_index(data: dict[str, Any]) -> str:
    lines = [
        "# Slide Index",
        f"Deck type: {data.get('deck_type', 'unknown')} | Entity: {data.get('entity', 'unknown')} | Audience: {data.get('audience', 'unknown')}",
        "",
        "| # | Section | Action title | Visual | Status |",
        "|---:|---|---|---|---|",
    ]
    for slide in data.get("slides", []):
        lines.append(
            f"| {slide.get('slide_number', '')} | {slide.get('section', '')} | {slide.get('slide_title', '')} | {slide.get('recommended_visual', '')} | {slide.get('status', '')} |"
        )
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Create a slide index from a pitch-deck blueprint JSON."
    )
    parser.add_argument("json_file", type=Path)
    args = parser.parse_args()
    data = json.loads(args.json_file.read_text(encoding="utf-8"))
    print(make_index(data))


if __name__ == "__main__":
    main()
