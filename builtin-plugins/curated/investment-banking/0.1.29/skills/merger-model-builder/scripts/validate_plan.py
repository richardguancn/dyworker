#!/usr/bin/env python3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from runtime_loader import load_runtime_module

_runtime = load_runtime_module("validate_plan")
main = _runtime.main
validate = _runtime.validate

if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
