#!/usr/bin/env python3
"""Public entrypoint for deterministic LBO exports."""

import runpy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
runpy.run_path(str(ROOT / "scripts" / "runtime" / "run_pipeline"), run_name="__main__")
