from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class DashboardBuilderUnittestSmoke(unittest.TestCase):
    def test_renderer_emits_single_html_by_default(self) -> None:
        skill_dir = Path(__file__).resolve().parents[1]
        script = skill_dir / "scripts" / "render_dashboard.py"
        contract = skill_dir / "tests" / "fixtures" / "sample_report_only_contract.json"
        with tempfile.TemporaryDirectory() as tmpdir:
            outdir = Path(tmpdir)
            result = subprocess.run(
                [
                    sys.executable,
                    str(script),
                    "--contract",
                    str(contract),
                    "--outdir",
                    str(outdir),
                    "--json-run-log",
                ],
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            payload = json.loads(result.stdout)
            self.assertIn(payload.get("status"), {"ok", "ok_with_warnings"})
            self.assertTrue(list(outdir.glob("*.html")))


if __name__ == "__main__":
    unittest.main()
