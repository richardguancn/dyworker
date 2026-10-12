#!/usr/bin/env python3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from runtime_loader import load_runtime_module

_runtime = load_runtime_module("skill_core")
__all__ = [name for name in dir(_runtime) if not name.startswith("_")]
globals().update({name: getattr(_runtime, name) for name in __all__})
