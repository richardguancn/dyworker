#!/usr/bin/env python3
"""Create a missing-source checklist for common tearsheet profile types."""

from __future__ import annotations

import argparse

CHECKLISTS = {
    "company": [
        "Latest annual and interim financial statements or filings",
        "Latest investor presentation or management overview",
        "Business segment and geography breakdown",
        "Current ownership/listing identifiers",
        "Recent press releases or material announcements",
        "Key operating KPIs by business model",
    ],
    "borrower": [
        "Latest LTM and annual financials",
        "Debt schedule and proposed facility terms",
        "Liquidity, cash, revolver availability, and covenant package",
        "Collateral schedules if secured or ABL",
        "Management projections and downside case",
        "QoE or adjusted EBITDA support if available",
    ],
    "issuer": [
        "Latest filing or offering memorandum",
        "Debt stack, ratings, maturities, and spread/price context",
        "Recent earnings release and transcript if public",
        "Liquidity and covenant disclosures",
        "Credit metrics and peer context",
    ],
    "fund": [
        "Fund PPM or latest fund presentation",
        "Latest AUM and performance report",
        "Track record by fund/vintage",
        "Portfolio company list and concentration",
        "Team and strategy overview",
        "Terms, fees, GP commitment, and reporting materials",
    ],
    "business-unit": [
        "Current actuals and latest forecast version",
        "Cost center/entity/product mapping",
        "Revenue, OpEx, headcount, and KPI schedules",
        "Owner notes and key initiatives",
        "Budget vs actual and forecast variance detail",
    ],
}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Print a source checklist for a tearsheet profile type"
    )
    parser.add_argument("profile_type", choices=sorted(CHECKLISTS), help="Profile type")
    args = parser.parse_args()

    print(f"# Source checklist: {args.profile_type}")
    for item in CHECKLISTS[args.profile_type]:
        print(f"- [ ] {item}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
