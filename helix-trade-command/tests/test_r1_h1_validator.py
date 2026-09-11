import importlib.util
import math
from pathlib import Path
import unittest

MODULE = Path(__file__).parents[1] / "scripts" / "r1_h1_validator.py"
spec = importlib.util.spec_from_file_location("r1_h1_validator", MODULE)
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class R1H1ValidatorTests(unittest.TestCase):
    def test_gate_is_unchanged(self):
        self.assertEqual(validator.status(29, 29), "PROVISIONAL")
        self.assertEqual(validator.status(17, 31), "FAIL")

    def test_coverage_thresholds_match_preregistration(self):
        self.assertEqual(math.ceil(48 * validator.MIN_COVERAGE), 41)
        self.assertEqual(math.ceil(24 * validator.MIN_COVERAGE), 21)
        self.assertEqual(math.ceil(36 * validator.MIN_COVERAGE), 31)

    def test_zero_event_rate_is_defined_as_none(self):
        self.assertIsNone(validator.pct(0, 0))

    def test_wilson_bounds_are_ordered(self):
        lo, hi = validator.wilson(11, 20)
        self.assertLess(lo, 55.0)
        self.assertGreater(hi, 55.0)


if __name__ == "__main__":
    unittest.main()
