#!/usr/bin/env python3
"""Validate Investment Banking handoff payloads without third-party deps.

The shared Markdown contract remains the human-readable authority. The JSON
schemas in ../schemas provide machine-readable required fields; this script
checks required field presence, nested support records, arrays, enums, consts,
and simple regex patterns while allowing extra banker notes and local workflow
fields to travel with the package.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

CONTRACT_SHAPES: dict[str, dict[str, Any]] = {
    "buyer_investor_list_to_deal_process_tracker": {
        "schema": "buyer_investor_list_to_deal_process_tracker.schema.json",
        "record_def": "record",
        "package_keys": ("records",),
        "secondary": {"holds_and_exclusions": "holds_and_exclusions_record"},
    },
    "meeting_prep_to_deal_process_tracker": {
        "schema": "meeting_prep_to_deal_process_tracker.schema.json",
        "record_def": "record",
        "package_keys": ("tracker_deltas",),
    },
    "company_tearsheet_to_memo_builder": {
        "schema": "company_tearsheet_to_memo_builder.schema.json",
        "record_def": "record",
        "package_keys": ("memo_package",),
    },
    "meeting_prep_to_memo_builder": {
        "schema": "meeting_prep_to_memo_builder.schema.json",
        "record_def": "record",
        "package_keys": ("memo_package",),
    },
    "cim_teardown_to_memo_builder": {
        "schema": "cim_teardown_to_memo_builder.schema.json",
        "record_def": "record",
    },
    "cim_builder_to_ib_deck_qc": {
        "schema": "cim_builder_to_ib_deck_qc.schema.json",
        "record_def": "record",
    },
    "pitch_deck_builder_to_ib_deck_qc": {
        "schema": "pitch_deck_builder_to_ib_deck_qc.schema.json",
        "record_def": "record",
    },
    "cim_teardown_to_model_builder": {
        "schema": "cim_teardown_to_model_builder.schema.json",
        "record_def": "record",
    },
    "style_guide_adapter_style_profile": {
        "schema": "style_guide_adapter_style_profile.schema.json",
        "record_def": "record",
    },
    "style_guide_adapter_change_log": {
        "schema": "style_guide_adapter_change_log.schema.json",
        "record_def": "record",
    },
    "capital_markets_issuance_to_private_credit_underwriting": {
        "schema": "capital_markets_issuance_to_private_credit_underwriting.schema.json",
        "record_def": "record",
    },
    "capital_markets_issuance_to_covenant_package_analyzer": {
        "schema": "capital_markets_issuance_to_covenant_package_analyzer.schema.json",
        "record_def": "record",
    },
    "private_credit_underwriting_to_covenant_package_analyzer": {
        "schema": "private_credit_underwriting_to_covenant_package_analyzer.schema.json",
        "record_def": "record",
    },
    "private_credit_underwriting_to_distressed_recovery_waterfall": {
        "schema": "private_credit_underwriting_to_distressed_recovery_waterfall.schema.json",
        "record_def": "record",
    },
    "distressed_recovery_waterfall_to_memo_builder": {
        "schema": "distressed_recovery_waterfall_to_memo_builder.schema.json",
        "record_def": "record",
        "requires_distressed_economics_split": True,
    },
    "distressed_recovery_waterfall_to_pitch_deck_builder": {
        "schema": "distressed_recovery_waterfall_to_pitch_deck_builder.schema.json",
        "record_def": "record",
        "requires_distressed_economics_split": True,
    },
    "distressed_recovery_waterfall_to_ib_deck_qc": {
        "schema": "distressed_recovery_waterfall_to_ib_deck_qc.schema.json",
        "record_def": "record",
        "requires_distressed_economics_split": True,
    },
}

SOFT_EMPTY_VALUES = {"", "unknown", "not_provided", "not provided", "n/a", "na", "none"}
DISTRESSED_ECONOMICS_SPLIT_FIELDS = [
    "strict_legal_entitlement_economics",
    "negotiated_plan_economics",
    "collateral_liquidation_waterfall",
    "enterprise_value_waterfall",
]


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"invalid json in {path}: {exc}") from exc


class SchemaResolver:
    def __init__(self, schema_dir: Path) -> None:
        self.schema_dir = schema_dir
        self.cache: dict[str, dict[str, Any]] = {}

    def load(self, filename: str) -> dict[str, Any]:
        path = self.schema_dir / filename
        if filename not in self.cache:
            data = load_json(path)
            if not isinstance(data, dict):
                raise SystemExit(f"schema must be an object: {path}")
            self.cache[filename] = data
        return self.cache[filename]

    def resolve_ref(
        self, ref: str, current_schema: dict[str, Any], current_file: str
    ) -> tuple[dict[str, Any], str]:
        if "#" in ref and not ref.startswith("#"):
            filename, pointer = ref.split("#", 1)
            schema = self.load(filename)
            return self._resolve_pointer(schema, pointer or ""), filename
        return self._resolve_pointer(
            current_schema, ref[1:] if ref.startswith("#") else ref
        ), current_file

    def _resolve_pointer(self, schema: dict[str, Any], pointer: str) -> dict[str, Any]:
        if not pointer:
            return schema
        current: Any = schema
        for raw_part in pointer.strip("/").split("/"):
            part = raw_part.replace("~1", "/").replace("~0", "~")
            if not isinstance(current, dict) or part not in current:
                raise SystemExit(f"schema reference not found: {pointer}")
            current = current[part]
        if not isinstance(current, dict):
            raise SystemExit(f"schema reference does not point to an object: {pointer}")
        return current


def load_schema(contract: str, resolver: SchemaResolver) -> tuple[dict[str, Any], str]:
    shape = CONTRACT_SHAPES[contract]
    filename = str(shape["schema"])
    return resolver.load(filename), filename


def ensure_records(value: Any, label: str) -> list[dict[str, Any]]:
    if isinstance(value, dict):
        return [value]
    if not isinstance(value, list):
        raise SystemExit(f"{label} must be an object or list of objects")
    records: list[dict[str, Any]] = []
    for index, record in enumerate(value, start=1):
        if not isinstance(record, dict):
            raise SystemExit(f"{label}[{index}] must be an object")
        records.append(record)
    return records


def normalize_collections(
    contract: str, payload: Any
) -> list[tuple[str, str, list[dict[str, Any]]]]:
    shape = CONTRACT_SHAPES[contract]
    package_keys = shape.get("package_keys", ())

    if isinstance(payload, list):
        return [("records", str(shape["record_def"]), ensure_records(payload, "payload"))]
    if not isinstance(payload, dict):
        raise SystemExit("payload must be an object or list of objects")

    collections: list[tuple[str, str, list[dict[str, Any]]]] = []
    for key in package_keys:
        if key in payload:
            collections.append(
                ("records", str(shape["record_def"]), ensure_records(payload[key], key))
            )
            break
    if not collections:
        collections.append(("records", str(shape["record_def"]), [payload]))

    for key, def_name in dict(shape.get("secondary", {})).items():
        if key in payload:
            collections.append((key, str(def_name), ensure_records(payload[key], key)))
    return collections


def is_soft_empty(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str) and value.strip().lower() in SOFT_EMPTY_VALUES:
        return True
    if isinstance(value, list) and not value:
        return True
    if isinstance(value, dict) and not value:
        return True
    return False


def type_matches(value: Any, expected: str) -> bool:
    if expected == "object":
        return isinstance(value, dict)
    if expected == "array":
        return isinstance(value, list)
    if expected == "string":
        return isinstance(value, str)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "null":
        return value is None
    return True


def validate_value(
    value: Any,
    schema: dict[str, Any],
    resolver: SchemaResolver,
    current_schema: dict[str, Any],
    current_file: str,
    path: str,
    errors: list[str],
    warnings: list[str],
) -> None:
    if "$ref" in schema:
        resolved, resolved_file = resolver.resolve_ref(
            str(schema["$ref"]), current_schema, current_file
        )
        validate_value(
            value,
            resolved,
            resolver,
            resolver.load(resolved_file),
            resolved_file,
            path,
            errors,
            warnings,
        )
        return

    if "const" in schema and value != schema["const"]:
        errors.append(f"{path} must equal {schema['const']!r}; got {value!r}")
    if "enum" in schema and not is_soft_empty(value) and value not in schema["enum"]:
        allowed = ", ".join(str(v) for v in schema["enum"])
        errors.append(f"{path} invalid value {value!r}; allowed: {allowed}")
    if "pattern" in schema and not is_soft_empty(value):
        if not isinstance(value, str) or not re.search(str(schema["pattern"]), value):
            errors.append(f"{path} must match pattern {schema['pattern']!r}; got {value!r}")

    expected_type = schema.get("type")
    if expected_type:
        expected_types = expected_type if isinstance(expected_type, list) else [expected_type]
        if not any(type_matches(value, str(item)) for item in expected_types):
            errors.append(f"{path} must be {expected_type}; got {type(value).__name__}")
            return

    if isinstance(value, dict):
        required = [str(field) for field in schema.get("required", [])]
        for field in required:
            field_path = f"{path}.{field}"
            if field not in value:
                errors.append(f"{field_path} missing field")
            elif is_soft_empty(value[field]):
                warnings.append(f"{field_path} has placeholder/empty value")
        properties = schema.get("properties", {})
        if isinstance(properties, dict):
            for field, spec in properties.items():
                if field in value and isinstance(spec, dict):
                    validate_value(
                        value[field],
                        spec,
                        resolver,
                        current_schema,
                        current_file,
                        f"{path}.{field}",
                        errors,
                        warnings,
                    )
    elif isinstance(value, list):
        min_items = schema.get("minItems")
        if isinstance(min_items, int) and len(value) < min_items:
            errors.append(f"{path} must contain at least {min_items} item(s)")
        item_schema = schema.get("items")
        if isinstance(item_schema, dict):
            for index, item in enumerate(value, start=1):
                validate_value(
                    item,
                    item_schema,
                    resolver,
                    current_schema,
                    current_file,
                    f"{path}[{index}]",
                    errors,
                    warnings,
                )


def special_contract_checks(
    contract: str, records: list[dict[str, Any]], errors: list[str], warnings: list[str]
) -> None:
    if contract == "cim_teardown_to_model_builder":
        for index, record in enumerate(records, start=1):
            for field, prefix in {
                "claim_id": "C-",
                "red_flag_id": "RF-",
                "question_id": "Q-",
                "task_id": "T-",
            }.items():
                value = record.get(field)
                if not is_soft_empty(value) and not str(value).startswith(prefix):
                    errors.append(
                        f"records[{index}].{field} must preserve {prefix} identifier; got {value!r}"
                    )

    if CONTRACT_SHAPES[contract].get("requires_distressed_economics_split"):
        for index, record in enumerate(records, start=1):
            for field in DISTRESSED_ECONOMICS_SPLIT_FIELDS:
                if field not in record:
                    errors.append(
                        f"records[{index}].{field} missing field; distressed handoffs must not collapse recovery economics"
                    )
                elif is_soft_empty(record[field]):
                    warnings.append(f"records[{index}].{field} has placeholder/empty value")


def validate(contract: str, payload: Any, schema_dir: Path) -> tuple[list[str], list[str]]:
    resolver = SchemaResolver(schema_dir)
    schema, schema_file = load_schema(contract, resolver)
    shape = CONTRACT_SHAPES[contract]
    collections = normalize_collections(contract, payload)

    errors: list[str] = []
    warnings: list[str] = []
    if (
        isinstance(payload, dict)
        and "contract_name" in payload
        and payload["contract_name"] != contract
    ):
        errors.append(f"contract_name must equal {contract!r}; got {payload['contract_name']!r}")

    defs = schema.get("$defs", {})
    if not isinstance(defs, dict):
        raise SystemExit(f"schema missing $defs: {schema_file}")

    main_records: list[dict[str, Any]] = []
    for label, def_name, records in collections:
        if def_name not in defs:
            raise SystemExit(f"schema {schema_file} missing $defs.{def_name}")
        record_schema = defs[def_name]
        if not isinstance(record_schema, dict):
            raise SystemExit(f"schema $defs.{def_name} must be an object")
        if not records:
            errors.append(f"{label}: no records found")
        for index, record in enumerate(records, start=1):
            validate_value(
                record,
                record_schema,
                resolver,
                schema,
                schema_file,
                f"{label}[{index}]",
                errors,
                warnings,
            )
        if def_name == shape["record_def"]:
            main_records.extend(records)

    special_contract_checks(contract, main_records, errors, warnings)
    return errors, warnings


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate an Investment Banking handoff payload")
    parser.add_argument(
        "contract", choices=sorted(CONTRACT_SHAPES), help="Canonical handoff contract name"
    )
    parser.add_argument("input_json", type=Path, help="Path to payload JSON")
    parser.add_argument(
        "--schema-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "schemas",
        help="Directory containing *.schema.json files",
    )
    parser.add_argument(
        "--strict", action="store_true", help="Treat placeholder/empty values as failures"
    )
    args = parser.parse_args()

    payload = load_json(args.input_json)
    errors, warnings = validate(args.contract, payload, args.schema_dir)

    for message in errors:
        print(f"ERROR: {message}")
    for message in warnings:
        print(f"WARNING: {message}")

    if errors or (args.strict and warnings):
        return 1
    print("validation passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
