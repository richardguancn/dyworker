#!/usr/bin/env python3
"""Print a source request checklist for an investment-banking deck type."""

import argparse

CHECKLISTS = {
    "universal": [
        "Deck type and objective",
        "Client / subject company / target / issuer / borrower",
        "Audience and meeting date",
        "Desired length and output format",
        "Existing template or precedent deck",
        "Confidentiality or anonymization constraints",
    ],
    "buyer_pitch": [
        "Buyer name and strategic priorities",
        "Target name and available materials",
        "Known relationship context",
        "Strategic rationale hypotheses",
        "Synergy assumptions or diligence limits",
        "Expected outreach or meeting objective",
    ],
    "sell_side_pitch": [
        "Company materials and financials",
        "Ownership / sponsor context",
        "Management or shareholder objectives",
        "Expected timing and process constraints",
        "Preliminary buyer universe",
        "Bank credentials, case studies, and team pages",
    ],
    "financing_pitch": [
        "Current debt, cash, maturity schedule, and liquidity",
        "Ratings, covenants, existing lenders, and collateral",
        "Use of proceeds",
        "Forecast and downside case",
        "Client priorities: cost, dilution, flexibility, certainty, timing",
        "Market data for rates, spreads, equity valuation, and issuance",
    ],
    "strategic_alternatives": [
        "Strategic question and objectives",
        "Current financial model and forecast",
        "Management / Board constraints",
        "Alternatives to compare",
        "Valuation, capital structure, and market data",
        "Stakeholder considerations",
    ],
    "company_profile": [
        "Company identifiers and latest source materials",
        "Financials and KPIs",
        "Segments, products, geographies, and customers",
        "Ownership and capitalization",
        "Recent developments",
        "Key risks or management priorities",
    ],
    "market_map": [
        "Category definition and scope",
        "Geographies, verticals, products, or customer segments",
        "Company universe or seed list",
        "Ranking criteria",
        "Data sources for revenue, funding, ownership, growth, and transactions",
    ],
    "board_client_meeting": [
        "Meeting owner, audience, date, and decision required",
        "Current situation summary and latest materials",
        "Analyses or workstreams to synthesize",
        "Alternatives under consideration",
        "Known sensitivities, objections, and no-go points",
        "Desired next steps, owners, and timeline",
    ],
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("deck_type", choices=sorted(k for k in CHECKLISTS if k != "universal"))
    args = parser.parse_args()

    print(f"# Source request checklist: {args.deck_type}")
    print("\n## Universal")
    for item in CHECKLISTS["universal"]:
        print(f"- [ ] {item}")
    print(f"\n## {args.deck_type}")
    for item in CHECKLISTS[args.deck_type]:
        print(f"- [ ] {item}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
