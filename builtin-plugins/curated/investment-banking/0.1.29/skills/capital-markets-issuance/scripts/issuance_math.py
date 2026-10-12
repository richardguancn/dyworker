#!/usr/bin/env python3
"""Capital markets issuance math helper.

Reads a JSON input file and returns a JSON output with deterministic tie-out math for
basic equity, debt, or convertible issuance analysis. This script intentionally avoids
market data calls; all inputs must be provided and source-checked by the analyst/agent.

Example:
  python scripts/issuance_math.py --mode equity --input equity_inputs.json
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

PLUGIN_ROOT = Path(__file__).resolve().parents[3]
if str(PLUGIN_ROOT) not in sys.path:
    sys.path.insert(0, str(PLUGIN_ROOT))

from shared.artifacts import (  # noqa: E402
    artifact_item,
    build_minimal_handoff_payload,
    dict_rows_to_sheet,
    handoff_artifact_item,
    support_dir,
    write_artifact_manifest,
    write_cover_first_workbook,
    write_handoff_payload,
)


def _num(
    data: dict[str, Any], key: str, default: float | None = None, required: bool = False
) -> float | None:
    value = data.get(key, default)
    if value is None:
        if required:
            raise ValueError(f"missing required numeric input: {key}")
        return None
    try:
        value = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"input {key} must be numeric") from exc
    if math.isnan(value) or math.isinf(value):
        raise ValueError(f"input {key} must be finite")
    return value


def _pct(value: float | None) -> float | None:
    if value is None:
        return None
    return value / 100.0


def _safe_div(numerator: float | None, denominator: float | None) -> float | None:
    if numerator is None or denominator is None or denominator == 0:
        return None
    return numerator / denominator


def _round(value: Any, digits: int = 4) -> Any:
    if isinstance(value, float):
        return round(value, digits)
    if isinstance(value, dict):
        return {k: _round(v, digits) for k, v in value.items()}
    if isinstance(value, list):
        return [_round(v, digits) for v in value]
    return value


def equity_math(data: dict[str, Any]) -> dict[str, Any]:
    current_share_price = _num(data, "current_share_price", required=True)
    gross_proceeds = _num(data, "gross_proceeds", required=True)
    existing_basic_shares = _num(data, "existing_basic_shares", required=True)
    fee_pct = _pct(_num(data, "fee_pct", 0.0)) or 0.0
    discount_pct = _pct(_num(data, "discount_pct"))
    offer_price = _num(data, "offer_price")
    if offer_price is None:
        offer_price = current_share_price * (1 - (discount_pct or 0.0))
    if offer_price <= 0:
        raise ValueError("offer_price must be greater than zero")

    primary_proceeds = _num(data, "primary_proceeds", gross_proceeds) or 0.0
    secondary_proceeds = (
        _num(data, "secondary_proceeds", max(gross_proceeds - primary_proceeds, 0.0)) or 0.0
    )
    free_float_shares = _num(data, "free_float_shares")
    adv_shares = _num(data, "adv_shares")

    primary_shares_issued = primary_proceeds / offer_price
    secondary_shares_sold = secondary_proceeds / offer_price
    total_shares_placed = primary_shares_issued + secondary_shares_sold
    pro_forma_basic_shares = existing_basic_shares + primary_shares_issued
    net_primary_proceeds = primary_proceeds * (1 - fee_pct)
    market_cap_pre = existing_basic_shares * current_share_price

    return {
        "mode": "equity",
        "inputs_used": {
            "current_share_price": current_share_price,
            "offer_price": offer_price,
            "gross_proceeds": gross_proceeds,
            "primary_proceeds": primary_proceeds,
            "secondary_proceeds": secondary_proceeds,
            "fee_pct": fee_pct * 100,
        },
        "outputs": {
            "implied_discount_pct": _safe_div(
                current_share_price - offer_price, current_share_price
            )
            * 100,
            "primary_shares_issued": primary_shares_issued,
            "secondary_shares_sold": secondary_shares_sold,
            "total_shares_placed": total_shares_placed,
            "pro_forma_basic_shares": pro_forma_basic_shares,
            "net_primary_proceeds": net_primary_proceeds,
            "primary_dilution_pct_of_pro_forma": _safe_div(
                primary_shares_issued, pro_forma_basic_shares
            )
            * 100,
            "deal_size_pct_of_market_cap": _safe_div(gross_proceeds, market_cap_pre) * 100,
            "shares_placed_pct_of_free_float": None
            if free_float_shares is None
            else _safe_div(total_shares_placed, free_float_shares) * 100,
            "shares_placed_days_of_adv": None
            if adv_shares is None
            else _safe_div(total_shares_placed, adv_shares),
        },
        "notes": [
            "equity math uses basic shares unless diluted share count is supplied separately by the analyst",
            "market-cap and liquidity metrics should be refreshed before live launch",
        ],
    }


def debt_math(data: dict[str, Any]) -> dict[str, Any]:
    existing_debt = _num(data, "existing_debt", required=True)
    cash = _num(data, "cash", 0.0) or 0.0
    ebitda = _num(data, "ebitda")
    ebit = _num(data, "ebit")
    existing_interest_expense = _num(data, "existing_interest_expense", 0.0) or 0.0
    new_debt_amount = _num(data, "new_debt_amount", required=True)
    debt_repaid = _num(data, "debt_repaid", 0.0) or 0.0
    fee_pct = _pct(_num(data, "fee_pct", 0.0)) or 0.0
    coupon_pct = _pct(_num(data, "coupon_pct"))
    benchmark_rate_pct = _pct(_num(data, "benchmark_rate_pct"))
    spread_bps = _num(data, "spread_bps")
    if coupon_pct is None:
        if benchmark_rate_pct is not None and spread_bps is not None:
            coupon_pct = benchmark_rate_pct + spread_bps / 10000.0
        else:
            raise ValueError("provide coupon_pct, or both benchmark_rate_pct and spread_bps")
    refinanced_debt_coupon_pct = _pct(_num(data, "refinanced_debt_coupon_pct", 0.0)) or 0.0

    fees = new_debt_amount * fee_pct
    net_new_proceeds = new_debt_amount - fees
    pro_forma_cash = cash + net_new_proceeds - debt_repaid
    pro_forma_gross_debt = existing_debt + new_debt_amount - debt_repaid
    pro_forma_net_debt = pro_forma_gross_debt - pro_forma_cash
    new_interest = new_debt_amount * coupon_pct
    interest_saved = debt_repaid * refinanced_debt_coupon_pct
    pro_forma_interest_expense = existing_interest_expense - interest_saved + new_interest

    return {
        "mode": "debt",
        "inputs_used": {
            "existing_debt": existing_debt,
            "cash": cash,
            "new_debt_amount": new_debt_amount,
            "debt_repaid": debt_repaid,
            "coupon_pct": coupon_pct * 100,
            "fee_pct": fee_pct * 100,
        },
        "outputs": {
            "fees": fees,
            "net_new_proceeds": net_new_proceeds,
            "pro_forma_cash": pro_forma_cash,
            "pro_forma_gross_debt": pro_forma_gross_debt,
            "pro_forma_net_debt": pro_forma_net_debt,
            "new_annual_interest": new_interest,
            "interest_saved_on_repaid_debt": interest_saved,
            "pro_forma_interest_expense": pro_forma_interest_expense,
            "gross_leverage_x": _safe_div(pro_forma_gross_debt, ebitda),
            "net_leverage_x": _safe_div(pro_forma_net_debt, ebitda),
            "ebitda_interest_coverage_x": _safe_div(ebitda, pro_forma_interest_expense),
            "ebit_interest_coverage_x": _safe_div(ebit, pro_forma_interest_expense),
        },
        "notes": [
            "covenant and rating metrics may use issuer-specific definitions and must be verified against documents/methodology",
            "cash balance assumes net new proceeds less debt repaid; adjust for escrow, tender premiums, make-whole, taxes, and transaction fees if applicable",
        ],
    }


def convertible_math(data: dict[str, Any]) -> dict[str, Any]:
    share_price = _num(data, "share_price", required=True)
    principal = _num(data, "principal", required=True)
    coupon_pct = _pct(_num(data, "coupon_pct", 0.0)) or 0.0
    conversion_premium_pct = _pct(_num(data, "conversion_premium_pct", required=True))
    fee_pct = _pct(_num(data, "fee_pct", 0.0)) or 0.0
    existing_basic_shares = _num(data, "existing_basic_shares")
    straight_debt_coupon_pct = _pct(_num(data, "straight_debt_coupon_pct"))
    capped_call_cap_price = _num(data, "capped_call_cap_price")
    capped_call_cost_pct = _pct(_num(data, "capped_call_cost_pct", 0.0)) or 0.0

    conversion_price = share_price * (1 + conversion_premium_pct)
    underlying_shares = principal / conversion_price
    net_proceeds_before_capped_call = principal * (1 - fee_pct)
    capped_call_cost = principal * capped_call_cost_pct
    net_proceeds_after_capped_call = net_proceeds_before_capped_call - capped_call_cost
    annual_cash_interest = principal * coupon_pct
    straight_debt_interest = (
        None if straight_debt_coupon_pct is None else principal * straight_debt_coupon_pct
    )
    coupon_savings_vs_straight_debt = (
        None if straight_debt_interest is None else straight_debt_interest - annual_cash_interest
    )

    outputs: dict[str, Any] = {
        "conversion_price": conversion_price,
        "underlying_shares": underlying_shares,
        "annual_cash_interest": annual_cash_interest,
        "net_proceeds_before_capped_call": net_proceeds_before_capped_call,
        "capped_call_cost": capped_call_cost,
        "net_proceeds_after_capped_call": net_proceeds_after_capped_call,
        "coupon_savings_vs_straight_debt": coupon_savings_vs_straight_debt,
        "potential_dilution_pct_of_pro_forma": None,
        "capped_call_cap_premium_pct": None,
    }
    if existing_basic_shares is not None:
        outputs["potential_dilution_pct_of_pro_forma"] = (
            _safe_div(underlying_shares, existing_basic_shares + underlying_shares) * 100
        )
    if capped_call_cap_price is not None:
        outputs["capped_call_cap_premium_pct"] = (
            _safe_div(capped_call_cap_price - share_price, share_price) * 100
        )

    return {
        "mode": "convertible",
        "inputs_used": {
            "share_price": share_price,
            "principal": principal,
            "coupon_pct": coupon_pct * 100,
            "conversion_premium_pct": conversion_premium_pct * 100,
            "fee_pct": fee_pct * 100,
            "capped_call_cost_pct": capped_call_cost_pct * 100,
        },
        "outputs": outputs,
        "notes": [
            "convertible economics are simplified and do not replace options valuation, accounting, tax, or legal analysis",
            "stock borrow, implied volatility, settlement method, and capped call terms can materially change investor demand and dilution optics",
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Run basic capital markets issuance math")
    parser.add_argument("--mode", choices=["equity", "debt", "convertible"], required=True)
    parser.add_argument("--input", required=True, help="path to json input file, or '-' for stdin")
    parser.add_argument(
        "--pretty", action="store_true", help="pretty-print json output when --json-run-log is used"
    )
    parser.add_argument(
        "--json-run-log",
        "--json",
        dest="json_run_log",
        action="store_true",
        help="Print machine-readable calculation JSON to stdout. Default stdout is human-readable.",
    )
    parser.add_argument(
        "--quiet-human-output",
        action="store_true",
        help="Suppress human-readable stdout when --json-run-log is not used.",
    )
    parser.add_argument(
        "--outdir",
        type=Path,
        help="Optional output directory for workbook/report/manifest artifacts",
    )
    args = parser.parse_args()

    try:
        if args.input == "-":
            data = json.load(sys.stdin)
        else:
            data = json.loads(Path(args.input).read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("input JSON must be an object")
        if args.mode == "equity":
            result = equity_math(data)
        elif args.mode == "debt":
            result = debt_math(data)
        else:
            result = convertible_math(data)
        result = _round(result)
        if args.outdir:
            args.outdir.mkdir(parents=True, exist_ok=True)
            support = support_dir(args.outdir)
            result_path = support / "issuance_math.json"
            result_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
            rows = [
                {
                    "metric": key,
                    "value": json.dumps(value) if isinstance(value, (dict, list)) else value,
                }
                for key, value in result.items()
            ]
            workbook_path = args.outdir / "financing_alternatives.xlsx"
            write_cover_first_workbook(
                workbook_path,
                [
                    ["Financing Alternatives"],
                    ["Mode", args.mode],
                    [
                        "First read",
                        "Use this workbook first. The issuance math JSON is support/audit data.",
                    ],
                    [
                        "Market window",
                        "Analyst/agent must layer current market data and source posture before client or board use.",
                    ],
                ],
                {
                    "Sources_Uses": dict_rows_to_sheet(rows),
                    "Instrument_Comparison": dict_rows_to_sheet(rows),
                    "Pricing": dict_rows_to_sheet(rows),
                    "Proceeds": dict_rows_to_sheet(rows),
                    "Dilution_Leverage": dict_rows_to_sheet(rows),
                    "Market_Window": [
                        ["item", "status"],
                        ["market data", "not pulled by deterministic math helper"],
                    ],
                    "Execution_Risks": dict_rows_to_sheet(
                        [{"risk": item} for item in result.get("risk_flags", [])]
                        if isinstance(result.get("risk_flags"), list)
                        else []
                    ),
                },
            )
            handoff_results = []
            handoff_overrides = {
                "issuer_context": "Deterministic capital markets issuance math output",
                "borrower_or_issuer_name": str(
                    data.get("issuer") or data.get("borrower_or_issuer_name") or "Issuer"
                ),
                "transaction_objective": str(data.get("transaction_objective") or args.mode),
                "recommended_instrument": args.mode,
                "instrument_or_facility": args.mode,
                "proposed_size": result.get("inputs_used", {}).get(
                    "gross_proceeds", data.get("gross_proceeds", "not_provided")
                ),
                "target_raise_amount": result.get("inputs_used", {}).get(
                    "gross_proceeds", data.get("gross_proceeds", "not_provided")
                ),
                "market_window_status": "requires current market data overlay",
                "circulation_caveats": [
                    {
                        "caveat": "Deterministic math only; market data and legal/capital-structure review required.",
                        "impact": "not client-ready",
                        "owner": "VP",
                    }
                ],
            }
            for contract_name, consumer in [
                (
                    "capital_markets_issuance_to_private_credit_underwriting",
                    "private-credit-underwriting",
                ),
                (
                    "capital_markets_issuance_to_covenant_package_analyzer",
                    "covenant-package-analyzer",
                ),
            ]:
                handoff_results.append(
                    write_handoff_payload(
                        args.outdir,
                        contract_name,
                        build_minimal_handoff_payload(contract_name, handoff_overrides),
                        consumer_skill=consumer,
                    )
                )
            write_artifact_manifest(
                args.outdir,
                "capital-markets-issuance",
                "workbook",
                workbook_path,
                support_artifacts=[
                    artifact_item(
                        result_path,
                        "support_artifact",
                        "json",
                        "Deterministic issuance math output.",
                        False,
                        True,
                        "JSON is support/audit data; the workbook is the human deliverable.",
                    ),
                    *[handoff_artifact_item(result) for result in handoff_results],
                ],
                blocked_or_partial_status={
                    "status": "partial",
                    "reason": "Deterministic math helper does not pull live market data or replace issuer/board judgment.",
                    "missing_inputs": [
                        "Current market data",
                        "Comparable issuance context",
                        "Investor feedback",
                        "Legal/capital structure review",
                    ],
                },
                extra={
                    "handoffs": [
                        {
                            "handoff_contract_name": item["handoff_contract_name"],
                            "path": item["path"],
                            "schema_path": item["schema_path"],
                            "validator_status": item["validator_status"],
                            "validated_at": item["validated_at"],
                            "consumer_skill": item["consumer_skill"],
                        }
                        for item in handoff_results
                    ]
                },
            )
        if args.json_run_log:
            print(json.dumps(result, indent=2 if args.pretty else None, sort_keys=False))
        elif not args.quiet_human_output:
            if args.outdir:
                print(f"Capital markets issuance math complete: {args.mode}")
                print(f"Open first: {args.outdir / 'financing_alternatives.xlsx'}")
                print("Support math JSON is stored under support/ for audit/import use.")
            else:
                print(f"Capital markets issuance math complete: {args.mode}")
                print(
                    "Use --json-run-log for machine-readable calculation output or --outdir for workbook/report artifacts."
                )
        return 0
    except Exception as exc:  # noqa: BLE001 - CLI should show clean error
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
