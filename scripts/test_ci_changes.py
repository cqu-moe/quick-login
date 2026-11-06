import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('ci_changes', Path(__file__).with_name('ci-changes.py'))
ci_changes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ci_changes)


class ChangeRoutingTests(unittest.TestCase):
    def test_only_prose_may_skip_quality_gates(self):
        for paths, expected in [
            (['README.md', 'docs/operations/runbook.md'], False),
            (['AGENTS.md'], False),
            (['docs/research/diagram.png'], True),
            (['docs/research/fixture.ts'], True),
            (['docs/releases/0.5.4.md'], True),
            (['README.md', 'src/background/index.ts'], True),
            (['.github/workflows/check.yml'], True),
            (['package-lock.json'], True),
            (['website/header.html'], True),
        ]:
            with self.subTest(paths=paths):
                self.assertEqual(ci_changes.requires_ci(paths), expected)
