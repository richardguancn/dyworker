#!/usr/bin/env python3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from runtime_loader import load_runtime_module

main = load_runtime_module("run_pipeline").main

if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
