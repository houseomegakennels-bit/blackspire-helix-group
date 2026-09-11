import importlib.util
import unittest
from pathlib import Path

P = Path(__file__).parents[1] / "backtests" / "london_backtest_v2.py"
spec = importlib.util.spec_from_file_location("lbv2", P)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class LondonBacktestV2Tests(unittest.TestCase):
    def test_fvg_bearish(self):
        c=[{"low":1.1000,"high":1.1010},{"low":1.0995,"high":1.1005},{"low":1.0980,"high":1.0990}]
        f=m.fvg_for_bar(c,2,-1)
        self.assertAlmostEqual(f["low"],1.0990)
        self.assertAlmostEqual(f["high"],1.1000)
        self.assertAlmostEqual(f["mid"],1.0995)

    def test_fvg_bullish(self):
        c=[{"low":1.1000,"high":1.1010},{"low":1.1005,"high":1.1015},{"low":1.1020,"high":1.1030}]
        f=m.fvg_for_bar(c,2,1)
        self.assertAlmostEqual(f["low"],1.1010)
        self.assertAlmostEqual(f["high"],1.1020)
        self.assertAlmostEqual(f["mid"],1.1015)

    def test_position_size_uses_tick_value(self):
        n,risk_pc=m.position_size(50000,1.1000,1.0990,.00005,.625)
        self.assertEqual(n,6)
        self.assertAlmostEqual(risk_pc,12.5)

    def test_summary_empty(self):
        s=m.summarize([])
        self.assertEqual(s["trades"],0)
        self.assertEqual(s["net_pnl"],0.0)

if __name__ == "__main__":
    unittest.main()
