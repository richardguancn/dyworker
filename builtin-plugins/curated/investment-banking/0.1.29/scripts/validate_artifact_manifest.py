#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from shared.artifacts import validate_artifact_manifest  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate an Investment Banking artifact manifest."
    )
    parser.add_argument("manifest", type=Path, help="Path to manifest.json")
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    validate_artifact_manifest(manifest)
    print(json.dumps({"status": "ok", "manifest": str(args.manifest)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
