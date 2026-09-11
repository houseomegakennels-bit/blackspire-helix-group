import importlib.util
import math
from pathlib import Path
import unittest

MODULE = Path(__file__).parents[1] / "scripts" / "offline_premise_validator.py"
spec = importlib.util.spec_from_file_location("offline_premise_validator", MODULE)
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)

class OfflineValidatorMathTests(unittest.TestCase):
    def test_gate_stays_provisional_below_30(self):
        self.assertEqual(validator.status(29, 29), "PROVISIONAL")

    def test_combined_scenario_a_fails_predefined_gate(self):
        self.assertEqual(validator.status(17, 31), "FAIL")
        self.assertAlmostEqual(validator.pct(17, 31), 54.8387096774, places=7)
        lo, hi = validator.wilson(17, 31)
        self.assertAlmostEqual(lo, 37.7721676374, places=6)
        self.assertAlmostEqual(hi, 70.8382640195, places=6)

    def test_percentile_uses_nearest_rank(self):
        vals = [1, 2, 3, 4]
        self.assertEqual(validator.percentile(vals, 25), 1)
        self.assertEqual(validator.percentile(vals, 50), 2)
        self.assertEqual(validator.percentile(vals, 90), 4)

    def test_session_coverage_thresholds_match_pine_gate(self):
        self.assertEqual(math.ceil(48 * validator.MIN_COVERAGE), 41)
        self.assertEqual(math.ceil(24 * validator.MIN_COVERAGE), 21)
        self.assertEqual(math.ceil(36 * validator.MIN_COVERAGE), 31)

if __name__ == "__main__":
    unittest.main()
