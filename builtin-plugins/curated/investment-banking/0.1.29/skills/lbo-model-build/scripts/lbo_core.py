#!/usr/bin/env python3
"""Public shim for the deterministic LBO engine."""

import sys
from importlib.machinery import SourceFileLoader
from importlib.util import module_from_spec, spec_from_loader
from pathlib import Path

P = Path(__file__).resolve().parent / "runtime" / "lbo_core"
loader = SourceFileLoader("_lbo_core_runtime", str(P))
spec = spec_from_loader(loader.name, loader)
if spec is None:
    raise ImportError(P)
M = module_from_spec(spec)
sys.modules[loader.name] = M
loader.exec_module(M)
globals().update({k: getattr(M, k) for k in dir(M) if not k.startswith("_")})
