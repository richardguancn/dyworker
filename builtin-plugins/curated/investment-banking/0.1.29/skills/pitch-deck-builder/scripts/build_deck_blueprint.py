#!/usr/bin/env python3
"""Build a starter lower-level pitch-deck slide blueprint.

This script is intentionally source-agnostic. It does not fetch data or invent facts.
It creates a deterministic slide-construction scaffold for a selected
investment-banking deck type. Use the user-facing deck plan contract first when
storyline, page order, source posture, or open items are not yet stable.
"""

from __future__ import annotations

import argparse
import json
from datetime import date
from typing import Any

DECK_SPINES: dict[str, list[dict[str, str]]] = {
    "buyer_pitch": [
        {
            "section": "Executive summary",
            "slide_title": "[Banker thesis: why this opportunity matters now]",
            "visual": "message slide",
        },
        {
            "section": "Opportunity",
            "slide_title": "[Target / opportunity offers buyer-specific strategic fit]",
            "visual": "profile + fit matrix",
        },
        {
            "section": "Market",
            "slide_title": "[Market dynamics support action now]",
            "visual": "market map / growth chart",
        },
        {
            "section": "Financial profile",
            "slide_title": "[Financial profile supports the investment case subject to diligence]",
            "visual": "financial snapshot",
        },
        {
            "section": "Strategic fit",
            "slide_title": "[Buyer can unlock specific synergies / value creation levers]",
            "visual": "synergy bridge / matrix",
        },
        {
            "section": "Valuation",
            "slide_title": "[Valuation framework defines feasible pursuit range]",
            "visual": "football field / return sensitivity",
        },
        {
            "section": "Next steps",
            "slide_title": "[Recommended next steps to evaluate opportunity]",
            "visual": "timeline / diligence plan",
        },
    ],
    "sell_side_pitch": [
        {
            "section": "Executive summary",
            "slide_title": "[Recommended transaction strategy and why now]",
            "visual": "message slide",
        },
        {
            "section": "Situation",
            "slide_title": "[Client situation supports exploring a sale, recap, carve-out, or strategic process]",
            "visual": "situation dashboard",
        },
        {
            "section": "Market",
            "slide_title": "[Market backdrop supports an actionable transaction window]",
            "visual": "market panels",
        },
        {
            "section": "Valuation",
            "slide_title": "[Valuation context frames shareholder expectations and process design]",
            "visual": "football field",
        },
        {
            "section": "Buyer universe",
            "slide_title": "[Prioritized buyer universe supports a targeted process]",
            "visual": "buyer grid",
        },
        {
            "section": "Process",
            "slide_title": "[Process design should maximize value while managing confidentiality and execution risk]",
            "visual": "timeline",
        },
        {
            "section": "Credentials",
            "slide_title": "[Relevant experience supports mandate credibility]",
            "visual": "credential table",
        },
    ],
    "financing_pitch": [
        {
            "section": "Executive summary",
            "slide_title": "[Recommended financing path balances certainty, flexibility, and cost]",
            "visual": "message slide",
        },
        {
            "section": "Issuer profile",
            "slide_title": "[Issuer profile supports investor / lender underwriting]",
            "visual": "tearsheet",
        },
        {
            "section": "Use of proceeds",
            "slide_title": "[Financing need is tied to clear strategic objective]",
            "visual": "sources & uses",
        },
        {
            "section": "Market context",
            "slide_title": "[Market window and comparable issuance inform timing]",
            "visual": "market data panels",
        },
        {
            "section": "Structure",
            "slide_title": "[Alternative structures create different trade-offs]",
            "visual": "alternatives matrix",
        },
        {
            "section": "Execution",
            "slide_title": "[Execution plan focuses on gating diligence and market timing]",
            "visual": "timeline",
        },
    ],
    "strategic_alternatives": [
        {
            "section": "Executive summary",
            "slide_title": "[Strategic decision requires comparing value, risk, and optionality]",
            "visual": "message slide",
        },
        {
            "section": "Situation",
            "slide_title": "[Current market and company context create a decision point]",
            "visual": "situation dashboard",
        },
        {
            "section": "Objectives",
            "slide_title": "[Objectives and constraints define the right path]",
            "visual": "objective matrix",
        },
        {
            "section": "Alternatives",
            "slide_title": "[Available alternatives differ materially across value and execution risk]",
            "visual": "alternatives matrix",
        },
        {
            "section": "Financial impact",
            "slide_title": "[Financial implications should guide sequencing]",
            "visual": "scenario table",
        },
        {
            "section": "Recommendation",
            "slide_title": "[Recommended path and next steps]",
            "visual": "roadmap",
        },
    ],
    "company_profile": [
        {"section": "Profile", "slide_title": "[Company at a glance]", "visual": "tearsheet"},
        {
            "section": "Business",
            "slide_title": "[Business model and segment mix define key value drivers]",
            "visual": "segment map",
        },
        {
            "section": "Financials",
            "slide_title": "[Financial profile highlights growth, margin, and cash generation]",
            "visual": "financial table",
        },
        {
            "section": "Market",
            "slide_title": "[Market position and competitors frame strategic relevance]",
            "visual": "market map",
        },
        {
            "section": "Implications",
            "slide_title": "[Key banker observations and open questions]",
            "visual": "bullets",
        },
    ],
    "market_map": [
        {
            "section": "Thesis",
            "slide_title": "[Market structure creates a clear strategic opportunity]",
            "visual": "message slide",
        },
        {
            "section": "Landscape",
            "slide_title": "[Value chain segments reveal where value is concentrating]",
            "visual": "value chain map",
        },
        {
            "section": "Competitors",
            "slide_title": "[Competitive set should be prioritized by strategic relevance, not just logos]",
            "visual": "2x2 / logo map",
        },
        {
            "section": "Transactions",
            "slide_title": "[Recent activity shows which assets and themes are attracting capital]",
            "visual": "transaction table",
        },
        {
            "section": "Implications",
            "slide_title": "[Client-specific implications and recommended next steps]",
            "visual": "matrix",
        },
    ],
    "board_client_meeting": [
        {
            "section": "Executive summary",
            "slide_title": "[Decision required and recommended path for this meeting]",
            "visual": "message slide",
        },
        {
            "section": "Agenda",
            "slide_title": "[Discussion should focus on the decision, trade-offs, and gating items]",
            "visual": "agenda / decision map",
        },
        {
            "section": "Situation update",
            "slide_title": "[Latest facts create a defined decision point]",
            "visual": "situation dashboard",
        },
        {
            "section": "Analysis summary",
            "slide_title": "[Key analyses support the recommended discussion path]",
            "visual": "summary matrix",
        },
        {
            "section": "Alternatives",
            "slide_title": "[Available alternatives differ across value, risk, timing, and certainty]",
            "visual": "alternatives matrix",
        },
        {
            "section": "Risks and open items",
            "slide_title": "[Critical risks and open items should drive follow-up work]",
            "visual": "risk register",
        },
        {
            "section": "Next steps",
            "slide_title": "[Recommended owners, timeline, and decisions after the meeting]",
            "visual": "timeline / action tracker",
        },
    ],
}


def build_blueprint(deck_type: str, entity: str, audience: str, objective: str) -> dict[str, Any]:
    if deck_type not in DECK_SPINES:
        raise ValueError(
            f"Unsupported deck_type: {deck_type}. Choose one of {', '.join(sorted(DECK_SPINES))}"
        )
    slides = []
    for idx, item in enumerate(DECK_SPINES[deck_type], 1):
        slides.append(
            {
                "slide_number": idx,
                "section": item["section"],
                "slide_title": item["slide_title"],
                "executive_takeaway": "To be drafted from sourced context.",
                "slide_purpose": "Support the deck objective with a banker-grade, evidence-backed argument.",
                "recommended_visual": item["visual"],
                "content_blocks": [],
                "data_needed": [
                    "confirm controlling sources",
                    "add cited metrics",
                    "add client-specific implication",
                ],
                "sources": [],
                "risks_or_caveats": ["placeholder until source-backed"],
                "status": "placeholder",
                "handoffs": [],
            }
        )
    return {
        "deck_type": deck_type,
        "audience": audience or "unknown",
        "objective": objective or "unknown",
        "entity": entity or "unknown",
        "prepared_date": date.today().isoformat(),
        "source_confidence": "low",
        "banker_thesis": "Not enough context yet. Draft the banker thesis after sources and client objective are confirmed.",
        "slides": slides,
        "source_register": [],
        "assumptions": [],
        "conflicts": [],
        "open_questions": [
            "Confirm target company / client / issuer / buyer universe.",
            "Confirm audience and decision the deck should drive.",
            "Provide controlling source materials, model, template, and preferred style guide.",
        ],
    }


def to_markdown(blueprint: dict[str, Any]) -> str:
    lines = [
        "# Pitch Deck Slide Blueprint",
        f"Deck type: {blueprint['deck_type']} | Entity: {blueprint['entity']} | Audience: {blueprint['audience']}",
        f"Objective: {blueprint['objective']}",
        f"Prepared: {blueprint['prepared_date']} | Source confidence: {blueprint['source_confidence']}",
        "",
        "## Banker thesis",
        blueprint["banker_thesis"],
        "",
        "## Recommended slide spine",
        "| # | Section | Action title | Visual | Status |",
        "|---:|---|---|---|---|",
    ]
    for slide in blueprint["slides"]:
        lines.append(
            f"| {slide['slide_number']} | {slide['section']} | {slide['slide_title']} | {slide['recommended_visual']} | {slide['status']} |"
        )
    lines += [
        "",
        "## Open questions",
    ]
    for q in blueprint["open_questions"]:
        lines.append(f"- {q}")
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Build a starter lower-level investment banking pitch deck slide blueprint. "
            "For user-facing page plans, use the deck-plan contract first."
        )
    )
    parser.add_argument("--deck-type", required=True, choices=sorted(DECK_SPINES))
    parser.add_argument("--entity", default="")
    parser.add_argument("--audience", default="")
    parser.add_argument("--objective", default="")
    parser.add_argument("--format", choices=["json", "markdown"], default="markdown")
    args = parser.parse_args()
    blueprint = build_blueprint(args.deck_type, args.entity, args.audience, args.objective)
    if args.format == "json":
        print(json.dumps(blueprint, indent=2))
    else:
        print(to_markdown(blueprint))


if __name__ == "__main__":
    main()
