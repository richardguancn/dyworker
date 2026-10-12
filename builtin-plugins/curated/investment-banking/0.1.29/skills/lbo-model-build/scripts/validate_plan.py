#!/usr/bin/env python3
"""Public entrypoint for LBO plan validation."""

import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
runpy.run_path(str(ROOT / "scripts" / "runtime" / "validate_plan"), run_name="__main__")
