#!/usr/bin/env python3
"""Convert structured deck plan JSON into a markdown storyboard."""

import json
import sys
from pathlib import Path


def bullet_list(items):
    if not items:
        return "- none"
    return "\n".join(f"- {item}" for item in items)


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: build_deck_storyboard.py <deck_plan.json> <output.md>", file=sys.stderr)
        return 2

    data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    out_path = Path(sys.argv[2])
    meta = data.get("deck_metadata", {})
    story = data.get("md_storyline", {})

    lines = []
    lines.append(f"# {meta.get('client_or_subject', 'Unknown')} Pitch Deck Storyboard")
    lines.append("")
    lines.append(
        f"Prepared: {meta.get('prepared_date', 'unknown')} | Deck type: {meta.get('deck_type', 'unknown')} | Audience: {meta.get('audience', 'unknown')} | Source confidence: {meta.get('source_confidence', 'unknown')}"
    )
    lines.append("")
    lines.append("## MD-level storyline")
    lines.append("")
    lines.append(f"**Recommended action:** {story.get('recommended_action', 'unknown')}")
    lines.append(f"**Why now:** {story.get('why_now', 'unknown')}")
    lines.append("")
    lines.append("**Proof pillars:**")
    lines.append(bullet_list(story.get("proof_pillars", [])))
    lines.append("")
    lines.append("**Key risks / objections:**")
    lines.append(bullet_list(story.get("key_risks_or_objections", [])))
    lines.append("")
    lines.append("## Proposed deck architecture")
    lines.append("")
    lines.append("| # | Slide title | Purpose | Visual | Evidence status |")
    lines.append("|---:|---|---|---|---|")
    for slide in data.get("slides", []):
        lines.append(
            f"| {slide.get('slide_number', '')} | {slide.get('slide_title', '')} | {slide.get('slide_purpose', '')} | {slide.get('recommended_visual', '')} | {slide.get('evidence_status', '')} |"
        )
    lines.append("")
    lines.append("## Slide-by-slide draft")
    for slide in data.get("slides", []):
        lines.append("")
        lines.append(f"### {slide.get('slide_number', '')}. {slide.get('slide_title', '')}")
        lines.append(f"**Key message:** {slide.get('key_message', '')}")
        lines.append(f"**Recommended visual:** {slide.get('recommended_visual', '')}")
        lines.append("")
        lines.append("**Content blocks:**")
        lines.append(bullet_list(slide.get("content_blocks", [])))
        lines.append("")
        if slide.get("metrics"):
            lines.append("**Metrics:**")
            for metric in slide.get("metrics", []):
                lines.append(
                    f"- {metric.get('metric', '')}: {metric.get('value', '')} ({metric.get('period', 'unknown period')}; source: {metric.get('source_id', 'unknown')}; label: {metric.get('evidence_label', 'unknown')})"
                )
            lines.append("")
        lines.append(f"**Speaker notes:** {slide.get('speaker_notes', '')}")
        lines.append(
            f"**Footnotes:** {', '.join(slide.get('footnotes', [])) if slide.get('footnotes') else 'none'}"
        )
        lines.append(
            f"**Open items:** {', '.join(slide.get('open_items', [])) if slide.get('open_items') else 'none'}"
        )
    lines.append("")
    lines.append("## Source register")
    lines.append("")
    lines.append("| ID | Source | Type | Date | Freshness | Confidence | Supports |")
    lines.append("|---|---|---|---|---|---|---|")
    for source in data.get("sources", []):
        lines.append(
            f"| {source.get('source_id', '')} | {source.get('name', '')} | {source.get('type', '')} | {source.get('document_date', '')} | {source.get('freshness', '')} | {source.get('confidence', '')} | {', '.join(source.get('supports', []))} |"
        )

    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
