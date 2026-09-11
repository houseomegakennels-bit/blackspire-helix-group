import importlib.util
from pathlib import Path
import unittest
from datetime import datetime

MODULE = Path(__file__).parents[1] / 'backtests' / 'london_backtest_v1.py'
spec = importlib.util.spec_from_file_location('lb', MODULE)
lb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lb)

class LondonBacktestTests(unittest.TestCase):
    def test_position_size_caps_at_six(self):
        n, risk = lb.size_trade(50000, 1.1000, 1.0990)
        self.assertEqual(n, 6)
        self.assertAlmostEqual(risk, 12.5)

    def test_position_size_can_reduce(self):
        n, risk = lb.size_trade(50000, 1.1000, 1.0900)
        self.assertEqual(n, 2)
        self.assertAlmostEqual(risk, 125.0)

    def test_same_bar_stop_target_is_conservative_stop(self):
        bars = [{'dt_et': datetime(2026,1,1,7,0), 'open':1.1000, 'high':1.1050, 'low':1.0970, 'close':1.1010}]
        trade = lb.simulate(1,1.1000,1.0980,1.1040,bars,0,1,50000,'X','2026-01-01')
        self.assertEqual(trade['exit_type'], 'stop')
        self.assertLess(trade['net_pnl'], 0)

    def test_slippage_and_commission_are_charged(self):
        bars = [{'dt_et': datetime(2026,1,1,7,0), 'open':1.1000, 'high':1.1040, 'low':1.1000, 'close':1.1040}]
        trade = lb.simulate(1,1.1000,1.0980,1.1040,bars,0,1,50000,'X','2026-01-01')
        self.assertEqual(trade['exit_type'], 'target')
        self.assertAlmostEqual(trade['commission'], 1.5)
        self.assertLess(trade['net_pnl'], 50.0)

if __name__ == '__main__':
    unittest.main()
